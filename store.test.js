import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { capture, extractTranscript, parseItems } from "./capture.js";
import { fileContext, sessionStartContext } from "./hooks.js";
import { Store } from "./store.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agentmem-"));

test("write, list, search, read, delete", () => {
  const store = new Store(tmp(), tmp());
  const id = store.write({ title: "Auth uses JWT", content: "Tokens expire in 15 min.", type: "decision", agent: "test" });
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].type, "decision");
  assert.equal(store.search("jwt expire")[0].id, id);
  assert.equal(store.search("graphql").length, 0);
  assert.match(store.read(id), /15 min/);
  store.delete(id);
  assert.equal(store.list().length, 0);
});

test("same title on same day gets unique ids with force", () => {
  const store = new Store(tmp(), tmp());
  const a = store.write({ title: "x", content: "1" });
  const b = store.write({ title: "x", content: "2", force: true });
  assert.notEqual(a, b);
});

test("rejects unknown type", () => {
  const store = new Store(tmp(), tmp());
  assert.throws(() => store.write({ title: "x", content: "y", type: "bogus" }));
});

test("rejects secrets on write and update", () => {
  const store = new Store(tmp(), tmp());
  assert.throws(() => store.write({ title: "key", content: "use sk-ant-abcdefghijklmnopqrstuvwxyz123" }), /secret/);
  assert.throws(() => store.write({ title: "aws", content: "AKIAABCDEFGHIJKLMNOP" }), /secret/);
  const id = store.write({ title: "ok", content: "fine" });
  assert.throws(() => store.update(id, { content: "-----BEGIN RSA PRIVATE KEY-----" }), /secret/);
});

test("duplicate titles are refused unless forced", () => {
  const store = new Store(tmp(), tmp());
  store.write({ title: "Use pnpm for installs", content: "a" });
  assert.throws(() => store.write({ title: "use PNPM for installs!", content: "b" }), /similar memory/);
  assert.doesNotThrow(() => store.write({ title: "use PNPM for installs!", content: "b", force: true }));
  assert.doesNotThrow(() => store.write({ title: "Deploy runs on Fridays", content: "c" }));
});

test("update changes only given fields", () => {
  const store = new Store(tmp(), tmp());
  const id = store.write({ title: "Old", content: "body", type: "note", tags: ["a"] });
  store.update(id, { title: "New", pinned: true });
  const m = store.list()[0];
  assert.equal(m.title, "New");
  assert.equal(m.body, "body");
  assert.equal(m.pinned, true);
  assert.deepEqual(m.tags, ["a"]);
  assert.ok(m.updated);
});

test("stale detection and file linking", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "app.js"), "");
  const store = new Store(root, tmp());
  const live = store.write({ title: "App entry", content: "x", files: ["app.js"] });
  store.write({ title: "Old module", content: "y", files: "gone.js, app.js" });
  const byId = Object.fromEntries(store.list().map((m) => [m.id, m]));
  assert.deepEqual(byId[live].stale, []);
  assert.ok(Object.values(byId).some((m) => m.stale.includes("gone.js")));
  assert.equal(store.forFile(path.join(store.project.root, "app.js")).length, 2);
  assert.equal(store.forFile("app.js").length, 2);
});

test("session start context shows pinned bodies and index", () => {
  const store = new Store(tmp(), tmp());
  assert.match(sessionStartContext(store), /no memories yet/);
  store.write({ title: "Always run lint", content: "npm run lint before commit", pinned: true });
  store.write({ title: "Uses Postgres", content: "pg 16" });
  const ctx = sessionStartContext(store);
  assert.match(ctx, /Pinned:[\s\S]*npm run lint/);
  assert.match(ctx, /Index:[\s\S]*Uses Postgres/);
  assert.doesNotMatch(ctx, /pg 16/);
});

test("file context shows each memory once per session", () => {
  const root = tmp();
  const store = new Store(root, tmp());
  store.write({ title: "Auth notes", content: "careful", files: ["src/auth.ts"] });
  const session = `test-${Date.now()}`;
  assert.match(fileContext(store, path.join(store.project.root, "src/auth.ts"), session), /careful/);
  assert.equal(fileContext(store, "src/auth.ts", session), "");
});

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

test("addHooks is idempotent and keeps existing hooks", async () => {
  const { addHooks } = await import("./install.js");
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x.sh" }] }] } };
  assert.deepEqual(addHooks(settings, "/opt/agentmem/index.js"), ["SessionStart", "PostToolUse", "SessionEnd"]);
  assert.deepEqual(addHooks(settings, "/opt/agentmem/index.js"), []);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PostToolUse[0].matcher, "Read|Edit|Write|MultiEdit");
});
