import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Store, globToRegex, repoOfFiles } from "../src/store.js";
import { tmp } from "./helpers.js";

const bin = new URL("../bin/agentmem.js", import.meta.url).pathname;

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

test("a git worktree shares the main checkout's store", () => {
  const repo = path.join(tmp(), "proj");
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  git("worktree", "add", "-q", path.join(repo, ".claude", "worktrees", "agent-1"));
  const home = tmp();
  const main = new Store(repo, home);
  const wt = new Store(path.join(repo, ".claude", "worktrees", "agent-1"), home);
  assert.equal(wt.project.id, main.project.id);
  assert.equal(wt.project.root, fs.realpathSync(path.join(repo, ".claude", "worktrees", "agent-1")));
});

test("files in another git repo pick that repo and are stored relative to it", () => {
  const other = fs.realpathSync(tmp());
  execFileSync("git", ["init", "-q"], { cwd: other });
  fs.mkdirSync(path.join(other, "src"));
  fs.writeFileSync(path.join(other, "src", "a.js"), "1");
  const file = path.join(other, "src", "a.js");
  const plain = fs.realpathSync(tmp());
  fs.writeFileSync(path.join(plain, "b.js"), "1");
  assert.equal(repoOfFiles([file], "/elsewhere"), other);
  assert.equal(repoOfFiles([file], other), undefined);
  assert.equal(repoOfFiles(["src/a.js"], "/elsewhere"), undefined);
  assert.equal(repoOfFiles(file, "/elsewhere"), undefined);
  assert.equal(repoOfFiles([path.join(plain, "b.js")], "/elsewhere"), undefined);
  const store = new Store(other, tmp());
  const id = store.write({ title: "Routed", content: "x", files: [file] });
  assert.match(store.read(id), /files: src\/a\.js/);
  store.update(id, { files: [file] });
  assert.equal(store.forFile("src/a.js").length, 1);
});

test("captured items about another repo's files are saved in that repo", async () => {
  const { capture } = await import("../src/capture.js");
  const home = tmp();
  const here = new Store(tmp(), home);
  const other = fs.realpathSync(tmp());
  execFileSync("git", ["init", "-q"], { cwd: other });
  fs.writeFileSync(path.join(other, "a.js"), "1");
  const transcript = path.join(tmp(), "s.jsonl");
  fs.writeFileSync(transcript, JSON.stringify({ message: { role: "user", content: "x".repeat(600) } }));
  const out = JSON.stringify([{ title: "Other repo fact", content: "y", type: "gotcha", files: [path.join(other, "a.js")] }, { title: "Here fact", content: "z", type: "note" }]);
  const { saved } = capture(here, transcript, () => out);
  assert.equal(saved.length, 2);
  assert.deepEqual(here.list().map((m) => m.title), ["Here fact"]);
  assert.deepEqual(new Store(other, home).list().map((m) => [m.title, m.files.join()]), [["Other repo fact", "a.js"]]);
});

test("memory_handoff deletes resolved todos only and lists the open ones", () => {
  const home = tmp();
  const dir = fs.realpathSync(tmp());
  const store = new Store(dir, home);
  const done = store.write({ title: "Ship the thing", content: "x", type: "todo" });
  store.write({ title: "Write docs for the thing", content: "x", type: "todo" });
  const decision = store.write({ title: "Use tabs", content: "x", type: "decision" });
  const msg = (body) =>
    execFileSync("node", [bin, "mcp"], {
      cwd: dir,
      env: { ...process.env, AGENTMEM_HOME: home },
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memory_handoff", arguments: body } })}\n`,
      encoding: "utf8",
    });
  const out = msg({ summary: "s", next_steps: "n", resolves: [done, decision, "nope"] });
  assert.match(out, new RegExp(`Deleted finished todos: ${done}`));
  assert.match(out, /Not open todos, left alone: .*use-tabs, nope/);
  assert.match(out, /Open todos.*\\n.*Write docs for the thing/);
  assert.deepEqual(store.list().map((m) => m.type).sort(), ["decision", "handoff", "todo"]);
});

test("a refused handoff keeps the todos it would resolve", () => {
  const home = tmp();
  const dir = fs.realpathSync(tmp());
  const store = new Store(dir, home);
  const todo = store.write({ title: "Ship the thing", content: "x", type: "todo" });
  const args = { summary: "token sk-abcdefghijklmnopqrstuvwxyz123456", next_steps: "n", resolves: [todo] };
  const out = execFileSync("node", [bin, "mcp"], {
    cwd: dir,
    env: { ...process.env, AGENTMEM_HOME: home },
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memory_handoff", arguments: args } })}\n`,
    encoding: "utf8",
  });
  assert.match(out, /secret/);
  assert.deepEqual(store.list().map((m) => m.id), [todo]);
});

test("memory_update with absolute files stays in the current store", () => {
  const home = tmp();
  const dir = fs.realpathSync(tmp());
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const other = fs.realpathSync(tmp());
  execFileSync("git", ["init", "-q"], { cwd: other });
  fs.writeFileSync(path.join(other, "a.js"), "1");
  const store = new Store(dir, home);
  const id = store.write({ title: "Local fact", content: "x" });
  const args = { id, files: [path.join(other, "a.js")] };
  const out = execFileSync("node", [bin, "mcp"], {
    cwd: dir,
    env: { ...process.env, AGENTMEM_HOME: home },
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memory_update", arguments: args } })}\n`,
    encoding: "utf8",
  });
  assert.match(out, new RegExp(`Updated ${id}`));
});
