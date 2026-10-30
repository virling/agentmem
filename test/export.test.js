import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { exportRules, renderRules, upsertBlock } from "../src/export.js";
import { Store } from "../src/store.js";
import { tmp } from "./helpers.js";

test("upsertBlock appends once and replaces on later runs", () => {
  const first = upsertBlock("# My rules\n", "one");
  assert.match(first, /^# My rules\n\n<!-- agentmem:start -->\none\n<!-- agentmem:end -->\n$/);
  const second = upsertBlock(first, "two");
  assert.equal(second.match(/agentmem:start/g).length, 1);
  assert.match(second, /two/);
  assert.doesNotMatch(second, /one/);
});

test("renderRules groups by type and lists guardrails first", () => {
  const text = renderRules([
    { type: "convention", title: "Use pnpm", body: "Not npm.", files: [] },
    { type: "todo", title: "Fix flaky test", body: "x", files: [] },
    { type: "convention", title: "Generated", body: "Run codegen.", files: ["src/gen/**"], guard: "block" },
  ]);
  assert.match(text, /### Guardrails\n- Never edit `src\/gen\/\*\*`: Generated\. Run codegen\./);
  assert.match(text, /### Conventions\n- \*\*Use pnpm\*\*: Not npm\./);
  assert.doesNotMatch(text, /flaky/);
});

test("exportRules writes only team memories unless local is included", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agents\n\nKeep this.\n");
  const store = new Store(root, tmp());
  store.write({ title: "Team rule", content: "shared", type: "convention", scope: "team" });
  store.write({ title: "My local rule", content: "private", type: "convention" });
  assert.deepEqual(exportRules(store, ["agents", "cursor"]), ["AGENTS.md", ".cursor/rules/agentmem.mdc"]);
  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /Keep this\.[\s\S]*Team rule/);
  assert.doesNotMatch(agents, /private/);
  assert.match(fs.readFileSync(path.join(root, ".cursor/rules/agentmem.mdc"), "utf8"), /^---\ndescription:[\s\S]*alwaysApply: true/);
  exportRules(store, ["agents"], { includeLocal: true });
  assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /private/);
  assert.throws(() => exportRules(store, ["bogus"]), /unknown target/);
});
