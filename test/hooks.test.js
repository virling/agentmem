import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileContext, guardDecision, sessionStartContext } from "../src/hooks.js";
import { Store } from "../src/store.js";
import { tmp } from "./helpers.js";

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

test("guard decision denies blocked files and asks for warned files", () => {
  const store = new Store(tmp(), tmp());
  assert.equal(guardDecision(store, "src/a.ts"), null);
  store.write({ title: "Migrations are append-only", content: "Add a new migration.", files: ["db/migrations/*.sql"], guard: "warn" });
  assert.equal(guardDecision(store, "db/migrations/001.sql").permissionDecision, "ask");
  store.write({ title: "Never touch vendored code", content: "Patch upstream.", files: ["vendor/**"], guard: "block" });
  const deny = guardDecision(store, path.join(store.project.root, "vendor/lib/x.js"));
  assert.equal(deny.permissionDecision, "deny");
  assert.match(deny.permissionDecisionReason, /vendor\/lib\/x\.js[\s\S]*Patch upstream/);
});

test("guards match through symlinked project paths", () => {
  const real = tmp();
  const link = path.join(tmp(), "link");
  fs.symlinkSync(real, link);
  const store = new Store(real, tmp());
  store.write({ title: "No vendor edits", content: "Patch upstream.", files: ["vendor/**"], guard: "block" });
  assert.equal(guardDecision(store, path.join(link, "vendor/new-file.js")).permissionDecision, "deny");
});

test("latest handoff is shown first and replaces older ones", async () => {
  const { writeHandoff } = await import("../src/mcp.js");
  const store = new Store(tmp(), tmp());
  store.write({ title: "Uses Postgres", content: "pg 16" });
  writeHandoff(store, { summary: "Old work", next_steps: "old", agent: "claude-code" });
  writeHandoff(store, { summary: "Refactored auth middleware", next_steps: "1. Add tests\n2. Update docs", agent: "claude-code" });
  const handoffs = store.list().filter((m) => m.type === "handoff");
  assert.equal(handoffs.length, 1);
  const ctx = sessionStartContext(store);
  assert.match(ctx, /Handoff from claude-code[\s\S]*Refactored auth middleware[\s\S]*Next steps:\n1\. Add tests/);
  assert.ok(ctx.indexOf("Handoff from") < ctx.indexOf("Index:"));
  assert.doesNotMatch(ctx, /Old work/);
});
