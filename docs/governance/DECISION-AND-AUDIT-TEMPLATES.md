# AIL LABS — Decision, Approval & Audit Report Templates

## 1. Action authorization record

Use before any consequential action. Approval must be explicit and limited to the described scope.

- Task / reference:
- Requested outcome:
- Action class: R0 / R1 / R2 / R3 / R4
- Exact action:
- Target system / recipient / environment:
- Expected impact:
- Risks and mitigations:
- Test and verification:
- Rollback / cancellation:
- Data or money involved:
- Required approver:
- Approval status: Pending / Approved / Rejected / Expired
- Approval date and scope:
- Operator:
- Completion evidence:

**Important:** approval for analysis or drafting does not authorize sending, payment, production changes, publication, deletion, purchase, or contract.

## 2. Task intake template

### Judul
### Tujuan
### Pengguna/penerima
### Lingkup
### Di luar lingkup
### Kondisi awal / baseline
### Batasan dan keputusan terdahulu
### Standar yang berlaku
### Asumsi (explicit)
### Informasi belum tersedia
### Risiko awal
### Kriteria penerimaan
### Persetujuan yang diperlukan
### Rencana dan urutan verifikasi

## 3. Audit finding template

| Field | Value |
|---|---|
| Finding ID | |
| Domain | |
| Severity | Critical / High / Medium / Low / Informational |
| Status | Open / In Progress / Fixed / Accepted Risk |
| Evidence | |
| Location / affected process | |
| Reproduction steps | |
| Root cause | |
| Impact | |
| Recommended fix | |
| Verification method | |
| Verification result | |
| Owner / due date | |

## 4. Test evidence register

| Test ID | Criterion | Environment | Method / command | Expected | Actual | Status | Evidence reference |
|---|---|---|---|---|---|---|---|
| T-001 | | | | | | | |

Do not record a test as PASS unless it was actually executed and the result supports the criterion.

## 5. Change and release record

- Change ID:
- Repository/system:
- Branch / commit / PR:
- Files/resources changed:
- Change summary:
- Risk classification:
- Required approvals:
- CI/test results:
- Preview/staging result:
- Production target:
- Deployment version:
- Smoke/E2E result:
- Monitoring window:
- Rollback trigger:
- Rollback method:
- Residual risk:
- Final release status:

## 6. Supplier qualification record

- Supplier legal name:
- Manufacturer / distributor / trading company:
- Official domain and registration evidence:
- Factory/site:
- Product and category:
- Country of origin:
- Product specification:
- Documents received:
- Document issuer/scope/validity:
- Sample terms: Free / Not compliant
- Shipping: Supplier-paid to Indonesia / Not compliant
- DDP destination and named place:
- Payment terms and buyer protection:
- MOQ / lead time:
- Lab test plan and result:
- Regulatory questions:
- Red flags:
- Rady decision: Continue diligence / Reject / Approve sample evaluation / BUY / PAY
- Decision date and conditions:

## 7. Regulatory verification record

- Product name and exact category:
- Intended use:
- Composition / claims:
- Manufacturer and origin:
- Indonesian responsible entity:
- Authority:
- Regulation / guidance:
- Official URL:
- Version / publication / effective date:
- Requirement:
- Evidence available:
- Status: Planned / Submitted / In Review / Approved / Expired / Not Applicable / Not Verified
- Reviewer:
- Open questions:
- Qualified legal/regulatory review needed:

## 8. Email approval record

- Audience: Supplier / Clinic / Other
- Sender identity:
- Recipient source:
- Segment:
- Recipient count:
- Dedupe and suppression check:
- Subject:
- Body version:
- Attachments and links:
- Unsubscribe/privacy check:
- Approval:
- Send authorization:
- Provider result:
- Delivered:
- Bounced:
- Deferred:
- Complaints:
- Follow-up action:

## 9. Final task report

### JUDUL
[Task name]

### HASIL
[What was actually completed. Avoid unsupported success claims.]

### LINGKUP DAN BASELINE
[Systems/files/processes inspected and original state.]

### TEMUAN AUDIT
[Finding IDs, severity, evidence, impact, root cause.]

### TINDAKAN / PERUBAHAN
[Exact changes, files, documents, or process steps.]

### PENGUJIAN DAN BUKTI
[Commands, test IDs, environment, results, links/artifacts.]

### ACCEPTANCE
| Criterion | Status | Evidence / reason |
|---|---|---|
| | PASS / FAIL / BLOCKED / NOT VERIFIED / NOT APPLICABLE | |

### RISIKO TERSISA
[Open issues, exclusions, assumptions, and limitations.]

### SUMBER
[Primary sources, official documentation, supplier evidence, repository references.]

### KEPUTUSAN RADY
[Decision needed or decision already explicitly given. Never invent approval.]

## 10. Decision vocabulary

- **ANALYZE:** read-only assessment.
- **DRAFT:** prepare content without sending.
- **TEST:** run authorized tests in an appropriate environment.
- **APPROVE:** explicit permission for a specific action.
- **MERGE:** integrate reviewed code.
- **DEPLOY:** release to a named environment.
- **SEND:** deliver a specified communication to an approved audience.
- **BUY / PAY:** commercial commitment requiring Rady's explicit decision.
- **HOLD:** pause pending evidence or approval.
- **REJECT:** stop the proposal or supplier path.

Use these words precisely. Do not treat one as another.
