import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TYPES } from "./store.js";

const CHUNK_CHARS = 200000;
const MAX_CHUNKS = 4;

export function extractTranscript(file, maxChars = CHUNK_CHARS * MAX_CHUNKS) {
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

export function chunks(text, size = CHUNK_CHARS) {
  const out = [];
  let cur = "";
  for (const part of text.split("\n\n")) {
    if (cur && cur.length + part.length + 2 > size) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${part}` : part;
  }
  return [...out, cur];
}

function resultText(content) {
  return typeof content === "string" ? content : (content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

export function fixedFailures(file) {
  const uses = new Map();
  const failing = new Map();
  const fixes = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type === "tool_use") {
        uses.set(c.id, c);
        const edited = c.input?.file_path || c.input?.notebook_path;
        if (edited && c.name !== "Read") for (const f of failing.values()) f.files.add(edited);
      }
      const use = c.type === "tool_result" && uses.get(c.tool_use_id);
      if (!use || use.name !== "Bash" || !use.input?.command) continue;
      const key = use.input.command.trim().replace(/\s+/g, " ");
      if (c.is_error) {
        if (!failing.has(key)) failing.set(key, { command: key, error: resultText(c.content).slice(0, 500), files: new Set() });
      } else if (failing.has(key)) {
        const f = failing.get(key);
        if (f.files.size) fixes.push({ ...f, files: [...f.files] });
        failing.delete(key);
      }
    }
  }
  return fixes;
}

export function buildPrompt(transcript, existingTitles, fixes = [], part = null) {
  return `You extract durable project memory from a coding session transcript.
${part ? `\nThe session is long, so this is part ${part.n} of ${part.of}, in order.\n` : ""}
Return ONLY a JSON array (no prose, no code fence). Each item: {"title": string, "content": string, "type": one of ${JSON.stringify(TYPES)}, "files": [repo-relative paths, optional]}.

Keep only facts that will still matter in a future session: decisions and why, project conventions, gotchas and their fixes, open todos. Skip chit-chat, one-off debugging steps, anything already in the existing list, and anything secret. At most 5 items.

If the session ended with work unfinished, add one extra item with type "handoff": title "Handoff: <task>", content saying what is done, then "Next steps:" and the remaining steps in order. Skip it if the work was finished.

Return [] if nothing qualifies.
${
  fixes.length
    ? `
These commands failed, then passed after the listed files were changed. Each is a strong candidate for a "gotcha": what broke, why, and the fix, with "files" set to the changed files. Skip any that were only a typo.
${fixes.map((f) => `- \`${f.command}\` failed with:\n  ${f.error.replace(/\n+/g, "\n  ")}\n  fixed by changing: ${f.files.join(", ")}`).join("\n")}
`
    : ""
}
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

export function subagentTranscripts(transcriptPath) {
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ""), "subagents");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().map((f) => path.join(dir, f)) : [];
}

export function capture(store, transcriptPath, runModel = askClaude) {
  const subagents = subagentTranscripts(transcriptPath);
  // Subagent text goes first so the main session survives the length cut.
  const transcript = [...subagents.map((f) => `SUBAGENT SESSION:\n${extractTranscript(f)}`), extractTranscript(transcriptPath)]
    .join("\n\n")
    .slice(-CHUNK_CHARS * MAX_CHUNKS);
  const fixes = [...subagents, transcriptPath].flatMap(fixedFailures).map((f) => ({ ...f, files: f.files.map((p) => store.relative(p)) }));
  if (transcript.length < 500 && !fixes.length) return { saved: [], skipped: ["transcript too short"] };
  const parts = chunks(transcript).slice(-MAX_CHUNKS);
  const saved = [];
  const skipped = [];
  for (const [i, text] of parts.entries()) {
    const last = i === parts.length - 1;
    const part = parts.length > 1 ? { n: i + 1, of: parts.length } : null;
    const items = parseItems(runModel(buildPrompt(text, store.list().map((m) => m.title), last ? fixes : [], part)));
    for (const item of items.filter((it) => last || it.type !== "handoff")) {
      try {
        saved.push(store.write({ ...item, type: TYPES.includes(item.type) ? item.type : "note", agent: "auto-capture" }));
      } catch (err) {
        skipped.push(`${item.title}: ${err.message}`);
      }
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
