import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildPrompt, capture, fixedFailures } from "../src/capture.js";
import { guardCheck, sessionStartContext } from "../src/hooks.js";
import { addOrg, pullOrgs, removeOrg } from "../src/org.js";
import { Store, summary } from "../src/store.js";
import { tmp } from "./helpers.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });

function repo(remote) {
  const dir = tmp();
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", remote);
  return dir;
}

test("org memories apply to projects of the same owner and are read-only", () => {
  const home = tmp();
  const orgRepo = tmp();
  git(orgRepo, "init", "-q");
  new Store(orgRepo, tmp()).write({ title: "Use UTC in the database", content: "Store timestamps as UTC.", scope: "team" });
  git(orgRepo, "add", ".");
  git(orgRepo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");

  addOrg(home, orgRepo);
  const ours = new Store(repo("git@github.com:acme/app.git"), home);
  const theirs = new Store(repo("https://github.com/other/app"), home);
  assert.equal(theirs.list().length, 0);
  assert.equal(ours.list().length, 0, "local path org repo has no owner match");

  const [cloned] = JSON.parse(fs.readFileSync(path.join(home, "org.json"), "utf8"));
  fs.writeFileSync(path.join(home, "org.json"), JSON.stringify([{ ...cloned, source: "https://github.com/acme/.agentmem" }]));
  const store = new Store(repo("git@github.com:acme/app.git"), home);
  const [m] = store.list();
  assert.equal(m.scope, "org");
  assert.match(summary(m), /\(org\)/);
  assert.throws(() => store.delete(m.id), /org memory/);
  assert.throws(() => store.update(m.id, { title: "x" }), /org memory/);
  assert.match(store.read(m.id), /UTC/);

  assert.equal(pullOrgs(home).length, 1);
  removeOrg(home, "https://github.com/acme/.agentmem");
  assert.equal(new Store(store.project.root, home).list().length, 0);
});

test("usage is counted and unused memories are flagged", () => {
  const store = new Store(tmp(), tmp());
  const a = store.write({ title: "Pinned rule", content: "x", pinned: true });
  const b = store.write({ title: "Rarely needed", content: "y" });
  sessionStartContext(store);
  sessionStartContext(store);
  const stats = store.stats();
  assert.equal(stats.find((m) => m.id === a).uses, 2);
  assert.equal(stats.find((m) => m.id === b).uses, 0);
  assert.equal(stats.find((m) => m.id === b).unused, false);
  const later = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  assert.equal(store.stats(later).find((m) => m.id === b).unused, true);
  assert.equal(store.stats(later).find((m) => m.id === a).unused, false);
});

test("guard check reports blocked and warned files", () => {
  const store = new Store(tmp(), tmp());
  store.write({ title: "Generated code", content: "Run codegen instead.", files: ["src/gen/**"], guard: "block" });
  store.write({ title: "Migrations", content: "Append only.", files: ["db/*.sql"], guard: "warn" });
  const hits = guardCheck(store, ["src/gen/api.ts", "db/001.sql", "README.md"]);
  assert.deepEqual(hits.map((h) => [h.file, h.level]), [["src/gen/api.ts", "error"], ["db/001.sql", "warning"]]);
});

test("failed commands fixed by edits become gotcha hints", () => {
  const store = new Store(tmp(), tmp());
  const file = path.join(tmp(), "t.jsonl");
  const use = (id, name, input) => ({ message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  const result = (id, content, is_error) => ({ message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
  const src = path.join(store.project.root, "src/db.js");
  fs.writeFileSync(
    file,
    [
      use("1", "Bash", { command: "npm  test" }),
      result("1", "Exit code 1\nTypeError: pool is undefined", true),
      use("2", "Read", { file_path: path.join(store.project.root, "README.md") }),
      use("3", "Edit", { file_path: src }),
      result("3", "ok"),
      use("4", "Bash", { command: "npm test" }),
      result("4", "all passed"),
      use("5", "Bash", { command: "ls nope" }),
      result("5", "Exit code 2", true),
      use("6", "Bash", { command: "ls nope" }),
      result("6", "ok"),
    ]
      .map((e) => JSON.stringify(e))
      .join("\n")
  );
  const fixes = fixedFailures(file);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].command, "npm test");
  assert.deepEqual(fixes[0].files, [src]);
  assert.match(buildPrompt("t", [], [{ ...fixes[0], files: ["src/db.js"] }]), /`npm test` failed with:[\s\S]*pool is undefined[\s\S]*src\/db\.js/);

  const seen = [];
  capture(store, file, (prompt) => (seen.push(prompt), "[]"));
  assert.match(seen[0], /fixed by changing: src\/db\.js/);
});
