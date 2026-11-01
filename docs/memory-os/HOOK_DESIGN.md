# Safe Memory Hooks — Design, Not Executable

Hook event schemas vary by Claude Code version. Implement only against current official docs and test locally.

## Suggested events
- `SessionStart`: display compact retrieval reminder; retrieve only current project and task.
- `UserPromptSubmit`: optionally classify whether prompt refers to known project/entity; avoid sending full prompt to remote services by default.
- `PostToolUse`: queue candidate memory after successful meaningful operations; redact before persistence.
- `PreCompact`: summarize active decisions, open tasks, and validated findings to a local staging note.
- `SessionEnd`: offer a memory review/commit; avoid silent bulk writes initially.

## Required controls
- allowlist tools/events; exclude sensitive paths and file types
- local redaction and size limits
- user-visible audit log
- opt-in review queue
- retry/timeouts that fail closed
- no autonomous external network transmission
- test duplicate detection and deletion
