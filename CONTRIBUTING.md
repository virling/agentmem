# Contributing to agentmem

Thanks for helping. This guide covers setup, the code layout, and what a good pull request looks like.

## Ground rules

- **No runtime dependencies.** agentmem must stay installable with a plain `git clone`. If a feature truly needs a package, open an issue first.
- **Node 18+, ES modules, no build step.**
- **Small pull requests.** One logical change per PR.
- **Tests for behaviour changes.** Use the built-in `node:test` runner. Do not add another test framework.
- **Never log or store secrets.** New write paths must go through `Store.checkSecrets`.

## Setup

```bash
git clone https://github.com/<you>/agentmem.git
cd agentmem
npm test
```

Use a throwaway store while developing so you do not touch your real memories:

```bash
export AGENTMEM_HOME=$(mktemp -d)
node bin/agentmem.js add "Test" "Hello" --type note
node bin/agentmem.js list
```

## Code layout

```
agentmem/
├── bin/
│   └── agentmem.js        CLI entry point and command dispatch
├── src/
│   ├── store.js           Project id, Markdown read/write, search, duplicate check, secret scan, stale detection
│   ├── mcp.js             MCP server over stdio (JSON-RPC, newline-delimited) and tool definitions
│   ├── hooks.js           Claude Code hooks: session start, post tool use, session end
│   ├── capture.js         Transcript extraction and auto-capture through `claude -p`
│   └── install.js         Adds hooks to Claude Code settings and registers the MCP server
├── test/
│   ├── helpers.js         Shared temp-folder helper
│   └── *.test.js          One test file per module in src/
└── .github/               CI workflow, issue and PR templates
```

Tests live in `test/<module>.test.js`, one file per module in `src/`. `npm test` runs them all.

## Testing an MCP change by hand

Pipe JSON-RPC lines into the server:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_list"}}' \
  | node bin/agentmem.js mcp
```

## Testing a hook by hand

```bash
echo '{"cwd":"'"$PWD"'","session_id":"dev"}' | node bin/agentmem.js hook session-start
```

Auto-capture tests in the suite inject a fake model, so they never call Claude. To try the real thing, run `node bin/agentmem.js capture <transcript.jsonl>` against a store in a temp `AGENTMEM_HOME`.

## Adding a new agent integration

1. Check whether the agent can launch a stdio MCP server. If yes, document its config in the README under "Connect your agents".
2. If the agent has a hook system, add a handler in `hooks.js` that reuses `sessionStartContext` and `fileContext`, and add tests.

## Style

- Match the surrounding code: 2-space indent, double quotes, semicolons.
- Comments are rare and one line.
- Error messages say what went wrong and what to do next.

## Commits and pull requests

- Commit subject in plain imperative mood, under 60 characters. Example: `Add tag filter to memory_search`.
- PR description: what changed, why, and how you tested it.
- Make sure `npm test` passes before opening the PR.

## License of contributions

agentmem is licensed under PolyForm Noncommercial 1.0.0, and the author also offers it under separate commercial licenses. By opening a pull request you agree that your contribution is licensed under the same terms and that the author may include it in commercially licensed versions.

## Reporting bugs

Open an issue with:

1. What you ran (agent, OS, Node version)
2. What you expected
3. What happened, including any output from `capture.log` or the agent's MCP logs

Remove any secrets or private memory content before posting.
