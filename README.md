# agentmem

Project-scoped memory for AI coding agents. One local store per repository, shared by Claude Code, Cursor, and any other agent that speaks MCP.

- **Zero dependencies.** Plain Node.js, MCP over stdio, memories stored as Markdown files.
- **Per project.** Memory is keyed by the git remote URL, so every clone of the same repo shares one memory.
- **Works across agents.** Claude Code, Cursor, Windsurf, Codex, Gemini CLI, or anything with MCP support.
- **Automatic in Claude Code.** Hooks inject memory at session start, surface notes when a linked file is opened, and auto-capture new facts when a session ends.
- **Safe by default.** Writes that look like secrets are refused. Near-duplicate titles are refused unless forced.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Connect your agents](#connect-your-agents)
- [MCP tools](#mcp-tools)
- [CLI](#cli)
- [Claude Code hooks](#claude-code-hooks)
- [Auto-capture](#auto-capture)
- [Memory format](#memory-format)
- [Configuration](#configuration)
- [Sharing with a team](#sharing-with-a-team)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)
- [Contributing](#contributing)
- [License](#license)

## How it works

```
Claude Code ─┐
Cursor ──────┼── MCP (stdio) ──► agentmem ──► ~/.agentmem/<repo>-<hash>/*.md
Other agent ─┘
```

1. An agent starts `agentmem` as an MCP server from inside a project folder.
2. agentmem finds the project with `git remote get-url origin` (falls back to the repo root path, then the current folder) and hashes it into a project id like `my-app-1a2b3c4d5e6f`.
3. Every memory is one Markdown file in `~/.agentmem/<project-id>/`.
4. Any agent opened in the same repo reads and writes the same files.

## Requirements

- Node.js 18 or newer
- git (optional, used to identify the project)
- Claude Code CLI (optional, only for hooks and auto-capture)

## Install

```bash
git clone https://github.com/fixedbydev/agentmem.git
cd agentmem
npm link          # puts the agentmem command on your PATH
npm test          # optional, runs the test suite
```

No `npm install` is needed. There are no dependencies.

## Connect your agents

### Claude Code

```bash
agentmem install
```

This adds the three hooks to `~/.claude/settings.json` and registers the MCP server at user scope. It is safe to run twice. Restart Claude Code afterwards.

To add only the MCP server, without hooks:

```bash
claude mcp add agentmem --scope user -- node /absolute/path/to/agentmem/index.js mcp
```

### Cursor

Add to `~/.cursor/mcp.json` (all projects) or `<project>/.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "agentmem": {
      "command": "node",
      "args": ["/absolute/path/to/agentmem/index.js", "mcp"]
    }
  }
}
```

If memories land under the wrong project, the editor started the server outside your project folder. Ask the agent to pass `project_path` (the absolute project path) on its tool calls, or use the per-project config file.

### Other MCP clients

Any client that can launch a stdio MCP server works. The command is:

```
node /absolute/path/to/agentmem/index.js mcp
```

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
| `memory_write` | `title`, `content`, `type`, `files`, `tags`, `pinned`, `agent`, `force` | Save one fact |
| `memory_update` | `id` plus any field to change | Edit a memory in place |
| `memory_delete` | `id` | Remove a memory |

Every tool also accepts an optional `project_path`.

Types: `decision`, `convention`, `gotcha`, `todo`, `note`.

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
agentmem path        # prints this project's storage folder
```

Run `agentmem` with no arguments in a terminal to see the full help.

## Claude Code hooks

`agentmem install` registers these:

| Hook | What it does |
|---|---|
| `SessionStart` | Injects pinned memories in full, plus an index of the 50 most recent others. Flags stale memories. |
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

## Memory format

```markdown
---
title: Use pnpm
type: convention
agent: claude-code
date: 2026-10-31
updated: 2026-11-02
pinned: true
files: package.json, pnpm-lock.yaml
tags: tooling
---

This repo uses pnpm 9, not npm.
```

- **files**: repo-relative paths. Used for file-linked hints and stale detection.
- **stale**: if a listed file no longer exists, the memory is shown with `stale: <file> missing` so an agent can verify and fix it.
- **pinned**: always shown in full at session start.

You can edit these files by hand. agentmem reads them fresh on every call.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENTMEM_HOME` | `~/.agentmem` | Where all project folders live |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where `agentmem install` writes hooks |

## Sharing with a team

agentmem is local-first. To share without git, point `AGENTMEM_HOME` at a synced folder (Dropbox, iCloud Drive, Google Drive). Every teammate who opens the same repo gets the same project id, so they read the same memories. One fact per file keeps sync conflicts rare.

## Troubleshooting

- **Agent does not see the tools.** Run `claude mcp list` and check that `agentmem` shows as connected. Restart the agent after config changes.
- **Memories saved under the wrong project.** Run `agentmem path` inside the project to see the expected folder. Pass `project_path` from editors that start servers elsewhere.
- **Auto-capture saved nothing.** Check `capture.log` in the folder from `agentmem path`. Short sessions (under 500 characters of conversation) are skipped.
- **"similar memory exists".** Update the existing memory, or pass `force: true` / `--force`.
- **"looks like it contains a secret".** Remove the key from the text. Store the name of the env var instead.

## Uninstall

1. Remove the three `agentmem` hook entries from `~/.claude/settings.json`.
2. `claude mcp remove agentmem --scope user`
3. `npm unlink -g agentmem`
4. Optional: `rm -rf ~/.agentmem` deletes all memories.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Free for personal, research, educational and other noncommercial use. Selling agentmem or using it commercially requires a separate license from the author: open an issue or contact [fixedbydev](https://github.com/fixedbydev).
