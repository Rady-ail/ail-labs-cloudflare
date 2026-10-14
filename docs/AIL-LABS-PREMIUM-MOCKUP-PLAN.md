# AIL LABS — Premium Professional Product Mockup Rollout

## Objective
Prepare a consistent, minimal, premium-looking illustrative mockup system for the full catalog while keeping production data and deployment untouched until explicit approval.

## Non-negotiable safety rules
- Work only on this feature branch and review through a pull request.
- Do not merge, deploy, or edit production Neon `foto_url` values.
- Keep the production backend, authentication, database schema, and product records unchanged.
- Do not invent product ingredients, product names, claims, certifications, regulatory marks, manufacturer identities, or package sizes.
- Illustrative mockups must be identifiable as illustrative; they must not imply the render is an official manufacturer packshot.
- Preserve the existing verified mapping records for product IDs 3, 7, and 18. Their Canva asset links are not approved production image URLs.
- Never replace a product's existing image until SKU identity, render, dimensions, and stable hosting are verified.

## Visual standard: Premium Professional
- Square 1:1 source canvas, preferably 1264 × 1264 or larger.
- Pure/off-white studio background, restrained soft contact shadow, product centered.
- Consistent visual scale: package occupies about 68–76% of canvas height, with safe whitespace.
- Neutral white/silver packaging, restrained cyan (#06B6D4) and tiny orange (#FF7A1A) accents.
- Clean, legible typography; no extra props, gradients, busy patterns, hands, or decorative plants.
- Keep cards visually consistent on desktop and mobile with a fixed aspect ratio and `object-fit: contain`.
- The mockup must not create fictitious efficacy claims or imply BPOM, halal, ISO, CE, or other certification.

## Catalog workflow
1. Inventory all catalog SKUs from the repository/database read-only; record product ID, exact product name, actual package type/size only when present in source data, existing image URL, and image status.
2. Assign each SKU to a package template family (vial, bottle, dropper, tube, jar, carton, device/other) based on verified source data. Do not infer missing package details.
3. Create the visual template and render queue. Use generic neutral packaging where actual package references are unavailable; clearly flag these as illustrative.
4. Generate/render in small batches, one SKU at a time, preserving the SKU-to-render mapping. Track statuses: QUEUED, RENDERED, QA_REQUIRED, VERIFIED, REJECTED.
5. Verify each asset's correct SKU association, label spelling, package form, square dimensions, visual consistency, and stable downloadable/public URL.
6. Store approved assets in stable project-controlled hosting before considering any production URL change. Canva open/view URLs alone are not accepted as permanent production image URLs.
7. Build a preview page or screenshot for desktop and mobile and inspect broken images, crop, card height, and loading performance.
8. Submit the complete change as a draft pull request. Do not merge or deploy without explicit user confirmation.

## Suggested manifest fields
- `product_id` (required; sourced from catalog)
- `product_name` (required; exact source spelling)
- `source_package_type` / `source_package_size` (nullable; only if verified)
- `mockup_template`
- `asset_id` / `asset_url`
- `dimensions`
- `status`
- `qa_notes`
- `stable_host_verified` (boolean)
- `production_url_changed` (must remain false until explicit approval)

## Existing verified assets — keep unchanged
See `docs/AIL-LABS-CANVA-RENDER-MAP.json` on branch `phase-product-mockup-render-queue`:
- Product ID 3 — ClearSkin Spot Cream — Canva asset `MAHXQY4G3r8`
- Product ID 7 — ClearSkin Scar Fix Clinda — Canva asset `MAHXQQVopzc`
- Product ID 18 — ClearSkin Strongest — Canva asset `MAHXQZQZtH4`

These are verified Canva assets only. Their URLs have not been proven suitable as permanent production URLs, so production `foto_url` remains unchanged.

## Acceptance criteria
- Every catalog SKU has exactly one manifest entry, or an explicit `BLOCKED_MISSING_SOURCE` status.
- No invented labels, claims, package specifications, or compliance badges.
- All approved assets pass SKU mapping and visual QA.
- Desktop and mobile product cards have consistent image aspect ratio and alignment.
- No database mutation, production URL change, merge, or deployment occurs without explicit approval.
