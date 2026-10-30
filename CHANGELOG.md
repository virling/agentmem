# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/virling/agentmem/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/virling/agentmem/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/virling/agentmem/releases/tag/v0.2.0
