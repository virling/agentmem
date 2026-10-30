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

Keep only facts that will still matter in a future session: decisions and why, project conventions, gotchas and their fixes, open todos. Skip chit-chat, one-off debugging steps, anything already in the existing list, and anything secret. At most 5 items.

If the session ended with work unfinished, add one extra item with type "handoff": title "Handoff: <task>", content saying what is done, then "Next steps:" and the remaining steps in order. Skip it if the work was finished.

Return [] if nothing qualifies.

Existing memories:
${existingTitles.length ? existingTitles.map((t) => `- ${t}`).join("\n") : "(none)"}

Transcript:
${transcript}`;
}

export function parseItems(output, raw = false) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  const items = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(items)) return [];
  return raw ? items.filter(Boolean) : items.filter((i) => i && i.title && i.content);
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

export function askClaude(prompt) {
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

export function findConflicts(store, runModel = askClaude) {
  const all = store.list();
  if (all.length < 2) return [];
  const listing = all.map((m) => `[${m.id}] (${m.type}) ${m.title}: ${m.body.replace(/\n+/g, " ")}`).join("\n");
  const prompt = `Find pairs of project memories that contradict each other (they cannot both be true or both be followed).

Return ONLY a JSON array (no prose, no code fence). Each item: {"ids": [id1, id2], "reason": one short sentence}. Return [] if none.

Memories:
${listing}`;
  const known = new Set(all.map((m) => m.id));
  return parseItems(runModel(prompt), true).filter(
    (c) => Array.isArray(c.ids) && c.ids.length === 2 && c.ids.every((id) => known.has(id))
  );
}

export function logCapture(store, transcriptPath, result) {
  const line = `${new Date().toLocaleString("sv")} ${path.basename(transcriptPath)} ${JSON.stringify(result)}\n`;
  fs.appendFileSync(path.join(store.dir, "capture.log"), line);
}
