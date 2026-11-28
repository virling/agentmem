# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-11-28

### Added

- Git worktrees (for example subagent worktrees under `.claude/worktrees/`) share the main checkout's memory store.
- `memory_write` with absolute file paths in another git repo saves the memory in that repo, and auto-capture does the same for each item.
- `memory_handoff` takes `resolves`, a list of todo ids the work finished, and deletes them. Its reply lists the remaining open todos.

### Fixed

- `memory_update` stores absolute in-repo paths as repo-relative, so file hints and guards match.
- A failed auto-capture (no `claude` CLI, timeout, bad output) is written to `capture.log` instead of being lost.
- `agentmem show` and `agentmem capture` without an argument print usage instead of a stack trace.
- The MCP server reports the package version instead of a fixed one.
- Prerelease versions publish under the `next` npm tag.

## [0.7.0] - 2026-11-27

### Added

- Auto-capture reads long sessions in parts: up to the last 800k characters, one Haiku call per 200k, at most 4. Previously only the last 40k characters were read.
- Auto-capture includes the session's subagent transcripts, ahead of the main session so the main session is kept when the total is too long.
- Session start reminds the agent to suggest `agentmem stats` when memories have not been used in 14+ days.

### Changed

- Node.js 20 or newer is required. Node 18 is end-of-life and no longer tested.
- The GitHub Actions use `actions/checkout` and `actions/setup-node` v7.
- The `v0` tag is moved to each new release automatically.

### Fixed

- `guard-check` no longer fails intermittently on macOS (`spawnSync tar ENOTCONN`).

## [0.6.2] - 2026-11-26

### Fixed

- `guard-check` also applies guards from the base ref, so a change cannot remove the guard that covers it.
- `guard-check` flags files moved out of a guarded path and files with non-ASCII names.
- The guard Action checks every commit of a push, not only the last one, and escapes file names in annotations.
- Moving the `v0` tag no longer starts a failing release run.

## [0.6.0] - 2026-11-01

### Added

- Org memory: `agentmem org add <git-url>` shares an org repo's `.agentmem/` memories, read-only, with every project of the same owner.
- `agentmem stats` shows how often each memory was used and flags ones unused for 14+ days.
- `agentmem guard-check` and a guardrails GitHub Action (`virling/agentmem/guard@v0`) fail pull requests that change `block`-guarded files.
- Auto-capture turns commands that failed and then passed after an edit into gotcha candidates.
- The MCP server warns Claude Code when agentmem's hooks are missing from settings, so sessions are not silently left uncaptured.

## [0.5.0] - 2026-10-31

### Added

- Claude Code plugin: `/plugin marketplace add virling/agentmem` then `/plugin install agentmem@virling`.
- Cross-agent handoffs: `memory_handoff`, `agentmem handoff`, and auto-capture writes one when a session ends mid-task. The latest handoff is shown first at session start and in `memory_list`.
- `agentmem install` configures VS Code (Copilot) and OpenCode.
- PR memory GitHub Action (`virling/agentmem@v0`): extracts decisions from merged pull requests and opens a pull request adding them to `.agentmem/`.

### Changed

- Times in handoffs and `capture.log` use local time.

## [0.4.0] - 2026-10-31

### Added

- Team memory: `scope: "team"` stores memories in the repo's `.agentmem/` folder so they are reviewed in PRs and shared through git. `agentmem promote` and `memory_promote` move local memories there.
- Guardrails: memories with `guard: warn|block` and file globs are enforced by a new `PreToolUse` hook in Claude Code.
- Code-aware staleness: memories store a content hash of linked files and are flagged `changed since written` when those files change. `agentmem verify` records the new version.
- `agentmem export` writes team memories into `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` and `.cursor/rules/agentmem.mdc`.
- Contradiction checks: writes return related memories, and `agentmem check` finds contradicting pairs with Haiku.
- npm tokens are now caught by the secret scan.

### Fixed

- File-linked hints and guardrails now match when the project is opened through a symlinked path.

## [0.3.0] - 2026-10-31

### Added

- One-line setup: `npx -y @virling/agentmem install` configures every detected agent.
- `install` supports Cursor, Windsurf, Gemini CLI and Codex in addition to Claude Code, and accepts agent names to limit it (`agentmem install claude cursor`).
- Published to npm as `@virling/agentmem`.
- CI on Ubuntu and macOS for Node 18, 20 and 22.
- Issue and pull request templates.

### Changed

- Code moved into `bin/`, `src/` and `test/` folders.
- `install` updates hooks and MCP entries left by an older install path instead of adding duplicates.
- Repository moved to the `virling` GitHub organization.

## [0.2.0] - 2026-10-31

### Added

- Claude Code hooks: memory index at session start, file-linked memories on Read/Edit/Write, auto-capture at session end.
- Auto-capture of durable facts from session transcripts through `claude -p --model haiku`.
- CLI: `list`, `search`, `show`, `add`, `edit`, `pin`, `unpin`, `rm`, `path`, `capture`, `install`.
- `memory_update` tool and optional `project_path` on every tool.
- Secret scan that refuses writes containing API keys, tokens or private keys.
- Duplicate check on similar titles, with `force` to override.
- `files`, `tags` and `pinned` fields, and stale detection when a linked file is gone.

### Changed

- License is PolyForm Noncommercial 1.0.0.

## 0.1.0 - 2026-10-31 (not tagged)

### Added

- MCP server over stdio with `memory_list`, `memory_search`, `memory_read`, `memory_write`, `memory_delete`.
- Per-project storage in `~/.agentmem/<project-id>/`, keyed by the git remote URL.

[Unreleased]: https://github.com/virling/agentmem/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/virling/agentmem/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/virling/agentmem/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/virling/agentmem/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/virling/agentmem/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/virling/agentmem/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/virling/agentmem/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/virling/agentmem/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/virling/agentmem/releases/tag/v0.2.0
