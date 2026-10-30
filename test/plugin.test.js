import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));

test("plugin and marketplace versions match package.json", () => {
  const { version } = read("package.json");
  assert.equal(read(".claude-plugin/plugin.json").version, version);
  assert.equal(read(".claude-plugin/marketplace.json").plugins[0].version, version);
});

test("plugin hooks cover the same events as agentmem install", async () => {
  const { addHooks } = await import("../src/install.js");
  const settings = {};
  addHooks(settings, "node x");
  assert.deepEqual(Object.keys(read("hooks/hooks.json").hooks).sort(), Object.keys(settings.hooks).sort());
});
