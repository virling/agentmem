import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Store, globToRegex } from "../src/store.js";
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

test("team scope lives in the repo and promote moves local memories there", () => {
  const root = tmp();
  const store = new Store(root, tmp());
  const local = store.write({ title: "Local idea", content: "x" });
  const team = store.write({ title: "Deploy on Fridays", content: "y", scope: "team" });
  assert.ok(fs.existsSync(path.join(root, ".agentmem", `${team}.md`)));
  assert.deepEqual(
    store.list().map((m) => [m.id, m.scope]),
    [
      [team, "team"],
      [local, "local"],
    ].sort((a, b) => a[0].localeCompare(b[0]))
  );
  store.promote(local);
  assert.ok(fs.existsSync(path.join(root, ".agentmem", `${local}.md`)));
  assert.throws(() => store.promote(local), /already a team memory/);
  assert.throws(() => store.write({ title: "z", content: "z", scope: "global" }), /scope must be/);
  store.update(team, { content: "updated" });
  assert.match(store.read(team), /updated/);
  store.delete(team);
  assert.equal(store.list().length, 1);
});

test("changed files are flagged until the memory is verified", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "api.ts"), "v1");
  const store = new Store(root, tmp());
  const id = store.write({ title: "API returns JSON", content: "x", files: ["api.ts"] });
  assert.deepEqual(store.list()[0].changed, []);
  fs.writeFileSync(path.join(root, "api.ts"), "v2");
  assert.deepEqual(store.list()[0].changed, ["api.ts"]);
  store.update(id, {});
  assert.deepEqual(store.list()[0].changed, []);
});

test("glob patterns match files and guards are found", () => {
  assert.ok(globToRegex("src/gen/**").test("src/gen/a/b.ts"));
  assert.ok(globToRegex("**/*.lock").test("pnpm.lock"));
  assert.ok(globToRegex("**/*.lock").test("a/b/yarn.lock"));
  assert.ok(!globToRegex("src/*.ts").test("src/a/b.ts"));
  const store = new Store(tmp(), tmp());
  store.write({ title: "Generated code", content: "Run codegen instead.", files: ["src/gen/**"], guard: "block" });
  store.write({ title: "Gen notes", content: "n", files: ["src/gen/**"] });
  assert.equal(store.guardsFor("src/gen/api/client.ts").length, 1);
  assert.equal(store.guardsFor("src/app.ts").length, 0);
  assert.deepEqual(store.list().find((m) => m.guard).stale, []);
  assert.throws(() => store.write({ title: "g", content: "g", guard: "maybe" }), /guard must be/);
});

test("related finds memories on the same topic or files", () => {
  const store = new Store(tmp(), tmp());
  store.write({ title: "Use npm for installs", content: "Run npm install in CI", type: "convention" });
  store.write({ title: "Postgres version", content: "pg 16", files: ["db.ts"] });
  const related = store.related({ title: "Switch installs to pnpm", content: "Run pnpm install in CI" });
  assert.deepEqual(related.map((m) => m.title), ["Use npm for installs"]);
  assert.equal(store.related({ title: "x", content: "y", files: ["db.ts"] })[0].title, "Postgres version");
});

test("npm tokens are treated as secrets", () => {
  const store = new Store(tmp(), tmp());
  assert.throws(() => store.write({ title: "t", content: "npm_G9lqHZhaeXeqo5ZHwX2k5SeqNNrymm0b04Cx" }), /secret/);
});
