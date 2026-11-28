import fs from "node:fs";
import readline from "node:readline";
import { handoffText } from "./hooks.js";
import { claudeHookWarning } from "./install.js";
import { GUARDS, SCOPES, Store, TYPES, projectKey, repoOfFiles, summary } from "./store.js";

const HOME_ROOT = projectKey(process.cwd()).root;
const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const stores = new Map();
function storeFor(projectPath) {
  const dir = projectPath || process.cwd();
  if (!stores.has(dir)) stores.set(dir, new Store(dir));
  return stores.get(dir);
}

const projectPath = {
  type: "string",
  description: "Absolute path of the repo this is about. Defaults to the folder the session started in; set it when the work is in another repo.",
};
const fields = {
  title: { type: "string" },
  content: { type: "string" },
  type: { type: "string", enum: TYPES },
  files: { type: "array", items: { type: "string" }, description: "Files this memory is about, repo-relative or absolute (absolute paths in another repo save it there)" },
  tags: { type: "array", items: { type: "string" } },
  pinned: { type: "boolean", description: "Always show this memory at session start" },
  guard: {
    type: "string",
    enum: GUARDS,
    description: "Turn this memory into a guardrail for its files (globs allowed): warn asks before edits, block denies them",
  },
};

const tools = [
  {
    name: "memory_list",
    description: "List all saved memories for the current project (id, type, title). Call at the start of a task.",
    inputSchema: { type: "object", properties: { project_path: projectPath } },
  },
  {
    name: "memory_search",
    description: "Search project memories by keywords.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, project_path: projectPath }, required: ["query"] },
  },
  {
    name: "memory_read",
    description: "Read the full text of one memory by id.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, project_path: projectPath }, required: ["id"] },
  },
  {
    name: "memory_write",
    description:
      "Save one durable fact about this project: a decision, convention, gotcha, todo or note. One fact per call. Never store secrets.",
    inputSchema: {
      type: "object",
      properties: {
        ...fields,
        agent: { type: "string", description: "Which agent is writing, e.g. claude-code, cursor" },
        scope: {
          type: "string",
          enum: SCOPES,
          description: "local (default, private to this machine) or team (stored in the repo's .agentmem/ folder and committed)",
        },
        force: { type: "boolean", description: "Save even if a memory with a similar title exists" },
        project_path: projectPath,
      },
      required: ["title", "content"],
    },
  },
  {
    name: "memory_update",
    description:
      "Change an existing memory. Only the fields you pass are changed. Calling it with just the id re-verifies the memory against its current files.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, ...fields, project_path: projectPath },
      required: ["id"],
    },
  },
  {
    name: "memory_handoff",
    description:
      "Leave a handoff note so the next session, in any agent, can continue this work. Call it when the user is switching agents or stopping mid-task. Replaces the previous handoff.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What was being worked on and what is done" },
        next_steps: { type: "string", description: "What to do next, in order" },
        files: { type: "array", items: { type: "string" } },
        agent: { type: "string" },
        resolves: { type: "array", items: { type: "string" }, description: "Ids of todo memories this work finished; they are deleted" },
        project_path: projectPath,
      },
      required: ["summary", "next_steps"],
    },
  },
  {
    name: "memory_promote",
    description: "Move a local memory into the team folder (.agentmem/ in the repo) so it can be committed and shared.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, project_path: projectPath }, required: ["id"] },
  },
  {
    name: "memory_delete",
    description: "Delete a memory that is wrong or outdated.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, project_path: projectPath }, required: ["id"] },
  },
];

export function writeHandoff(store, { summary: done, next_steps, files, agent = "unknown" }) {
  const stamp = new Date().toLocaleString("sv").slice(0, 16);
  return store.write({ title: `Handoff ${stamp}`, content: `${done}\n\nNext steps:\n${next_steps}`, type: "handoff", files, agent });
}

function call(name, args = {}) {
  const routed = name === "memory_write" && !args.project_path ? repoOfFiles(args.files, HOME_ROOT) : undefined;
  const store = storeFor(args.project_path || routed);
  switch (name) {
    case "memory_list": {
      const all = store.list();
      if (!all.length) return "No memories yet.";
      const handoff = store.latestHandoff();
      const head = handoff ? `${handoffText(handoff)}\n\n` : "";
      return `${head}${all.length} memories for ${store.project.name}:\n${all.map(summary).join("\n")}`;
    }
    case "memory_search": {
      const hits = store.search(args.query);
      return hits.length ? hits.map((m) => `${summary(m)}\n  ${m.body.slice(0, 200)}`).join("\n") : "No matches.";
    }
    case "memory_read":
      store.touch([args.id]);
      return store.read(args.id);
    case "memory_write": {
      const id = store.write(args);
      const related = store.related(args, id);
      const saved = `Saved ${id}${routed ? ` in ${store.project.name}` : ""}`;
      return related.length
        ? `${saved}\nRelated memories, check none of them contradict the new one (update or delete if they do):\n${related.map(summary).join("\n")}`
        : saved;
    }
    case "memory_handoff": {
      const open = new Set(store.list().filter((m) => m.type === "todo").map((m) => m.id));
      const resolves = args.resolves || [];
      const deleted = resolves.filter((id) => open.has(id));
      const unknown = resolves.filter((id) => !open.has(id));
      const lines = [`Saved handoff ${writeHandoff(store, args)}. The next session in any agent will see it first.`];
      for (const id of deleted) store.delete(id);
      if (deleted.length) lines.push(`Deleted finished todos: ${deleted.join(", ")}`);
      if (unknown.length) lines.push(`Not open todos, left alone: ${unknown.join(", ")}`);
      const todos = store.list().filter((m) => m.type === "todo");
      if (todos.length) lines.push("Open todos, delete any this work finished (memory_delete):", ...todos.map(summary));
      return lines.join("\n");
    }
    case "memory_promote":
      return `Promoted ${store.promote(args.id)} to ${store.teamDir}. Commit it to share with the team.`;
    case "memory_update":
      return `Updated ${store.update(args.id, args)}`;
    case "memory_delete":
      store.delete(args.id);
      return `Deleted ${args.id}`;
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function handle(msg) {
  switch (msg.method) {
    case "initialize": {
      const warning = msg.params?.clientInfo?.name === "claude-code" && claudeHookWarning();
      return {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agentmem", version },
        ...(warning && { instructions: warning }),
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      try {
        return { content: [{ type: "text", text: call(msg.params.name, msg.params.arguments) }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    default:
      throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  }
}

export function startServer() {
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    }
    if (msg.id === undefined) return;
    try {
      send({ jsonrpc: "2.0", id: msg.id, result: handle(msg) });
    } catch (err) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: err.code ?? -32603, message: err.message } });
    }
  });
}
