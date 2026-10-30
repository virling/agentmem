import assert from "node:assert/strict";
import { test } from "node:test";
import { addHooks } from "../src/install.js";

test("addHooks is idempotent and keeps existing hooks", () => {
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x.sh" }] }] } };
  assert.deepEqual(addHooks(settings, "/opt/agentmem/index.js"), ["SessionStart", "PostToolUse", "SessionEnd"]);
  assert.deepEqual(addHooks(settings, "/opt/agentmem/index.js"), []);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PostToolUse[0].matcher, "Read|Edit|Write|MultiEdit");
});

test("addHooks repoints hooks from an old install path", () => {
  const settings = {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node /old/index.js hook session-start", timeout: 10 }] }] },
  };
  assert.deepEqual(addHooks(settings, "/new/bin/agentmem.js"), ["SessionStart", "PostToolUse", "SessionEnd"]);
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, "node /new/bin/agentmem.js hook session-start");
});
