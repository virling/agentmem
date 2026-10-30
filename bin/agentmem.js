#!/usr/bin/env node
import { capture, findConflicts, logCapture } from "../src/capture.js";
import { exportRules } from "../src/export.js";
import { runHook } from "../src/hooks.js";
import { install } from "../src/install.js";
import { startServer } from "../src/mcp.js";
import { Store, summary } from "../src/store.js";

const HELP = `agentmem: project memory for AI agents

  agentmem install [agent...]       configure detected agents (claude, cursor, windsurf, gemini, codex)
  agentmem mcp                      start the MCP server (default when stdin is piped)
  agentmem list                     list memories for this project (local and team)
  agentmem search <query>
  agentmem show <id>
  agentmem add <title> <content> [--type t] [--files a,b] [--tags x,y] [--guard warn|block] [--team] [--pin] [--force]
  agentmem edit <id> [--title t] [--content c] [--type t] [--files a,b] [--tags x,y] [--guard warn|block]
  agentmem verify <id>              mark a memory as still true for its current files
  agentmem promote <id>             move a local memory into the repo's .agentmem/ folder
  agentmem pin <id> | unpin <id>
  agentmem rm <id>
  agentmem export [agents|claude|copilot|cursor ...] [--include-local]
                                    write team memories into agent rule files
  agentmem check                    find contradicting memories (uses claude -p)
  agentmem path                     print the storage folders for this project
  agentmem hook <session-start|pre-tool-use|post-tool-use|session-end>
  agentmem capture <transcript.jsonl>`;

const BOOLEAN_FLAGS = ["pin", "force", "team", "include-local"];

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) positional.push(argv[i]);
    else if (BOOLEAN_FLAGS.includes(argv[i].slice(2))) flags[argv[i].slice(2)] = true;
    else flags[argv[i].slice(2)] = argv[++i];
  }
  return { positional, flags };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "mcp" || (!command && !process.stdin.isTTY)) return startServer();
  if (command === "hook") return runHook(rest[0]);
  if (command === "install") return install(rest);

  const { positional, flags } = parseArgs(rest);
  const store = new Store(process.cwd());
  switch (command) {
    case "list": {
      const all = store.list();
      return console.log(all.length ? all.map(summary).join("\n") : "No memories yet.");
    }
    case "search": {
      const hits = store.search(positional.join(" "));
      return console.log(hits.length ? hits.map(summary).join("\n") : "No matches.");
    }
    case "show":
      return console.log(store.read(positional[0]));
    case "add": {
      const { pin, team, ...rest } = flags;
      const fields = { title: positional[0], content: positional[1], ...rest };
      const id = store.write({ ...fields, pinned: !!pin, scope: team ? "team" : "local", agent: "cli" });
      const related = store.related(fields, id);
      console.log(`Saved ${id}`);
      return related.length && console.log(`Related, check for contradictions:\n${related.map(summary).join("\n")}`);
    }
    case "edit":
      return console.log(`Updated ${store.update(positional[0], flags)}`);
    case "verify":
      return console.log(`Verified ${store.update(positional[0], {})}`);
    case "promote":
      return console.log(`Promoted ${store.promote(positional[0])} to ${store.teamDir}. Commit it to share it.`);
    case "pin":
    case "unpin":
      return console.log(`Updated ${store.update(positional[0], { pinned: command === "pin" })}`);
    case "rm":
      store.delete(positional[0]);
      return console.log(`Deleted ${positional[0]}`);
    case "export": {
      const written = exportRules(store, positional.length ? positional : ["agents"], { includeLocal: !!flags["include-local"] });
      return console.log(`Wrote ${written.join(", ")}`);
    }
    case "check": {
      const conflicts = findConflicts(store);
      if (!conflicts.length) return console.log("No contradictions found.");
      return console.log(conflicts.map((c) => `- ${c.ids.join(" vs ")}: ${c.reason}`).join("\n"));
    }
    case "path":
      return console.log(`local: ${store.dir}\nteam:  ${store.teamDir}`);
    case "capture": {
      const result = capture(store, positional[0]);
      logCapture(store, positional[0], result);
      return console.log(JSON.stringify(result));
    }
    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(`agentmem: ${err.message}`);
  process.exit(1);
});
