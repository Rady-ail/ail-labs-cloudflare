# AIL LABS — Product Catalog Illustration Studio Prompt

> Purpose: use this prompt in v0 to design an isolated, reviewable Product Catalog Illustration Studio for the existing AIL LABS repository.
>
> Repository: `Rady-ail/ail-labs-cloudflare`
> Production baseline: existing `main` branch (Cloudflare Workers + Neon PostgreSQL).
> This document is a design/build brief only. It does not authorize production deployment, database changes, or merging.

## Master prompt for v0

Act as a senior product designer, UX architect, and staff-level frontend engineer. Build a polished, mobile-first **AIL LABS Product Catalog Illustration Studio** as an isolated feature within the existing AIL LABS B2B platform. The tool helps an internal catalog operator prepare and review premium product illustration concepts for existing catalog SKUs.

### 1. Business context

AIL LABS (PT Fudhail Aesthetic Laboratories) is a B2B aesthetic distributor and private-label manufacturing partner serving doctors, clinics, dermatologists, hospitals, pharmacy chains, and qualified business buyers. This is not a B2C storefront. Do not add cart, checkout, consumer pricing, or consumer purchase flows.

The visual identity is premium clinical minimalism:
- White and soft neutral surfaces with generous whitespace.
- Cyan `#06B6D4` as the primary accent and orange `#FF7A1A` as a restrained secondary accent.
- Clear typography, crisp borders, restrained shadows, excellent mobile ergonomics, and accessible contrast.
- Professional, calm, science-oriented art direction; avoid clutter, neon gradients, generic AI-dashboard styling, and exaggerated medical imagery.

### 2. Main user workflow

Design the workflow around **one SKU at a time**.

1. Find/select an existing catalog SKU.
2. Show its verified product data and any existing approved image.
3. Select an illustration style and intended placement.
4. Compose or refine a generation prompt using verified product facts only.
5. Preview the prompt and the proposed illustration brief before generating.
6. Display the generated candidate in a review state.
7. Allow explicit operator actions: Approve, Request revision, Reject, or Save draft.
8. Show a clear history/status for the selected SKU and distinguish draft, generated, pending review, approved, and rejected assets.
9. Do not automatically move to the next SKU after generation or approval; require an explicit operator action.

Approval must be idempotent and persistent in the eventual implementation. Never regenerate or overwrite an approved asset automatically. Keep a visible confirmation step before approval or replacement.

### 3. Suggested interface

Create a responsive application shell with:
- Header: AIL LABS wordmark text, “Product Catalog Illustration Studio”, environment/status indicator, and a link back to the existing catalog/admin area if a real route is known.
- Left/upper section: SKU search and selection, category filters, product identity, SKU code, product name, verified attributes, and existing asset status.
- Main workspace: large preview canvas with a neutral placeholder before generation; style controls; prompt editor; negative-prompt field; aspect ratio/output placement controls; and a compact checklist of required source data.
- Review panel: candidate preview, version/history, status, notes, and explicit Approve / Revise / Reject controls.
- Footer/help area: reminder that generated visuals are concepts until checked against real packaging and approved source materials.

On mobile, stack sections vertically, keep key actions reachable, avoid horizontal overflow, and use appropriately sized touch targets. Do not rely on hover-only controls.

### 4. Illustration styles

Offer clearly named presets:
- **Premium Clinical Studio** — realistic product photography, soft high-key lighting, white/neutral background, subtle shadow, precise materials.
- **Minimal Catalog Cutout** — clean isolated product render, front-facing, even light, suitable for a catalog thumbnail.
- **Clinical Editorial** — refined editorial composition, restrained cyan accents, ample whitespace, no implied clinical outcome.
- **Packaging Concept** — fictional concept packaging for art direction only; visually mark it as a concept.
- **Ingredient / Texture Still Life** — abstract, non-diagnostic ingredient or texture composition; do not imply a specific ingredient is present unless verified.
- **Campaign Hero** — premium wide composition for a landing-page banner, with generous negative space and no unverified claims.

Provide intended placement options such as catalog thumbnail, product detail, category banner, and homepage hero. The placement setting changes the art direction and aspect ratio recommendation, not the product facts.

### 5. Product categories

Support the existing catalog taxonomy when available. Example categories include:
- HA fillers
- Skin boosters
- Mesotherapy
- Skincare creams and serums
- PDO / PCL / PLLA threads
- Exosome-related products
- OEM / private-label concepts

These are example groupings only. Do not invent SKUs, brand names, manufacturers, product composition, packaging, certifications, registration numbers, clinical indications, or claims. Use real catalog data from the existing repository/database when it is available; otherwise show clearly labeled demo records and never present them as real products.

### 6. Product accuracy and compliance guardrails

These rules are mandatory:
- Treat product name, SKU, manufacturer, ingredients, volume, packaging, and registration/certification details as verified facts only when supplied by the existing catalog or an approved source.
- Do not fabricate BPOM registration, halal status, ISO/GMP certificates, CE marks, FDA status, QR codes, batch numbers, barcodes, logos, manufacturer identities, or regulatory badges.
- Do not add efficacy claims, treatment outcomes, before/after imagery, guaranteed results, unsupported clinical language, or misleading medical diagrams.
- Never portray a concept render as the actual manufacturer packaging.
- If packaging data or a real product reference image is missing, use a generic unbranded mockup and add a prominent visible label: **“CONCEPT — NOT ACTUAL PRODUCT PACKAGING”**.
- If a generated image includes distorted or invented text, treat it as a visual draft only; do not use it as a source of product information.
- Do not infer composition or clinical properties from a product name.
- Provide a checklist requiring human review of brand, packaging, product facts, and compliance before approval.

### 7. Prompt composer requirements

The prompt editor should produce a structured prompt with:
- Product identity (from verified data only)
- Visual subject and composition
- Camera angle and crop
- Lighting and background
- Material and surface treatment
- Brand color guidance
- Intended placement and aspect ratio
- Negative prompt / exclusions
- Required concept disclaimer when the image is not verified packaging

Show a readable final prompt and let the operator copy it. Include a “Reset to preset” action that does not erase product data. Prompt changes should be local draft state until explicitly saved.

Suggested baseline prompt template:

“Create a premium, photorealistic B2B catalog illustration concept for [VERIFIED PRODUCT NAME OR GENERIC PLACEHOLDER]. Composition: [SELECTED COMPOSITION]. Camera: [ANGLE/CROP]. Lighting: soft high-key studio lighting, accurate material response, realistic contact shadow, crisp focus, clean white or soft neutral background. Use restrained AIL LABS cyan (#06B6D4) and orange (#FF7A1A) only as subtle environmental accents, not as unauthorized changes to product packaging. Keep the subject centered and legible at catalog-thumbnail size. Use only the supplied verified product references. Do not invent logos, packaging text, ingredients, certifications, registration marks, QR codes, barcodes, efficacy claims, medical outcomes, or manufacturer details. If the exact packaging is not verified, render a generic unbranded concept and visibly label the result ‘CONCEPT — NOT ACTUAL PRODUCT PACKAGING’. No before/after images, no patients, no surgical scenes, no misleading clinical implications.”

### 8. Technical and repository constraints

This feature belongs in the existing repository `Rady-ail/ail-labs-cloudflare`; do not create a new repository.

Before writing implementation code:
- Inspect the existing project structure, package scripts, routing, styling conventions, catalog data access, authentication, and deployment setup.
- Follow the current stack and conventions. Do not introduce a second framework or duplicate the catalog.
- Keep the Studio isolated in its own route/component/service boundary and make changes additive and minimal.
- Preserve the current Cloudflare Workers deployment, existing routes, assets, production catalog URLs, admin/backend/auth behavior, and Neon PostgreSQL as the source of truth.
- Do not migrate to D1, KV, Hono, or another database/framework.
- Do not alter existing admin authentication or authorization.
- Do not add a new production database schema or migration for a visual prototype.
- Do not connect an image-generation provider, R2 storage, or production APIs until the existing interfaces, credentials, access controls, persistence, and approval flow have been reviewed.
- Never hardcode API keys, secrets, or credentials in client code, source files, prompts, or logs.
- Do not change `main` directly. Work in a feature branch and open a pull request for review.
- Do not merge or deploy automatically.

### 9. Data and asset lifecycle for a future implementation

When integration is explicitly approved, reuse the existing catalog SKU and current database source of truth. Do not create duplicate product records or a second catalog.

The eventual asset workflow should preserve:
- SKU association and source references.
- Prompt text, preset, aspect ratio, and generation timestamp.
- Draft/candidate/review/approved/rejected state.
- Reviewer, review time, and revision notes.
- Durable asset location and version history.
- Idempotent approval and protection against overwriting approved assets.

Use permanent storage only after its configuration and access controls are verified. Do not claim an image has been saved permanently unless the storage operation actually succeeded. Do not store sensitive credentials in asset metadata.

### 10. Quality bar and acceptance criteria

The result should:
- Look like a production-quality premium B2B medical catalog tool.
- Work on small Android screens and desktop without overflow.
- Have meaningful empty, loading, error, draft, and review states.
- Clearly distinguish verified data from editable prompt text and fictional concept imagery.
- Include working interactions for SKU selection, category filters, preset selection, prompt editing, copy prompt, and review-state controls in the prototype.
- Avoid fake functionality: if generation or persistence is not connected, label it “Preview / prototype” and do not pretend a real image was generated or saved.
- Include accessible labels, keyboard-friendly controls, and clear focus states.
- Preserve existing application behavior and pass the repository's available checks.

### 11. Deliverables

First deliver the isolated UI and its interaction states using safe placeholder data if required. Summarize:
1. Files changed.
2. How the feature is isolated from production behavior.
3. Which interactions are real versus mocked.
4. Checks run and their results.
5. Any integration blockers or decisions needed before connecting generation/storage.

Do not merge or deploy. Wait for human review.

## Operator reminder

Start with **SKU 019** as the first test item when a real SKU is available. Work on exactly one product at a time. Do not proceed to the next SKU until the current candidate has been reviewed and the operator explicitly advances.
