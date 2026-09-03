# JBG Pipeline #2 — Module M9: Gateway Ingest

**Date:** 2026-06-09
**Workflow:** JBG Pipeline #2 (`1MgjaMZxQYm5mpz7`) on jordano.app.n8n.cloud
**Gateway:** https://jbg-gateway-production.up.railway.app
**Status:** IMPLEMENTED 2026-06-09 as a standalone workflow (build-target decision below) — **JBG Gateway Ingest (M9)**, id `8I7BSwsWgeI3AlXE`, inactive/manual. Not spliced into production "JBG Pipeline #2" yet. In the standalone build, M9.1 reads asset URLs from a source Sheet row (`Image_URL`, `Lifestyle_URL_1..3`, `QR_URL`) instead of live pipeline nodes; on splice, swap those references to M2.5.3/M3.x.

---

## 1. Purpose

After the pipeline finishes generating a product's assets (poster, QR, 3 lifestyle
images), capture every gateway-required field into a structured row, persist it (Google
Sheet + .xlsx snapshot), then submit it to the JBG Gateway: validate first against the
no-auth `/test` endpoint, and only on success POST the real payload to the authenticated
`/webhooks/n8n` endpoint. Re-runs must not create duplicate products.

## 2. Scope

**In scope:** a new module **M9 (11 nodes)** appended to the existing live chain after
`M3.7 Upload Lifestyle 3`. One-time setup: a `Gateway_Ingest` Sheet tab, an n8n JWT
variable, a Drive snapshot folder.

**Out of scope:** generating the missing thumbnail/banner assets (stubbed for now — see
§7); wiring disconnected modules M4–M8; the gateway's own downstream Shopify processing
(not yet implemented server-side).

## 3. Decisions (locked with Sam)

| Decision | Choice |
|----------|--------|
| Payload assembly | Dedicated assembler node (not pre-existing) |
| Insertion point | After `M3.7`, on the live chain |
| Shopify/content data source | Google Sheet row |
| JWT auth | Static token read from n8n **variable** `JBG_WEBHOOK_JWT` |
| Template population | **Both** — write Sheet row AND export .xlsx snapshot to Drive |
| Row's role | **Source of truth** — assembler reads the written row |
| Dedup guard | **Yes** — skip Post if `slug_exists[handle]` is true |

## 4. Architecture / data flow

```
M3.7 Upload Lifestyle 3
 │
 ▼
M9.1 Map Fields ............ Code: pipeline + JBG defaults → flat 62-field row object
 ▼
M9.2 Write Row ............. Google Sheets append/update → "Gateway_Ingest" tab
 │                           emits stored row  ◄── SOURCE OF TRUTH
 ├──────────────► M9.3 Convert to XLSX ─► M9.4 Upload Snapshot (Drive)
 │                (Spreadsheet File)       {Product_Name}_gateway.xlsx
 ▼
M9.5 Assemble Payload ...... Code: row → IngestWebhookDto JSON
 ▼
M9.6 Verify ................ HTTP POST /api/v1/webhooks/n8n/test  (no auth, onError: continue)
 ▼
M9.7 Route (Switch) ........ 3 outcomes:
 ├─ valid & NOT exists ─► M9.8 Post ─► /api/v1/webhooks/n8n
 │                         (X-Webhook-Secret = {{ $vars.JBG_WEBHOOK_JWT }})
 │                         └─► M9.9  Status: "queued" + job_id  → row
 ├─ valid & exists ─────► M9.11 Status: "Already Ingested" (skip Post) → row
 └─ invalid (error) ────► M9.10 Status: "Validation Failed" + errors → row
```

## 5. Node specifications

### M9.1 Map Fields — Code node
Builds a single flat object with the 62 template columns. Sources:
- **From pipeline nodes:** `poster_url` ← `M2.5.3.webViewLink`; `lifestyle_url_1..3` ←
  `M3.3/M3.5/M3.7.webViewLink`; `poster_size_bytes` ← Drive node `fileSize` if available.
- **From the Sheet row (`M1.1`):** `Product_Name`, `qr_target_url` ← `QR_URL`, and any
  content/Shopify columns already present.
- **Derived:** `product_handle` = slugify(`Product_Name`); `title` = `Product_Name` (until a
  real title column exists); `seo_url_handle` = `product_handle`.
- **JBG defaults:** `is_bundle`=FALSE, `language`=en, `poster_width_px`=5100,
  `poster_height_px`=3300, `poster_dpi`=300, `poster_format`=png, `qr_embedded`=TRUE,
  `shopify_status`=draft, `product_type`=Educational Poster, `vendor`=Jelly Bean Genius,
  `inventory_policy`=deny, `inventory_management`=shopify, `fulfillment_service`=manual,
  `requires_shipping`=TRUE, `taxable`=TRUE, `weight_unit`=lb, `shipping_is_physical`=TRUE,
  `utm_source`=qr, `utm_medium`=poster, `utm_campaign`=`product_handle`.
- **Stubs (Tier-1 gaps):** `thumbnail_url`, `banner_url`, `qr_image_url` default to
  `poster_url` until real assets exist. `price` default placeholder `"0.00"`.

### M9.2 Write Row — Google Sheets (append or update)
Operation: appendOrUpdate, matching on `Product_Name`. Target: pipeline workbook
`1nUZWFWLKTCnubBBYcdTGS3Epq-k0D6lwTt4mnaDfO04`, tab `Gateway_Ingest` (62 columns).
Node output (the stored row) is the source of truth consumed downstream.

### M9.3 Convert to XLSX — Spreadsheet File (operation: toFile, fileFormat: xlsx)
Converts the row to an .xlsx binary. Note: plain data only — no styling, no Field_Map tab.

### M9.4 Upload Snapshot — Google Drive
Filename `{{ $('M9.1').item.json.Product_Name }}_gateway.xlsx`. Folder: existing pipeline
Drive folder `12BH9LQ_MHG7IVl145ezONOjtLSu3EJEC` (confirm or override).

### M9.5 Assemble Payload — Code node
Reads M9.2's row. Produces `IngestWebhookDto`:
- Constants: `event`="pack.created", `version`="2.0", `timestamp`=`$now.toISO()`.
- `bundle.is_bundle`=false, `bundle.shopify`=null, `bundle.products`=[{ pack, shopify }].
- Transforms: CSV → arrays (`curriculum_tags`, `collections`, `tags`); coerce numerics
  (px/dpi/weight/qty) and booleans; `price` kept as string.
- Derived: `variants[0].sku`=`Product_Name`; all asset `filename`s from `product_handle`
  using gateway-compliant patterns (e.g. `^[a-z0-9-]+_poster_main\.png$`); `shopify.images[]`
  from `poster_url`; `audio_tracks`=[]; `metafields`=[].

### M9.6 Verify — HTTP Request
`POST {gateway}/api/v1/webhooks/n8n/test`, JSON body = assembled payload.
`onError: continueRegularOutput` so a 400 flows on for inspection rather than aborting.

### M9.7 Route — Switch node (3 outputs)
Reads the `/test` response + `product_handle`:
1. `status === "valid"` AND `slug_exists[handle] === false` → **Post**
2. `status === "valid"` AND `slug_exists[handle] === true` → **Already Ingested**
3. otherwise (`status === "error"` / 400) → **Validation Failed**

### M9.8 Post — HTTP Request
`POST {gateway}/api/v1/webhooks/n8n`, JSON body = same payload, header
`X-Webhook-Secret: {{ $vars.JBG_WEBHOOK_JWT }}`. `onError: continueRegularOutput`.

### M9.9 / M9.10 / M9.11 Status writeback — Google Sheets (update, match Product_Name)
- M9.9 (after Post): `gateway_status`="queued", `job_id` ← response `job_id`.
- M9.10 (invalid): `gateway_status`="Validation Failed", `validation_errors` ← `errors.join(" | ")`.
- M9.11 (exists): `gateway_status`="Already Ingested".

## 6. Error handling

| Failure | Behavior |
|---------|----------|
| `/test` returns 400 | M9.6 continues; M9.7 routes to M9.10; errors recorded; no Post |
| Handle already exists | M9.7 routes to M9.11; no Post; no duplicate created |
| `/webhooks/n8n` returns 401 | Bad/missing JWT variable — M9.8 continues; surface in status (record code) |
| `/webhooks/n8n` returns 400 | Should be unreachable (test passed first); record if it happens |
| Drive/Sheets node error | `onError: continueRegularOutput` so snapshot/writeback failures don't block ingest |

## 7. Known gaps carried forward (Tier-1)

`thumbnail_url`, `banner_url`, `qr_image_url`, and `price`/SEO/description are stubbed in
M9.1 to achieve a passing `/test`. Promote to real values later by: adding thumbnail+banner
generation nodes, uploading the M2.5.1 QR image for its own URL, and wiring M6 listings for
SEO/description/price. Tracked as a follow-up, not part of this module.

## 8. Setup prerequisites (one-time)

1. Create the `Gateway_Ingest` tab (62 headers) in the pipeline workbook — import from
   `JBG_Gateway_Ingest_Template.xlsx`.
2. Set n8n variable `JBG_WEBHOOK_JWT` to the gateway's signed JWT. *(If the n8n Cloud plan
   lacks Variables, fall back to `$env.JBG_WEBHOOK_JWT` or a Header Auth credential.)*
3. Confirm the Drive folder for .xlsx snapshots.

## 9. Testing strategy

1. **Dry run, defaults only:** trigger one product; confirm M9.6 `/test` returns
   `status: valid` with stubs.
2. **Dedup:** re-run the same product; confirm M9.7 routes to "Already Ingested", no Post.
3. **Negative:** break a filename/required field in M9.1; confirm M9.10 records the
   gateway's `errors[]`.
4. **Live Post:** with `JBG_WEBHOOK_JWT` set, confirm M9.8 returns `queued` + `job_id` and
   M9.9 writes them back.

## 10. Open items
- Drive snapshot folder: reuse pipeline folder vs. dedicated? (default: reuse)
- Real `title` column vs. `Product_Name` reuse.
- n8n plan: does it support `$vars`? (confirms auth wiring)
