import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { capture, extractTranscript, findConflicts, parseItems } from "../src/capture.js";
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
