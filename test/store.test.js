import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Store } from "../src/store.js";
import { tmp } from "./helpers.js";

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
