import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, summary } from "./store.js";

const INDEX_LIMIT = 50;

function output(event, context) {
  if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}

export function sessionStartContext(store) {
  const all = store.list();
  if (!all.length) return `agentmem: no memories yet for ${store.project.name}. Save durable decisions, conventions and gotchas with memory_write.`;
  const handoff = store.latestHandoff();
  const pinned = all.filter((m) => m.pinned && m.id !== handoff?.id);
  const rest = all.filter((m) => !m.pinned && m.type !== "handoff").slice(-INDEX_LIMIT);
  const lines = [`agentmem: ${all.length} memories for ${store.project.name}. Use memory_read for details, memory_write for new facts.`];
  if (handoff) lines.push("", handoffText(handoff));
  if (pinned.length) lines.push("", "Pinned:", ...pinned.map((m) => `${summary(m)}\n  ${m.body}`));
  if (rest.length) lines.push("", "Index:", ...rest.map(summary));
  if (all.some((m) => m.stale.length || m.changed.length))
    lines.push("", "Some memories reference files that are missing or changed since they were written: check them, then memory_update (re-verifies) or memory_delete.");
  return lines.join("\n");
}

export function handoffText(m) {
  const when = new Date(m.mtime).toISOString().slice(0, 16).replace("T", " ");
  return `Handoff from ${m.agent || "unknown"} (${when} UTC), continue from here:\n${m.title}\n${m.body}`;
}

export function fileContext(store, filePath, sessionId) {
  const seenFile = path.join(os.tmpdir(), `agentmem-seen-${sessionId || "none"}.json`);
  const seen = new Set(fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : []);
  const hits = store.forFile(filePath).filter((m) => !seen.has(m.id));
  if (!hits.length) return "";
  hits.forEach((m) => seen.add(m.id));
  fs.writeFileSync(seenFile, JSON.stringify([...seen]));
  return `agentmem memories linked to ${filePath}:\n${hits.map((m) => `${summary(m)}\n  ${m.body}`).join("\n")}`;
}

export function guardDecision(store, filePath) {
  const guards = store.guardsFor(filePath);
  if (!guards.length) return null;
  const blocking = guards.some((m) => m.guard === "block");
  const reasons = guards.map((m) => `${m.title}: ${m.body.replace(/\n+/g, " ")} (${m.id})`).join("\n");
  return {
    permissionDecision: blocking ? "deny" : "ask",
    permissionDecisionReason: `agentmem guardrail on ${store.relative(filePath)}:\n${reasons}`,
  };
}

export async function runHook(event) {
  if (process.env.AGENTMEM_CAPTURE) return;
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = raw.trim() ? JSON.parse(raw) : {};
  const store = new Store(input.cwd || process.cwd());

  if (event === "session-start") return output("SessionStart", sessionStartContext(store));
  if (event === "pre-tool-use") {
    const filePath = input.tool_input?.file_path || input.tool_input?.notebook_path;
    const decision = filePath && guardDecision(store, filePath);
    if (decision) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...decision } }));
    return;
  }
  if (event === "post-tool-use") {
    const filePath = input.tool_input?.file_path;
    return filePath && output("PostToolUse", fileContext(store, filePath, input.session_id));
  }
  if (event === "session-end") {
    if (!input.transcript_path) return;
    const entry = fileURLToPath(new URL("../bin/agentmem.js", import.meta.url));
    spawn(process.execPath, [entry, "capture", input.transcript_path], {
      cwd: input.cwd || process.cwd(),
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  throw new Error(`unknown hook event: ${event}`);
}
