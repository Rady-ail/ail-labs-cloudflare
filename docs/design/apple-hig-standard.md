# AIL LABS design standard — Apple HIG / WWDC

Reference for every public page and new UI. Source of truth in code: `public/styles/ail-ios-hig.css` (loaded last) and `public/styles/ail-typography.css`. Enforced by `npm run build` (`scripts/validate-build.js`, "HIG gate").

## Principles (Apple Human Interface Guidelines)
1. **Clarity & content first** — generous whitespace, one clear hierarchy per card, strict grid alignment, 8pt rhythm.
2. **Deference** — glass, blur and motion support content, never compete with it; text stays readable on every surface.
3. **Depth** — thin layered shadows, translucent materials, subtle specular rim; continuous-curvature (squircle) corners.

## Rules
| Area | Standard | Where |
|---|---|---|
| Typography | SF stack (`--font-sf`, Inter fallback), bold headers, tight display tracking, body 17px, **minimum 11px**, form fields 16px (no iOS zoom) | typography.css, hig.css |
| Color | Light + automatic Dark appearance via `--dm-*` tokens; `color-scheme: light dark`; `theme-color` per scheme | hig.css, each page `<head>` |
| Touch | Interactive targets ≥ 44pt on touch devices; hover effects only where hover exists | hig.css |
| Focus | Always visible `:focus-visible` ring; skip link as first focusable element; `main#main-content` | hig.css, each page |
| Layout | `viewport-fit=cover` + `env(safe-area-inset-*)` for header, footer, dock; sticky-header scroll padding | hig.css |
| Motion | Respect Reduce Motion; spring/ease only for user-triggered change | hig.css |
| Accessibility settings | Reduce Transparency, Increase Contrast, Forced Colors fallbacks | hig.css |
| Icons | Thin-stroke line icons, no heavy glyphs | hig.css |
| Content safety | `public/` never holds personal, supplier or customer data (existing build check) | validate-build.js |

## Per-page checklist (new page or redesign)
- `<html lang>`, viewport with `viewport-fit=cover`, `color-scheme`, both `theme-color` variants
- Skip link right after `<body>`; `<main id="main-content" tabindex="-1">`
- `ail-ios-hig.css` linked last (bump `?v=` when it changes)
- Every `<img>` has `alt` (empty `alt=""` only if decorative)
- No text under 11px, no target under 44pt on touch

## Known gaps / follow-ups
- `privacy.html` and `public/admin/` still use their own older stylesheets (privacy: teal `#0e7490` palette, no shared CSS); migrating them to the shared layer is a separate, visual change.
- `public/thalacXail/` is a standalone partner page, outside this standard.
- Contrast ratios should be measured per component with a tool (not asserted here).
