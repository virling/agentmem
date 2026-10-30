import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildPrPrompt, prFromEvent, savePrMemories } from "../src/pr-capture.js";
import { Store } from "../src/store.js";
import { tmp } from "./helpers.js";

const pr = {
  number: 42,
  title: "Switch dates to ISO strings",
  body: "Mobile app crashed on unix timestamps.",
  author: "dev",
  comments: [{ author: "lead", body: "(src/api.ts) Agreed, never send numbers for dates again." }],
  files: ["src/api.ts", "src/dates.ts"],
};

test("PR prompt includes description, files, discussion and existing titles", () => {
  const prompt = buildPrPrompt(pr, ["Uses Postgres"]);
  assert.match(prompt, /#42: Switch dates to ISO strings/);
  assert.match(prompt, /Mobile app crashed/);
  assert.match(prompt, /src\/dates\.ts/);
  assert.match(prompt, /@lead: \(src\/api\.ts\) Agreed/);
  assert.match(prompt, /- Uses Postgres/);
  assert.doesNotMatch(prompt, /"handoff"/);
});

test("PR memories are saved as team memories linked to changed files only", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "x"), "");
  const store = new Store(root, tmp());
  const output = JSON.stringify([
    { title: "API dates are ISO 8601 strings", content: "Never unix numbers.", type: "decision", files: ["src/api.ts", "src/other.ts"] },
    { title: "Leaked", content: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
  ]);
  const result = savePrMemories(store, pr, output);
  assert.equal(result.saved.length, 1);
  assert.equal(result.skipped.length, 1);
  const [m] = store.list();
  assert.equal(m.scope, "team");
  assert.equal(m.agent, "pr-42");
  assert.deepEqual(m.files, ["src/api.ts"]);
  assert.match(m.body, /Source: pull request #42/);
  assert.ok(fs.existsSync(path.join(root, ".agentmem", `${m.id}.md`)));
});

test("prFromEvent reads number and merged flag", () => {
  const file = path.join(tmp(), "event.json");
  fs.writeFileSync(file, JSON.stringify({ pull_request: { number: 7, merged: true } }));
  assert.deepEqual(prFromEvent(file), { number: 7, merged: true });
  fs.writeFileSync(file, JSON.stringify({ issue: {} }));
  assert.throws(() => prFromEvent(file), /pull_request events/);
});
