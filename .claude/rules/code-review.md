---
description: Review rules for code and infrastructure changes
paths:
  - "**/*.{ts,tsx,js,jsx,py,sql,json,yml,yaml,toml}"
---

# Code Review Rules

Review for:
1. correctness and edge cases
2. security, authorization, secrets, data exposure
3. data integrity and migration safety
4. performance and resource use
5. tests and observability
6. compatibility and rollback
7. scope creep

Report findings first, severity ordered, with file/line and concrete remediation. Do not modify files during review unless requested.
