#!/usr/bin/env node
import { capture, logCapture } from "../src/capture.js";
import { runHook } from "../src/hooks.js";
import { install } from "../src/install.js";
import { startServer } from "../src/mcp.js";
import { Store, summary } from "../src/store.js";

const HELP = `agentmem: project memory for AI agents

  agentmem install [agent...]       configure detected agents (claude, cursor, windsurf, gemini, codex)
  agentmem mcp                      start the MCP server (default when stdin is piped)
  agentmem list                     list memories for this project
  agentmem search <query>
  agentmem show <id>
  agentmem add <title> <content> [--type t] [--files a,b] [--tags x,y] [--pin] [--force]
  agentmem edit <id> [--title t] [--content c] [--type t] [--files a,b] [--tags x,y]
  agentmem pin <id> | unpin <id>
  agentmem rm <id>
  agentmem path                     print the storage folder for this project
  agentmem hook <session-start|post-tool-use|session-end>
  agentmem capture <transcript.jsonl>`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) positional.push(argv[i]);
    else if (["--pin", "--force"].includes(argv[i])) flags[argv[i].slice(2)] = true;
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
    case "add":
      return console.log(
        `Saved ${store.write({ title: positional[0], content: positional[1], ...flags, pinned: !!flags.pin, agent: "cli" })}`
      );
    case "edit":
      return console.log(`Updated ${store.update(positional[0], flags)}`);
    case "pin":
    case "unpin":
      return console.log(`Updated ${store.update(positional[0], { pinned: command === "pin" })}`);
    case "rm":
      store.delete(positional[0]);
      return console.log(`Deleted ${positional[0]}`);
    case "path":
      return console.log(store.dir);
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
