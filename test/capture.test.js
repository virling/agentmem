import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { capture, chunks, extractTranscript, findConflicts, parseItems, subagentTranscripts } from "../src/capture.js";
import { Store } from "../src/store.js";
import { tmp } from "./helpers.js";

test("capture extracts transcript and saves model items", () => {
  const store = new Store(tmp(), tmp());
  const file = path.join(tmp(), "t.jsonl");
  const filler = "We discussed the build setup at length. ".repeat(20);
  fs.writeFileSync(
    file,
    [
      { type: "user", message: { role: "user", content: `Switch to pnpm please. ${filler}` } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done, switched." }, { type: "tool_use" }] } },
      { type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" } },
      { type: "system", content: "ignored" },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n")
  );
  const text = extractTranscript(file);
  assert.match(text, /USER: Switch to pnpm/);
  assert.match(text, /ASSISTANT: Done, switched/);
  assert.doesNotMatch(text, /command-name|ignored/);

  const fake = () => 'Here: [{"title":"Repo uses pnpm","content":"Not npm.","type":"convention"},{"title":"bad","content":"sk-abcdefghijklmnopqrstuvwxyz"}]';
  const result = capture(store, file, fake);
  assert.equal(result.saved.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(store.list()[0].agent, "auto-capture");
});
test("long sessions are captured in parts with the handoff from the last part only", () => {
  assert.deepEqual(chunks("aa\n\nbb\n\ncc", 6), ["aa\n\nbb", "cc"]);
  const store = new Store(tmp(), tmp());
  const file = path.join(tmp(), "t.jsonl");
  const msg = (i) => JSON.stringify({ message: { role: "user", content: `Message ${i} ${"x".repeat(50000)}` } });
  fs.writeFileSync(file, Array.from({ length: 20 }, (_, i) => msg(i)).join("\n"));
  const facts = ["Use pnpm workspaces", "Deploy only from tags", "Redis caches sessions", "Logs go to stdout"];
  const prompts = [];
  const fake = (prompt) => {
    const n = prompts.push(prompt);
    return JSON.stringify([
      { title: facts[n - 1], content: "x", type: "decision" },
      { title: `Handoff part ${n}`, content: "Next steps: y", type: "handoff" },
    ]);
  };
  capture(store, file, fake);
  assert.equal(prompts.length, 4);
  assert.match(prompts[0], /part 1 of 4/);
  assert.match(prompts[3], /Message 19/);
  assert.match(prompts[3], /Redis caches sessions/);
  const titles = store.list().map((m) => m.title);
  assert.deepEqual(titles.filter((t) => t.startsWith("Handoff")), ["Handoff part 4"]);
  assert.deepEqual(titles.filter((t) => facts.includes(t)).sort(), [...facts].sort());
});

test("subagent sessions are captured before the main session", () => {
  const store = new Store(tmp(), tmp());
  const dir = tmp();
  const file = path.join(dir, "s1.jsonl");
  const say = (text) => JSON.stringify({ message: { role: "assistant", content: text } });
  fs.writeFileSync(file, say(`Main session work. ${"m".repeat(600)}`));
  fs.mkdirSync(path.join(dir, "s1", "subagents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "s1", "subagents", "agent-a.jsonl"), say("Subagent found the flaky tar pipe."));
  assert.equal(subagentTranscripts(file).length, 1);
  let prompt = "";
  capture(store, file, (p) => ((prompt = p), "[]"));
  assert.match(prompt, /SUBAGENT SESSION:\nASSISTANT: Subagent found the flaky tar pipe\.[\s\S]*Main session work/);
});

test("parseItems handles junk", () => {
  assert.deepEqual(parseItems("nothing here"), []);
  assert.deepEqual(parseItems("[]"), []);
});

test("findConflicts keeps only pairs of known ids", () => {
  const store = new Store(tmp(), tmp());
  const a = store.write({ title: "Use npm", content: "npm only" });
  const b = store.write({ title: "Package manager is pnpm", content: "pnpm only" });
  const fake = (prompt) => {
    assert.match(prompt, /pnpm only[\s\S]*npm only/);
    return JSON.stringify([{ ids: [a, b], reason: "different package managers" }, { ids: [a, "ghost"], reason: "x" }]);
  };
  assert.deepEqual(findConflicts(store, fake), [{ ids: [a, b], reason: "different package managers" }]);
});
