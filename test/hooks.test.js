import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileContext, sessionStartContext } from "../src/hooks.js";
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
