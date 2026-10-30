import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = [
  { event: "SessionStart", arg: "session-start" },
  { event: "PostToolUse", arg: "post-tool-use", matcher: "Read|Edit|Write|MultiEdit" },
  { event: "SessionEnd", arg: "session-end" },
];

export function addHooks(settings, entry) {
  settings.hooks ??= {};
  const added = [];
  for (const { event, arg, matcher } of HOOKS) {
    const command = `node ${entry} hook ${arg}`;
    const groups = (settings.hooks[event] ??= []);
    if (groups.some((g) => g.hooks?.some((h) => h.command?.includes("agentmem") || h.command === command))) continue;
    groups.push({ ...(matcher && { matcher }), hooks: [{ type: "command", command, timeout: 10 }] });
    added.push(event);
  }
  return added;
}

export function install() {
  const entry = fileURLToPath(new URL("./index.js", import.meta.url));
  const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const added = addHooks(settings, entry);
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  console.log(added.length ? `Hooks added to ${file}: ${added.join(", ")}` : `Hooks already present in ${file}`);

  try {
    execFileSync("claude", ["mcp", "add", "agentmem", "--scope", "user", "--", "node", entry, "mcp"], { stdio: "pipe" });
    console.log("MCP server agentmem added to Claude Code (user scope)");
  } catch (err) {
    console.log(`MCP server not added: ${String(err.stderr || err.message).trim()}`);
  }
  console.log("Restart Claude Code to load agentmem.");
}
