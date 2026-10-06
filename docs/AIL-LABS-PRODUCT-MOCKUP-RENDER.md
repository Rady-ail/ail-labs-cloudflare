# AIL LABS — Product Mockup Render Queue

Status: READY FOR ONE-BY-ONE RENDER
Repository: Rady-ail/ail-labs-cloudflare
Source catalog: Neon production `products` table
Active SKUs at queue creation: 298
Existing catalog photo records: 99
Missing catalog photo records: 199

## Non-negotiable render rules

1. Render ONE SKU at a time.
2. Use a square 1:1 canvas.
3. Background: pure white or transparent-look studio white.
4. Use the official AIL LABS logo when supplied.
5. Show exact product name and exact `kandungan` from the catalog.
6. Show `kemasan` only when useful for identification.
7. Never invent manufacturer, BPOM/registration number, barcode, certification, dosage instruction, medical claim, or regulatory statement.
8. If an original product image is available, use it as the visual reference and preserve its packaging, typography, proportions and identity.
9. If no original product image is available, generate a clearly generic concept mockup appropriate to the product form; never imply that invented packaging is the manufacturer's original packshot.
10. Match physical form to product type:
   - cream/ointment: cosmetic/pharma jar or tube
   - serum/oil/solution: dropper or bottle
   - injection: vial/ampoule/sterile pharmaceutical carton
   - infusion: IV bottle/softbag/carton
   - mask: sheet-mask box/pouch
   - peel/powder: bottle, vial or professional pouch according to the catalog packaging
   - thread/suture: sterile pouch/carton; do not render exposed needles as a decorative prop
11. Premium commercial photography: physically correct materials, realistic micro-texture, controlled reflections, accurate perspective, softbox lighting, subtle contact shadow, clean white balance, sharp edges.
12. No people, hands, extra products, clutter, decorative props, fantasy effects or watermark.
13. Product should occupy about 65–75% of the square frame.
14. AIL LABS is the distributor/curator identity, not a fabricated manufacturer identity.
15. Every rendered asset must be reviewed before it is promoted to production.

## Master Canva prompt

Create ONE ultra-photorealistic premium B2B medical/aesthetic product mockup for AIL LABS. Use the exact catalog data supplied below. Match the physical product form to the product type and package specification. Preserve any supplied original product packaging exactly; do not redesign it.

Brand identity: AIL LABS — PT Fudhail Aesthetic Laboratories.
Product name: {{PRODUCT_NAME}}
Key ingredient/content: {{KANDUNGAN}}
Package: {{KEMASAN}}

Canvas: 1:1 square. Background: pure clean white or transparent-look white studio. Use the supplied official AIL LABS logo discreetly as distributor/curator branding. Product name and ingredient text must match the supplied catalog data exactly. Do not invent manufacturer, BPOM number, registration number, barcode, certification, dosage instruction, medical claim, or regulatory text.

Photography: hyper-realistic commercial studio packshot, physically accurate material response, realistic micro-texture, crisp typography, controlled highlights, subtle natural contact shadow, premium clinical lighting, accurate perspective, sharp edges, high-end e-commerce/catalog quality. Product centered and occupying 65–75% of frame. No people, hands, extra products, decorative props, clutter, gradients, surreal effects, distorted text or watermark.

If an original product photo/reference is supplied, use it as the primary visual reference and preserve the real package identity. If no source photo exists, create only a generic concept mockup appropriate to the package form and do not imply it is the original manufacturer's packaging.

## First render initiated

SKU 160 — Asam Traneksamat 500 mg
Kandungan: Asam Traneksamat 500 mg
Kemasan: 10 Strip / Box
Render mode: generic pharmaceutical concept mockup because no source photo is currently stored for this SKU.

## Important production constraint

Canva image-generation returns generated media inside Canva. The connector available in this session does not expose a direct binary download endpoint for generated media, so generated Canva images cannot honestly be claimed as committed PNG/JPG files in GitHub from this tool alone.

Therefore:
- Canva is the render engine.
- GitHub stores the render queue/specification and integration metadata.
- A generated asset is only promoted into `public/images/products/` after an actual downloadable image file is available.
- Do not write fake image files or fake URLs into production.
