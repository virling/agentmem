# agentmem

Memory that lives with your code: reviewed in pull requests, enforced as guardrails, readable by every AI coding agent. Zero dependencies, no daemon, no account.

- **Zero dependencies.** Plain Node.js, MCP over stdio, memories stored as Markdown files.
- **Per project.** Memory is keyed by the git remote URL, so every clone of the same repo shares one memory.
- **Works across agents.** Claude Code, Cursor, Windsurf, Codex, Gemini CLI, or anything with MCP support.
- **Automatic in Claude Code.** Hooks inject memory at session start, surface notes when a linked file is opened, and auto-capture new facts when a session ends.
- **Team memory in git.** Team memories live in `.agentmem/` in your repo, so they are reviewed in PRs and shared on `git pull`.
- **Guardrails.** Turn a memory into a rule: agents are blocked or asked before editing matching files.
- **Code-aware.** Memories linked to files are flagged when those files change, so outdated knowledge does not linger.
- **Export to rule files.** Compile team memories into `AGENTS.md`, `CLAUDE.md`, Copilot and Cursor rules for agents without MCP.
- **Contradiction checks.** New memories come back with related ones to compare, and `agentmem check` finds conflicts.
- **Safe by default.** Writes that look like secrets are refused. Near-duplicate titles are refused unless forced.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Changelog](#changelog)
- [Install](#install)
- [Connect your agents](#connect-your-agents)
- [MCP tools](#mcp-tools)
- [CLI](#cli)
- [Claude Code hooks](#claude-code-hooks)
- [Auto-capture](#auto-capture)
- [Team memory](#team-memory)
- [Guardrails](#guardrails)
- [Code-aware staleness](#code-aware-staleness)
- [Export to rule files](#export-to-rule-files)
- [Contradiction checks](#contradiction-checks)
- [Memory format](#memory-format)
- [Configuration](#configuration)
- [Sharing with a team](#sharing-with-a-team)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)
- [Contributing](#contributing)
- [License](#license)

## How it works

```
Claude Code ─┐                      ┌─► ~/.agentmem/<repo>-<hash>/*.md   local, private
Cursor ──────┼── MCP (stdio) ──► agentmem
Other agent ─┘                      └─► <repo>/.agentmem/*.md            team, committed
```

1. An agent starts `agentmem` as an MCP server from inside a project folder.
2. agentmem finds the project with `git remote get-url origin` (falls back to the repo root path, then the current folder) and hashes it into a project id like `my-app-1a2b3c4d5e6f`.
3. Every memory is one Markdown file, either local (`~/.agentmem/<project-id>/`) or team (`<repo>/.agentmem/`).
4. Any agent opened in the same repo reads both layers.

## Requirements

- Node.js 18 or newer
- git (optional, used to identify the project)
- Claude Code CLI (optional, only for hooks and auto-capture)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) and [GitHub releases](https://github.com/virling/agentmem/releases).

## Install

One line. Detects Claude Code, Cursor, Windsurf, Gemini CLI and Codex on your machine and configures each one:

```bash
npx -y @virling/agentmem install
```

Or install globally first (faster hooks, `agentmem` on your PATH):

```bash
npm i -g @virling/agentmem && agentmem install
```

Configure only specific agents:

```bash
agentmem install claude cursor
```

Restart your agents afterwards. Running `install` again is safe: it updates existing entries instead of adding duplicates.

## Connect your agents

`agentmem install` writes these for you. The details are here if you prefer to do it by hand.

| Agent | What `install` changes |
|---|---|
| Claude Code | `claude mcp add agentmem --scope user`, plus three hooks in `~/.claude/settings.json` |
| Cursor | `mcpServers.agentmem` in `~/.cursor/mcp.json` |
| Windsurf | `mcpServers.agentmem` in `~/.codeium/windsurf/mcp_config.json` |
| Gemini CLI | `mcpServers.agentmem` in `~/.gemini/settings.json` |
| Codex | `[mcp_servers.agentmem]` in `~/.codex/config.toml` |

Other keys and other MCP servers in those files are left as they are.

### Any other MCP client

Any client that can launch a stdio MCP server works:

```json
{
  "mcpServers": {
    "agentmem": { "command": "npx", "args": ["-y", "@virling/agentmem", "mcp"] }
  }
}
```

### Editors that start servers outside the project

If memories land under the wrong project, the editor started the server outside your project folder. Ask the agent to pass `project_path` (the absolute project path) on its tool calls, or use the editor's per-project MCP config.

### From source

```bash
git clone https://github.com/virling/agentmem.git
cd agentmem
npm test
node bin/agentmem.js install
```

There are no dependencies, so no `npm install` is needed.

### Tell the agent to use it

Agents without hooks do not read memory on their own. Add a line like this to your `AGENTS.md`, `.cursor/rules`, or equivalent:

```
At the start of each task call memory_list. Save durable decisions, conventions and gotchas with memory_write.
```

## MCP tools

| Tool | Arguments | What it does |
|---|---|---|
| `memory_list` | | List all memories for the project (id, type, title, flags) |
| `memory_search` | `query` | Keyword search across title, type, tags, files and body |
| `memory_read` | `id` | Full text of one memory |
| `memory_write` | `title`, `content`, `type`, `files`, `tags`, `pinned`, `guard`, `scope`, `agent`, `force` | Save one fact. Returns related memories to check for contradictions |
| `memory_update` | `id` plus any field to change | Edit a memory in place. With only `id`, re-verifies it against its files |
| `memory_promote` | `id` | Move a local memory into the repo's `.agentmem/` folder |
| `memory_delete` | `id` | Remove a memory |

Every tool also accepts an optional `project_path`.

Types: `decision`, `convention`, `gotcha`, `todo`, `note`. Scopes: `local` (default), `team`. Guards: `warn`, `block`.

## CLI

Run inside any project folder:

```bash
agentmem list
agentmem search "auth token"
agentmem show 2026-10-31-use-pnpm
agentmem add "Use pnpm" "This repo uses pnpm 9, not npm" --type convention --files package.json --pin
agentmem edit 2026-10-31-use-pnpm --content "pnpm 9 only"
agentmem pin 2026-10-31-use-pnpm
agentmem unpin 2026-10-31-use-pnpm
agentmem rm 2026-10-31-use-pnpm
agentmem add "Generated code" "Run pnpm codegen" --files "src/gen/**" --guard block --team
agentmem promote 2026-10-31-use-pnpm
agentmem verify 2026-10-31-api-returns-json
agentmem export agents cursor
agentmem check
agentmem path        # prints this project's local and team folders
```

Run `agentmem` with no arguments in a terminal to see the full help.

## Claude Code hooks

`agentmem install` registers these:

| Hook | What it does |
|---|---|
| `SessionStart` | Injects pinned memories in full, plus an index of the 50 most recent others. Flags stale and changed memories. |
| `PreToolUse` (Edit, Write, MultiEdit, NotebookEdit) | Enforces guardrails: denies edits to files under a `block` memory, asks first for `warn`. |
| `PostToolUse` (Read, Edit, Write, MultiEdit) | When a file is touched, injects memories whose `files` list includes it. Each memory is shown once per session. |
| `SessionEnd` | Starts auto-capture in the background. Does not block exit. |

## Auto-capture

When a Claude Code session ends, agentmem:

1. Reads the session transcript (user and assistant text only, last 40k characters).
2. Sends it to `claude -p --model haiku` with no tools and no MCP servers.
3. Saves up to 5 durable facts with `agent: auto-capture`. Secrets and near-duplicates are skipped.
4. Appends the result to `capture.log` in the project's storage folder.

Run it by hand on any transcript:

```bash
agentmem capture ~/.claude/projects/<project>/<session-id>.jsonl
```

Auto-capture uses your logged-in Claude Code account. Each run is one small Haiku call.

## Team memory

Memories have two scopes:

- **local** (default): `~/.agentmem/<project-id>/`, private to your machine.
- **team**: `<repo>/.agentmem/`, committed with your code.

```bash
agentmem add "API errors use RFC 7807" "Return problem+json bodies" --type convention --team
agentmem promote <id>      # move an existing local memory into the team folder
git add .agentmem && git commit -m "Add API error convention"
```

Team memories are plain Markdown, so they show up in pull requests like any other change. Reviewers can correct or reject them before they reach the rest of the team, and everyone gets them on `git pull`. Agents call `memory_write` with `scope: "team"` or `memory_promote` to do the same.

## Guardrails

A memory with `guard` and a `files` pattern becomes a rule that the `PreToolUse` hook enforces in Claude Code:

```bash
agentmem add "Generated client" "Run pnpm codegen instead" --type convention --files "src/gen/**" --guard block --team
agentmem add "Migrations are append-only" "Add a new migration file" --files "db/migrations/*.sql" --guard warn --team
```

- `block`: the edit is denied, and the agent sees the memory as the reason.
- `warn`: you are asked to approve the edit, with the memory shown.

Patterns support `*`, `**` and `?`. Agents without hooks get guardrails through [exported rule files](#export-to-rule-files).

## Code-aware staleness

When a memory lists `files`, agentmem stores a content hash of each file. Later:

- If a file is deleted, the memory is flagged `stale`.
- If a file's content changed, the memory is flagged `changed since written`.

Both flags appear in `list`, search results and the session-start index, so the agent knows to double-check. After checking, run `agentmem verify <id>` (or `memory_update` with just the id) to record the current file versions.

## Export to rule files

Agents that do not speak MCP still read rule files. `agentmem export` compiles team conventions, decisions, gotchas and guardrails into them:

```bash
agentmem export                       # AGENTS.md
agentmem export agents claude copilot cursor
agentmem export --include-local       # also include your local memories
```

| Target | File |
|---|---|
| `agents` | `AGENTS.md` |
| `claude` | `CLAUDE.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `cursor` | `.cursor/rules/agentmem.mdc` |

agentmem only rewrites the block between `<!-- agentmem:start -->` and `<!-- agentmem:end -->`. Everything else in the file is left as it is. The Cursor file is fully managed.

## Contradiction checks

- `memory_write` and `agentmem add` return related memories (same files or similar wording) so the agent can spot a conflict right away.
- `agentmem check` sends all memories to `claude -p --model haiku` and lists pairs that contradict each other.

```
$ agentmem check
- 2026-10-31-package-manager-is-pnpm vs 2026-10-31-use-npm-for-installs: One says always use pnpm, the other says run npm install in CI.
```

## Memory format

```markdown
---
title: Use pnpm
type: convention
agent: claude-code
date: 2026-10-31
updated: 2026-11-02
pinned: true
guard: warn
files: package.json, pnpm-lock.yaml
tags: tooling
hashes: package.json@3f2a9c1b7d4e, pnpm-lock.yaml@a91c03e5f2b8
---

This repo uses pnpm 9, not npm.
```

- **files**: repo-relative paths. Used for file-linked hints and stale detection.
- **stale**: if a listed file no longer exists, the memory is shown with `stale: <file> missing` so an agent can verify and fix it.
- **pinned**: always shown in full at session start.
- **guard**: `warn` or `block`. See [Guardrails](#guardrails).
- **hashes**: written by agentmem. See [Code-aware staleness](#code-aware-staleness).

You can edit these files by hand. agentmem reads them fresh on every call.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENTMEM_HOME` | `~/.agentmem` | Where all project folders live |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where `agentmem install` writes hooks |

## Sharing with a team

The recommended way is [team memory](#team-memory) in git. To share local memories without git, point `AGENTMEM_HOME` at a synced folder (Dropbox, iCloud Drive, Google Drive). Every teammate who opens the same repo gets the same project id, so they read the same memories. One fact per file keeps sync conflicts rare.

## Project structure

```
agentmem/
├── bin/agentmem.js    CLI and MCP entry point
├── src/               store, MCP server, hooks, auto-capture, installer
├── test/              one test file per module (node:test)
└── .github/           CI, issue and PR templates
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for what each module does.

## Troubleshooting

- **Agent does not see the tools.** Run `claude mcp list` and check that `agentmem` shows as connected. Restart the agent after config changes.
- **Memories saved under the wrong project.** Run `agentmem path` inside the project to see the expected folder. Pass `project_path` from editors that start servers elsewhere.
- **Auto-capture saved nothing.** Check `capture.log` in the folder from `agentmem path`. Short sessions (under 500 characters of conversation) are skipped.
- **"similar memory exists".** Update the existing memory, or pass `force: true` / `--force`.
- **"looks like it contains a secret".** Remove the key from the text. Store the name of the env var instead.

## Uninstall

1. Remove the three `agentmem` hook entries from `~/.claude/settings.json`.
2. `claude mcp remove agentmem --scope user`
3. Remove the `agentmem` entry from each other agent's MCP config listed in [Connect your agents](#connect-your-agents).
4. `npm rm -g @virling/agentmem` if you installed it globally.
5. Optional: `rm -rf ~/.agentmem` deletes all memories.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Free for personal, research, educational and other noncommercial use. Selling agentmem or using it commercially requires a separate license from the author: open an issue or contact [Virling](https://github.com/virling).
