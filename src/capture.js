import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TYPES } from "./store.js";

export function extractTranscript(file, maxChars = 40000) {
  const parts = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const role = entry.message?.role;
    if (entry.isMeta || (role !== "user" && role !== "assistant")) continue;
    const content = entry.message.content;
    const text =
      typeof content === "string" ? content : (content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (text.trim() && !text.startsWith("<")) parts.push(`${role.toUpperCase()}: ${text.trim()}`);
  }
  return parts.join("\n\n").slice(-maxChars);
}

export function buildPrompt(transcript, existingTitles) {
  return `You extract durable project memory from a coding session transcript.

Return ONLY a JSON array (no prose, no code fence). Each item: {"title": string, "content": string, "type": one of ${JSON.stringify(TYPES)}, "files": [repo-relative paths, optional]}.

Keep only facts that will still matter in a future session: decisions and why, project conventions, gotchas and their fixes, open todos. Skip chit-chat, one-off debugging steps, anything already in the existing list, and anything secret. At most 5 items. Return [] if nothing qualifies.

Existing memories:
${existingTitles.length ? existingTitles.map((t) => `- ${t}`).join("\n") : "(none)"}

Transcript:
${transcript}`;
}

export function parseItems(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  const items = JSON.parse(output.slice(start, end + 1));
  return Array.isArray(items) ? items.filter((i) => i && i.title && i.content) : [];
}

export function capture(store, transcriptPath, runModel = askClaude) {
  const transcript = extractTranscript(transcriptPath);
  if (transcript.length < 500) return { saved: [], skipped: ["transcript too short"] };
  const items = parseItems(runModel(buildPrompt(transcript, store.list().map((m) => m.title))));
  const saved = [];
  const skipped = [];
  for (const item of items) {
    try {
      saved.push(store.write({ ...item, type: TYPES.includes(item.type) ? item.type : "note", agent: "auto-capture" }));
    } catch (err) {
      skipped.push(`${item.title}: ${err.message}`);
    }
  }
  return { saved, skipped };
}

function askClaude(prompt) {
  return execFileSync(
    "claude",
    ["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--no-session-persistence"],
    {
      input: prompt,
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, AGENTMEM_CAPTURE: "1" },
    }
  );
}

export function logCapture(store, transcriptPath, result) {
  const line = `${new Date().toISOString()} ${path.basename(transcriptPath)} ${JSON.stringify(result)}\n`;
  fs.appendFileSync(path.join(store.dir, "capture.log"), line);
}
