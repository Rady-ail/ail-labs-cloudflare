# Cross-Agent Operating Contract

## Main agent owns
- Task interpretation, user communication, final decisions, merge/integration, and approval boundaries.
- All consequential external actions require explicit user authorization.

## Delegation packet
Each subagent receives: objective, context, allowed tools/sources, read/write scope, constraints, acceptance criteria, and output schema.

## Safe parallelization
Parallelize independent research, documentation review, tests, or read-only code inspection.
Do not let agents simultaneously edit the same files, mutate production, send communications, or delete data.

## Validation
Subagent outputs are untrusted until checked. Validate claims against primary sources, actual diffs, or test results. Record disagreements; do not average conflicting claims.

## Completion report
Summarize result, changed artifacts, validation, unresolved issues, and any approval still required.
