import assert from "node:assert/strict";
import { test } from "node:test";
import { addHooks, serverCommand, setJsonServer, setTomlServer } from "../src/install.js";

test("addHooks is idempotent and keeps existing hooks", () => {
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x.sh" }] }] } };
  assert.deepEqual(addHooks(settings, "node /opt/agentmem/bin/agentmem.js"), ["SessionStart", "PreToolUse", "PostToolUse", "SessionEnd"]);
  assert.deepEqual(addHooks(settings, "node /opt/agentmem/bin/agentmem.js"), []);
  assert.deepEqual(
    settings.hooks.PreToolUse.map((g) => g.matcher),
    ["Bash", "Edit|Write|MultiEdit|NotebookEdit"]
  );
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "x.sh");
  assert.equal(settings.hooks.PostToolUse[0].matcher, "Read|Edit|Write|MultiEdit");
});

test("addHooks repoints hooks from an old install path", () => {
  const settings = {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node /old/index.js hook session-start", timeout: 10 }] }] },
  };
  assert.deepEqual(addHooks(settings, "npx -y agentmem"), ["SessionStart", "PreToolUse", "PostToolUse", "SessionEnd"]);
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, "npx -y agentmem hook session-start");
});

test("serverCommand uses npx when run from the npx cache", () => {
  assert.deepEqual(serverCommand("/home/u/.npm/_npx/abc/node_modules/pkg/bin/agentmem.js", "@v/pkg"), {
    command: "npx",
    args: ["-y", "@v/pkg", "mcp"],
  });
  assert.deepEqual(serverCommand("/usr/lib/node_modules/pkg/bin/agentmem.js", "@v/pkg"), {
    command: "node",
    args: ["/usr/lib/node_modules/pkg/bin/agentmem.js", "mcp"],
  });
});

test("setJsonServer keeps other servers", () => {
  const data = setJsonServer({ mcpServers: { other: { command: "x" } }, theme: "dark" }, { command: "node", args: ["a"] });
  assert.deepEqual(Object.keys(data.mcpServers), ["other", "agentmem"]);
  assert.equal(data.theme, "dark");
});

test("setTomlServer replaces only the agentmem block", () => {
  const server = { command: "node", args: ["/a/bin/agentmem.js", "mcp"] };
  const before = 'model = "o3"\n\n[mcp_servers.agentmem]\ncommand = "old"\nargs = []\n\n[mcp_servers.other]\ncommand = "x"\n';
  const after = setTomlServer(before, server);
  assert.match(after, /model = "o3"/);
  assert.match(after, /\[mcp_servers\.other\]\ncommand = "x"/);
  assert.equal(after.match(/\[mcp_servers\.agentmem\]/g).length, 1);
  assert.match(after, /args = \["\/a\/bin\/agentmem.js","mcp"\]/);
  assert.equal(setTomlServer("", server), setTomlServer(setTomlServer("", server), server));
});

test("VS Code and OpenCode configs use their own formats", async () => {
  const { setVscodeServer, setOpencodeServer } = await import("../src/install.js");
  const server = { command: "node", args: ["/a/bin/agentmem.js", "mcp"] };
  assert.deepEqual(setVscodeServer({ servers: { x: {} } }, server).servers.agentmem, { type: "stdio", ...server });
  assert.deepEqual(setOpencodeServer({ $schema: "s" }, server), {
    $schema: "s",
    mcp: { agentmem: { type: "local", command: ["node", "/a/bin/agentmem.js", "mcp"], enabled: true } },
  });
});
