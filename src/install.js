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

const home = os.homedir();
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");

export const AGENTS = {
  claude: { dir: claudeDir },
  cursor: { dir: () => path.join(home, ".cursor"), file: "mcp.json" },
  windsurf: { dir: () => path.join(home, ".codeium", "windsurf"), file: "mcp_config.json" },
  gemini: { dir: () => path.join(home, ".gemini"), file: "settings.json" },
  codex: { dir: () => path.join(home, ".codex"), file: "config.toml" },
};

export function serverCommand(entry, pkg) {
  return entry.includes(`${path.sep}_npx${path.sep}`)
    ? { command: "npx", args: ["-y", pkg, "mcp"] }
    : { command: "node", args: [entry, "mcp"] };
}

export function addHooks(settings, prefix) {
  settings.hooks ??= {};
  const added = [];
  for (const { event, arg, matcher } of HOOKS) {
    const command = `${prefix} hook ${arg}`;
    const groups = (settings.hooks[event] ??= []);
    const existing = groups.flatMap((g) => g.hooks || []).find((h) => h.command?.endsWith(` hook ${arg}`));
    if (existing?.command === command) continue;
    if (existing) existing.command = command;
    else groups.push({ ...(matcher && { matcher }), hooks: [{ type: "command", command, timeout: 10 }] });
    added.push(event);
  }
  return added;
}

export function setJsonServer(data, server) {
  data.mcpServers ??= {};
  data.mcpServers.agentmem = server;
  return data;
}

export function setTomlServer(text, server) {
  const cleaned = text.replace(/\n*\[mcp_servers\.agentmem\]\n(?:(?!\[)[^\n]*(?:\n|$))*/, "\n").trimEnd();
  const block = `[mcp_servers.agentmem]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`;
  return cleaned ? `${cleaned}\n\n${block}` : block;
}

function installClaude(server) {
  const file = path.join(claudeDir(), "settings.json");
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const prefix = server.args.slice(0, -1).reduce((acc, a) => `${acc} ${a}`, server.command);
  const added = addHooks(settings, prefix);
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  try {
    execFileSync("claude", ["mcp", "remove", "agentmem", "--scope", "user"], { stdio: "ignore" });
  } catch {}
  execFileSync("claude", ["mcp", "add", "agentmem", "--scope", "user", "--", server.command, ...server.args], { stdio: "pipe" });
  return `MCP server + hooks${added.length ? ` (${added.join(", ")} updated)` : ""}`;
}

function installFile(agent, server) {
  const file = path.join(agent.dir(), agent.file);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const out = file.endsWith(".toml")
    ? setTomlServer(text, server)
    : JSON.stringify(setJsonServer(text.trim() ? JSON.parse(text) : {}, server), null, 2) + "\n";
  fs.writeFileSync(file, out);
  return `MCP server in ${file}`;
}

export function install(targets = []) {
  const entry = fileURLToPath(new URL("../bin/agentmem.js", import.meta.url));
  const { name } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const server = serverCommand(entry, name);
  const unknown = targets.filter((t) => !AGENTS[t]);
  if (unknown.length) throw new Error(`unknown agent: ${unknown.join(", ")}. Choose from: ${Object.keys(AGENTS).join(", ")}`);
  const chosen = targets.length ? targets : Object.keys(AGENTS).filter((k) => fs.existsSync(AGENTS[k].dir()));
  if (!chosen.length) return console.log(`No supported agents found. Pass one of: ${Object.keys(AGENTS).join(", ")}`);

  for (const key of chosen) {
    try {
      const agent = AGENTS[key];
      fs.mkdirSync(agent.dir(), { recursive: true });
      console.log(`ok   ${key}: ${key === "claude" ? installClaude(server) : installFile(agent, server)}`);
    } catch (err) {
      console.log(`fail ${key}: ${String(err.stderr || err.message).trim()}`);
    }
  }
  console.log("Restart your agents to load agentmem.");
}
