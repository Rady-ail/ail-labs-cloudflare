# Prompt Engineering — Expert Playbook

## Prompt template for substantial work
**Goal:** one sentence, measurable where possible.
**Context/source of truth:** files, systems, facts, links.
**Deliverable:** exact artifact/result.
**Scope:** in / out.
**Constraints:** technical, legal, business, security, style.
**Acceptance criteria:** observable checklist.
**Validation:** tests, source cross-check, review.
**Approval boundary:** actions requiring user approval.
**Output format:** table, patch, email draft, report, etc.

## Reasoning quality
- Decompose only when complexity warrants it.
- Identify critical unknowns and ask one focused question.
- Compare options using explicit criteria, not vibes.
- Use tools for current facts and inspect source results.
- Challenge assumptions and provide counterevidence when useful.
- Avoid exposing hidden chain-of-thought; provide concise rationale and conclusions.
- Do not use “act as an expert” as a substitute for domain constraints and acceptance criteria.

## Coding prompt
“Inspect [scope]. Preserve [invariants]. Implement [behavior]. Add tests for [cases]. Do not modify [out-of-scope]. Run [commands]. Report files changed, tests, and limitations.”

## Research prompt
“Answer [question] using primary sources where possible. Separate confirmed facts from interpretation. Include publication dates and citations. Identify uncertainty and conflicting sources. Deliver [format].”

## Debug prompt
“Reproduce symptom [x]. Inspect logs and relevant code. Identify hypotheses, rank by evidence, test safely, determine root cause, implement minimal fix only after confirmation if risky. Add regression test. Report evidence.”

## Review prompt
“Review [artifact/diff] for correctness, security, maintainability, regressions, and scope. Prioritize findings by severity; cite exact file/line. Do not rewrite unless asked.”

## Anti-patterns
- Huge all-purpose prompt files loaded on every turn.
- Repeated, contradictory rules.
- Unverifiable claims and fake benchmarks.
- Memory dumps instead of targeted retrieval.
- Autonomous writes without audit, redaction, or user approval.
- Tool instructions copied from unknown repositories without checking version/license.
