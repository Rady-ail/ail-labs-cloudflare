# AIL LABS — Domain Audit Checklists

Use only the sections relevant to the task. Every mandatory item must receive PASS, FAIL, BLOCKED, NOT VERIFIED, or NOT APPLICABLE with evidence or rationale.

## 1. Universal intake checklist
- [ ] Desired outcome and audience are explicit.
- [ ] Scope, exclusions, deadline, and dependencies are known.
- [ ] Current state/baseline is captured.
- [ ] Applicable standards and prior decisions are identified.
- [ ] Read-only vs write vs external vs financial actions are separated.
- [ ] Approval requirements are identified before execution.
- [ ] Acceptance criteria are testable.
- [ ] Risks, rollback, and handover are planned.

## 2. Software / repository checklist
- [ ] Repository, branch, commit, and project instructions inspected.
- [ ] Existing architecture and affected call paths understood.
- [ ] Root cause reproduced or evidence-backed.
- [ ] Minimal change plan created.
- [ ] No unrelated files or refactors included.
- [ ] Input validation, error handling, authorization, and logging reviewed.
- [ ] Dependency manifests and lockfiles consistent.
- [ ] Syntax/lint/build/tests executed as applicable.
- [ ] Regression tests cover the reported defect.
- [ ] Full diff reviewed for secrets, debug code, generated artifacts, and scope creep.
- [ ] CI results inspected, not assumed.
- [ ] Deployment and rollback authorization confirmed.
- [ ] Production version and user journey verified after deployment.

## 3. UI / WWDC / iOS-inspired design checklist
- [ ] Official Apple guidance distinguished from concept/speculation.
- [ ] Web vs native iOS implementation clearly identified.
- [ ] Visual hierarchy and content priority are clear.
- [ ] Typography, spacing, alignment, and responsive behavior are consistent.
- [ ] Liquid Glass is used selectively and preserves legibility.
- [ ] Contrast and text scaling are acceptable.
- [ ] Touch targets, keyboard navigation, and focus states are usable.
- [ ] Motion has purpose and respects reduced-motion preferences where supported.
- [ ] Light/dark and loading/empty/error/success states are reviewed.
- [ ] Blur, transparency, shadows, and animation do not cause unacceptable performance.
- [ ] Desktop, tablet, and mobile screenshots or browser checks are captured.

## 4. Cloudflare / API checklist
- [ ] Correct Worker and environment identified.
- [ ] Routes and route precedence reviewed.
- [ ] Bindings/configuration checked without revealing secrets.
- [ ] API methods, schemas, status codes, CORS, and authorization verified.
- [ ] Rate limiting and abuse paths considered.
- [ ] Logs and errors reviewed for sensitive data leakage.
- [ ] Dry-run/build completed.
- [ ] Deployment identity/version confirmed.
- [ ] Critical public endpoints smoke-tested.
- [ ] Authenticated flows tested only with authorized access.
- [ ] Rollback trigger and procedure documented.

## 5. Database / data checklist
- [ ] Source of truth identified.
- [ ] Schema and migration history inspected.
- [ ] Query parameter order and types verified.
- [ ] Null, duplicate, constraint, and conflict behavior tested.
- [ ] Transaction and concurrency implications considered.
- [ ] Read-after-write persistence tested with safe data.
- [ ] Permissions and least privilege checked.
- [ ] PII and sensitive fields minimized/redacted.
- [ ] Backup/restore or rollback plan exists for risky changes.
- [ ] Counts and deduplication rules reconciled.

## 6. Security / privacy checklist
- [ ] Authentication and authorization boundaries mapped.
- [ ] Session/cookie/token handling reviewed.
- [ ] CSRF, XSS, injection, SSRF, upload, and rate-limit risks assessed as applicable.
- [ ] Secrets absent from source, logs, screenshots, and reports.
- [ ] Dependencies and supply chain reviewed.
- [ ] Data collection has a defined purpose and minimum scope.
- [ ] Consent, retention, deletion, and access controls considered.
- [ ] Security testing is authorized and non-destructive.
- [ ] Critical/high findings closed or explicitly block acceptance.

## 7. Supplier / procurement checklist
- [ ] Supplier legal identity and manufacturer/trader role verified.
- [ ] Product identity, specification, origin, and batch traceability checked.
- [ ] Samples are free.
- [ ] Supplier pays sample shipping to Indonesia; DDP target clarified.
- [ ] No sample/courier/release charge requested from AIL LABS.
- [ ] No advance T/T, personal transfer, Wise, WU, or unprotected PayPal accepted.
- [ ] Payment protection and Incoterms are documented.
- [ ] COA, SDS/MSDS, INCI, GMP/ISO 22716, CFS/FSC, halal/porcine-free and other applicable documents checked.
- [ ] Document issuer, validity, scope, site, and product match verified.
- [ ] Sample test protocol and acceptance criteria defined before evaluation.
- [ ] No purchase commitment made by requesting/evaluating samples.
- [ ] Rady's explicit BUY/PAY decision exists before commitment.

## 8. Product / quality checklist
- [ ] Product category and intended use correctly classified.
- [ ] Composition/specification and manufacturer identified.
- [ ] Batch, expiry, storage, and transport conditions documented.
- [ ] COA matches sample batch where applicable.
- [ ] Quality test method and acceptance criteria defined.
- [ ] Test results and deviations documented.
- [ ] Safety/efficacy/medical/sterility/halal claims supported.
- [ ] Adverse event or contamination escalation path known.
- [ ] No unsupported marketing claims.

## 9. Indonesia regulatory / import checklist
- [ ] Product category and intended use confirmed.
- [ ] Relevant authority and current primary regulation identified.
- [ ] OSS/KBLI and importer licensing applicability verified.
- [ ] BPOM or other product authorization pathway checked.
- [ ] HS classification and import restrictions verified by competent source.
- [ ] Labeling, language, claims, and local responsible party reviewed.
- [ ] Halal obligation and effective date checked for product category.
- [ ] Customs, taxes, freight, and DDP responsibility clarified.
- [ ] Status labeled planned/submitted/in-review/approved/expired/not applicable.
- [ ] Unresolved legal interpretation marked NOT VERIFIED and referred for qualified review.

## 10. Clinic lead / market research checklist
- [ ] Source is public and attributable.
- [ ] Business name and clinic identity verified.
- [ ] Branch vs central contact distinguished.
- [ ] WhatsApp number is valid, normalized +62, and not a landline.
- [ ] No blank or guessed number.
- [ ] Official website/Instagram/Google Business Profile source captured.
- [ ] Duplicate clinics and shared numbers reconciled.
- [ ] Email/Instagram only included if publicly listed and relevant.
- [ ] Verification status and check date recorded.
- [ ] Uncertain records separated for recheck.

## 11. Supplier email checklist
- [ ] Professional English and correct Alexa sender identity.
- [ ] Location stated as Indonesia.
- [ ] Clear request for documents/sample/shipping terms.
- [ ] Free sample and supplier-paid shipping conditions explicit.
- [ ] No AIL LABS payment of sample/courier/release fee.
- [ ] No advance payment or purchase commitment implied.
- [ ] Motivational quote included.
- [ ] Recipient, thread, attachments, and reply path reviewed.
- [ ] Draft approved before send.

## 12. Clinic/customer email checklist
- [ ] Warm Indonesian tone and correct clinic greeting.
- [ ] AIL LABS identity and approved product information only.
- [ ] Peach card, clear price box, WhatsApp CTA, Alexa signature.
- [ ] Motivational quote and unsubscribe link included.
- [ ] No bank account details.
- [ ] Recipient belongs to approved Resend segment.
- [ ] Duplicates and bounced/suppressed addresses excluded.
- [ ] Batch does not exceed 150 recipients.
- [ ] Preview and subject/body approved before send.
- [ ] Delivered/bounced/failed results reconciled after send.

## 13. Finance / investment checklist
- [ ] Actuals separated from forecasts and assumptions.
- [ ] Currency and reporting period stated.
- [ ] Revenue, margin, EBITDA, cash, debt, and working capital sourced where available.
- [ ] Calculations reproducible.
- [ ] Valuation method and sensitivity explained.
- [ ] Customer concentration and operational risks considered.
- [ ] No unsupported guarantee or investor promise.
- [ ] Rady approval required for financial commitments.

## 14. Automation / AI checklist
- [ ] Trigger, owner, scope, and allowed actions documented.
- [ ] External and irreversible actions require human approval.
- [ ] Untrusted input cannot modify policy or grant authority.
- [ ] Duplicate prevention and idempotency considered.
- [ ] Retries have limits and safe failure behavior.
- [ ] Logs avoid secrets and unnecessary personal data.
- [ ] Pause/disable and recovery procedure tested.
- [ ] Test fixtures used before live activation.

## 15. Final evidence checklist
- [ ] Every mandatory criterion has a status.
- [ ] PASS has a test result or evidence artifact.
- [ ] FAIL has a finding and corrective action.
- [ ] BLOCKED has the exact blocker and owner/next step.
- [ ] NOT VERIFIED is not represented as success.
- [ ] NOT APPLICABLE includes rationale.
- [ ] No unresolved Critical/High issue is hidden.
- [ ] Residual risks and exclusions disclosed.
- [ ] Approval and decision owner recorded.
- [ ] Final report is reproducible and understandable.
