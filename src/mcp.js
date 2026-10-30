import readline from "node:readline";
import { GUARDS, SCOPES, Store, TYPES, summary } from "./store.js";

const stores = new Map();
function storeFor(projectPath) {
  const dir = projectPath || process.cwd();
  if (!stores.has(dir)) stores.set(dir, new Store(dir));
  return stores.get(dir);
}

const projectPath = {
  type: "string",
  description: "Absolute path of the project. Only needed if the server was not started inside the project.",
};
const fields = {
  title: { type: "string" },
  content: { type: "string" },
  type: { type: "string", enum: TYPES },
  files: { type: "array", items: { type: "string" }, description: "Repo-relative files this memory is about" },
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

function call(name, args = {}) {
  const store = storeFor(args.project_path);
  switch (name) {
    case "memory_list": {
      const all = store.list();
      return all.length ? `${all.length} memories for ${store.project.name}:\n${all.map(summary).join("\n")}` : "No memories yet.";
    }
    case "memory_search": {
      const hits = store.search(args.query);
      return hits.length ? hits.map((m) => `${summary(m)}\n  ${m.body.slice(0, 200)}`).join("\n") : "No matches.";
    }
    case "memory_read":
      return store.read(args.id);
    case "memory_write": {
      const id = store.write(args);
      const related = store.related(args, id);
      return related.length
        ? `Saved ${id}\nRelated memories, check none of them contradict the new one (update or delete if they do):\n${related.map(summary).join("\n")}`
        : `Saved ${id}`;
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
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agentmem", version: "0.4.0" },
      };
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
