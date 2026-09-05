# Migrating this UI into `jbg-gateway`, served at `/beta-2`

**Status:** plan only. No code was written in the session that produced this.
**Author's note:** every claim below is cited to a file and line, or to a command
whose output is quoted. Where I could not verify something I say so.

---

## 1. The goal, restated

Serve the single-file app at `/home/john/code/jbg-images/index.html` from the
gateway at `/beta-2`, alongside `/console` and `/packing`. Where the gateway
cannot yet answer something the UI needs, build it in the gateway — under the
gateway's conventions, not this file's.

---

## 2. What was verified

| Question | How | Answer |
|---|---|---|
| How are `/console` and `/packing` mounted? | `src/packing/packing-app.module.ts`, `src/console/console-app.module.ts` | `ServeStaticModule` in a `forRoot(distPath)` dynamic module, registered only if `dist/index.html` exists |
| What is the API shape? | `src/main.ts:60-62` | Global prefix `api`, URI versioning, default `v1` → `/api/v1/...` |
| What CSP ships? | `node -e "helmet.contentSecurityPolicy.getDefaultDirectives()"`, helmet `^8.2.0` | See §3.1 — it blocks this UI outright |
| Migration naming | `ls prisma/migrations` | `YYYYMMDDHHMMSS_sprint_<letter>_<slug>`, latest `20260820120000_sprint_an_superseded` |
| Next free sprint letter | `grep "Sprint A[A-Z]" docs/production-management-system-design.md` | **AP** (AO is taken — delivered 2026-08-19, no migration) |
| Per-shipment box numbering | `prisma/migrations/20260804090000_sprint_q_shipment_box_sequence/` | **Already exists** — `Box.shipmentSeq` |
| Auto box planner | `grep -rlnE "planBoxes|binPack|firstFit|autoPack" src` | **Does not exist** |
| Pricing model | `grep -iE "price|msrp|cost" prisma/schema.prisma` | **Does not exist** |

---

## 3. The three findings that shape the plan

### 3.1 The CSP blocks this UI outright — this is the real blocker

Helmet 8 defaults, unmodified except `img-src` and `frame-src`
(`src/common/security-headers.ts:60-72`):

```
default-src      'self'
script-src       'self'
script-src-attr  'none'
style-src        'self' https: 'unsafe-inline'
img-src          'self' data: <configured>
object-src       'none'
```

Measured against `index.html`:

| What the UI does | Count | Directive | Result |
|---|---|---|---|
| `onclick=` / `onchange=` / `oninput=` / `onerror=` attributes | **161** | `script-src-attr 'none'` | **all dead** |
| Inline `<script>` blocks | 4 | `script-src 'self'` | **all dead** |
| `(0,eval)(atob(__L1))` vendor bootstrap (`index.html:5`) | 1 | `script-src 'self'` | **dead** |
| `fetch` to `ajwzfhddyhkdoosomuaz.supabase.co` | every call | `connect-src` ← `default-src 'self'` | **dead** |
| `fetch` to Slack webhook, GCS `new_arrivals.json` | 2 | same | **dead** |
| Theme song from `cdn1.suno.ai` (`index.html:2014`) | 1 | `media-src` ← `default-src` | **dead** |
| `html2canvas` from cdnjs (`index.html:1281`) | 1 | `script-src 'self'` | **dead** |
| `<style>` blocks | 4 | `style-src … 'unsafe-inline'` | fine |
| base64 `data:` images | many | `img-src … data:` | fine |

So "just mount the file" is not an option that produces a working page. There is
one CSP exemption precedent — `/admin` for Bull Board
(`src/common/security-headers.ts:76-82`) — and its justification is explicitly
that it is *third-party* and *admin-only*. A first-party app that interpolates
database strings into `onclick` attributes (`esc(p.sku).replace(/'/g,"\\'")`,
used at ~40 call sites) does not qualify for the same reasoning, and turning CSP
off around it would be the largest single security regression in the repo.

### 3.2 The gateway plans *lines*; this UI plans *cartons*

This is the deep mismatch, and it is not what I first thought.

- `POST /shipments/:ref/plan` declares **what a consignment is for** — "Amazon
  wants 112 of this and 60 of that". Progress is *derived* by counting units
  across the shipment's boxes, never stored.
- A `Box` in the gateway comes into existence when a packer **opens** one at a
  bench. It carries `station`, `openedBy`, `plannedShipmentId` (intent — "moves
  no stock and commits nothing", `prisma/schema.prisma:1007-1013`), and is
  promoted to committed membership when sealed.
- `planBoxes` in this UI (`index.html:804`) does the opposite: it materialises
  N cartons up front, all `pending`, and packers claim them.

Mapping the UI's four box states onto what already exists:

| UI status | Gateway equivalent | Exists? |
|---|---|---|
| `pending` | — a planned, unopened carton | **No** |
| `picking` | `status: open` + `station` + `plannedShipmentId` | Yes |
| `packed` | `status: closed` (promotes to `shipmentId`, allocates) | Yes |
| `shipped` | shipment `dispatched` | Yes |

**Three of the four already exist.** The only missing state is `pending`, and it
is missing *because* of the up-front planner. So §3.2 and "there is no auto box
planner" are one gap, not two — which is why §6 solves them together, and why the
recommended shape needs **no new `BoxStatus` value at all**.

### 3.3 Two gaps I named in the earlier review are already solved

Correcting the record, per README §6.1 rule 2 ("check whether it already exists"):

- **Per-consignment box numbering** — `Box.shipmentSeq` exists (Sprint Q). Its
  migration comment explains why `boxNumber` cannot serve: it is global, printed
  on labels, encoded in QRs, and part of idempotency keys. `shipmentSeq` is
  re-sequenced contiguously on every add and remove. Nothing to build.
- **"Packed so far" per plan line** — derived from `BoxItem` quantities across
  the shipment, in keeping with the ledger rule that balances are summed and
  never stored. Nothing to build. What *is* missing is narrower than I said —
  see §7.

---

## 4. The recommended path

Three options were considered for getting the page onto `/beta-2`.

| | Approach | CSP | Databases | Effort |
|---|---|---|---|---|
| **A** | Mount `index.html` unchanged, exempt `/beta-2` from CSP | wholesale hole | two | ~1 day |
| **B** | Mechanically de-inline it, keep the DOM-string architecture | one scoped widening | one | ~1 week |
| **C** | Rebuild as a React+Vite workspace, as Sprint I-a did for `Catalog Dashboard.html` | none | one | ~3–4 weeks |

**Recommendation: B, then C for the screens that earn it.**

B is the honest middle. The de-inlining is mechanical, not a rewrite:

1. The 4 inline `<script>` blocks become 4 real files. The two base64 blobs
   (`window.__L1`, `__L2` — 1.4 MB of packed vendor code at `index.html:4`) ship
   as plain `.js`, which deletes the `eval` at `index.html:5` entirely.
2. The 161 inline handlers become one delegated listener on `#app` reading
   `data-action` / `data-arg` attributes. Every handler in this file is already
   a call to a named global with string arguments, so the transformation is
   uniform.
3. `script-src-attr` may then stay `'none'`. Nothing is widened.

Only step 2 is real work, and it is the same work option C would have to do
anyway. What B does *not* fix is the architecture from the earlier review — one
global `STATE`, full `innerHTML` re-render, `localStorage` price book. Those are
C's problem, and C should be taken screen by screen once the backend below
exists, not as a big-bang rewrite.

**Precedent worth reading before deciding:** design doc §9 records that
`Catalog Dashboard.html` was treated as "a **proof of concept** ... referenced by
no code or config, never built and never served", and Sprint I-a rebuilt the
console fresh, keeping the *interaction shape* and palette but replacing the
JS-literal catalogue with a live `GET /catalog`. That is the same decision being
taken again here, and the same reasoning applies to `index.html`'s `BYSKU`
literal (`index.html:685`, 136 KB) and its `PASSCODE='2026'` gate
(`index.html:2015`).

**Sequencing.** The backend sprints (§6–§8) are needed under either B or C and
do not depend on the frontend decision, so they can start immediately and in
parallel. The mount (§5) is small and can land first so the URL exists.

---

## 5. Sprint AP — the mount

**Goal:** `/beta-2` serves a built app from the gateway, same origin, no CORS.
No behaviour change to anything else.

### Workspace

`apps/beta-2`, an npm workspace (root `package.json` already declares
`workspaces: ["apps/*"]`, so no root change beyond scripts).

- `package.json` name `@jbg/beta-2`, matching `@jbg/packing` / `@jbg/console`.
- `vite.config.ts` with `base: '/beta-2/'` — **must match** `BETA2_APP_ROUTE`.
  This is stated as a requirement in the existing modules' doc comments
  (`src/packing/packing-app.module.ts:8`).
- Consumes `@jbg/shared` via the same Vite alias + `tsconfig` path the other two
  apps use. Anything the Code 128 encoder, the FNSKU-or-internal-code rule, or
  the `ApiError` shape covers must come from there — a second implementation is
  a bug, not duplication (README §2.2).

### Gateway module

`src/beta2/beta2-app.module.ts`, modelled line-for-line on
`src/console/console-app.module.ts`:

```ts
export const BETA2_APP_ROUTE = '/beta-2';
export function defaultBeta2AppDist(): string   // env BETA2_APP_DIST ?? cwd/apps/beta-2/dist
@Module({}) export class Beta2AppModule {
  static forRoot(distPath = defaultBeta2AppDist()): DynamicModule
}
```

Non-negotiables carried from the existing modules:

- Registration **conditional on `existsSync(join(distPath,'index.html'))`**. A
  gateway with no frontend build still boots and still serves its API — that is
  the normal state during backend work and the state the jest suite runs in.
  Log at `log` when built, `warn` naming `npm run build:beta2` when not.
- `exclude: ['/api/{*path}']` — without it the SPA fallback answers unknown API
  routes with HTML, and a fetch client reads that as an unparseable 200 rather
  than the 404 it is.
- `serveStaticOptions`: `index: false`, and `Cache-Control` `no-cache` for
  `.html`, `public, max-age=31536000, immutable` otherwise.
- Registered in `src/app.module.ts` next to `PackingAppModule.forRoot()` and
  `ConsoleAppModule.forRoot()`.

### npm scripts

Added to the root `package.json`, mirroring the existing pairs:

```
build:beta2   npm run build --workspace apps/beta-2
dev:beta2     npm run dev   --workspace apps/beta-2
test:beta2    npm run test  --workspace apps/beta-2
```

and appended to the aggregates: `build:apps` and `test:apps`. `test:browser`
already runs `build:apps` first, so it picks the new app up with no change.

### Tests

- `test/beta2-app.e2e-spec.ts`, modelled on `test/packing-app.e2e-spec.ts`:
  serves at `/beta-2/`, serves fingerprinted assets with an `immutable` header,
  `no-cache` on `index.html` and on a deep link, and **leaves the API alone**
  (`GET /api/v1/boxes` still returns JSON). Uses a `mkdtempSync` fixture dist so
  the test needs no frontend toolchain.
- One browser spec in `test/browser/` only once there is a screen worth
  asserting. `npm run test:browser` is required by README §6.3 whenever "a
  screen or the static mount" changes, so it is required for this sprint.

### Docs

Design doc **§9 is titled "The two operator apps"** and its body says "They are
**separate apps** on purpose ... unified by one backend." Adding a third app
makes that section wrong, and README §6.1 rule 3 requires fixing the doc in the
same PR. Rename to reflect three, and record what `/beta-2` is *for* — a beta of
the order→print→pack flow — so the next reader does not have to infer it.

**Schema change: none. Migration: none.**

---

## 6. Sprint AQ — cartonisation advice

**The gap:** the gateway can say *what a consignment needs*; it cannot say *how
many cartons that is, or which poster goes in which*. `planBoxes`
(`index.html:804`) does exactly that and has no server counterpart.

**The shape, and why.** Two designs were considered:

- *Materialise planned cartons* — add a `planned` value to `BoxStatus` and write
  N `Box` rows up front. **Rejected.** It puts rows in the boxes table for
  cartons that do not exist, and `Box` is already the record of a physical
  object with `openedAt`, `openedBy`, `station` and a `boxNumber` that gets
  printed on a label. It would also force `reflowPending`-style renumbering of
  rows other people may be looking at — one of the concurrency hazards the
  earlier review flagged in this UI.
- **Advice, not a record** — a read-only endpoint that computes a suggested
  cartonisation from the shipment's plan and its current contents, and returns
  it. Nothing is written; a carton exists when a packer opens one, exactly as
  today. **Chosen.** It matches `plannedShipmentId`'s stated reasoning — intent
  that "moves no stock and commits nothing" — and it needs **no schema change**.

### Endpoint

```
GET /api/v1/shipments/:ref/cartonisation
```

- Roles: `...FLOOR_ROLES, Role.manager` — same set as the box routes it feeds.
- Reads the shipment plan, subtracts what the shipment's boxes already hold
  (derived, per §3.3), and packs the remainder.
- Response: an array of suggested cartons — `size`, `boxTypeRef`, projected
  `weight`, `unitCount`, and `items[{ variantId, sku, shortTitle, qty }]` —
  plus a per-line summary of what is outstanding.
- `GET`, not `POST`: it writes nothing, and it must be safe to poll while two
  benches are working.

### Where the algorithm lives

`src/boxes/cartonisation.ts`, a pure function, unit-tested directly. The port of
`planBoxes` must replace three of its inputs with real gateway data rather than
carrying the guesses across:

| `index.html` | Replace with |
|---|---|
| `SETTINGS.weights` hardcoded per size (`index.html:673`) | `BoxType` (`maxWeight`, `maxUnits`) + `EnvelopeType` + `ProductVariant.weight` |
| `sheetsOf(sku)` — regex over the SKU string (`index.html:696`) | `Product.isBundle` + `BundleComponent` |
| `sizeOf(sku, meta)` — regex fallback (`index.html:695`) | `ProductVariant.size` |

Those three registries are the reason this belongs server-side: the UI's copies
disagree with each other today (`planBoxes` uses `sheetsOf`, `unitOzFor` prefers
`sheets_db`), which is finding #6 of the earlier review.

**Capacity limits are per box, not per carton type** — `Box.maxWeight` /
`maxUnits` exist and the box-limits route's doc comment explains why ("the same
carton takes about 29 twelve-packs or about 80 single posters, and only the
packer knows which run this is"). The suggestion seeds from the `BoxType`; the
packer's `POST /boxes/:ref/limits` still overrides.

### Tests

- Unit: `src/boxes/cartonisation.spec.ts` — one size per carton, weight cap
  respected, bundle sheet counts, a line larger than one carton splitting, and
  the empty-plan case.
- Integration: a consignment with a plan and one partly-filled box returns
  suggestions for the remainder only.

**Schema change: none. Migration: none.**

---

## 7. Sprint AR — closing a plan line short

**The gap, narrowed.** I said earlier that `PickListLine` has no `qtyPicked`.
That was the wrong framing: progress *is* derivable from `BoxItem` quantities,
and storing it would violate the ledger rule. What is genuinely inexpressible is
the difference between:

- "we have packed 9 of 12 and are still going", and
- "we packed 9 of 12, there are no more, **the line is closed short**".

The UI records the second and surfaces it — `packBox` computes `shorts` from
`actual < qty` and the Box Register renders a shortage banner
(`index.html:1793-1799`, `viewRegister`). It is a real business output: refill
and backorder come off it. The gateway cannot say it.

### Endpoint

```
POST /api/v1/shipments/:ref/plan/short
```

- Body: `{ lines: [{ variantId | barcode, qty, reason }] }`.
- Roles: `admin`, `manager` — this is an override in the same family as the
  over-pack override, and the existing pattern is that overrides carry a reason
  and are not available to the floor alone. **Confirm this** against
  `BoxesService.addItem`'s override before implementing; do not widen a role set
  to make a test pass (README §2.4).
- Refuses when `qty` exceeds what is actually outstanding, and on a shipment
  that is no longer a draft.

### Schema

```
prisma/migrations/20260824100000_sprint_ar_short_close/
```

- `PickListLine.qtyShort  Int    @default(0)`
- `PickListLine.shortReason String?`
- `PickListLine.shortedById / shortedBy / shortedAt` — the same
  `openedById`/`openedBy` denormalised-actor pair `Box` already uses, so a
  deleted user does not erase who did it.
- `ShipmentEventType` gains `line_shorted`; `AuditAction` gains
  `plan_line_shorted` and `AuditSubject` gains `shipment` if it is not already
  there (it is **not** in the enum today — check `prisma/schema.prisma:542`).

`qtyShort` is a **declaration**, not a count, which is why it is stored while
`qtyPacked` stays derived. A line is complete when
`qtyPacked + qtyShort >= qtyExpected`.

### What is deliberately not built

The UI's per-item `picked` tick (`togglePick`, `index.html:1791`) is checklist
state inside one packer's session, not a fact about the world. It stays client
side. Persisting it would invite exactly the two-packer divergence the earlier
review flagged, and the gateway already knows what is in the box.

### Tests

- Short-closing part of a line leaves it outstanding; short-closing the
  remainder completes it.
- A short beyond what is outstanding is a 409.
- A floor role without `manager` is refused.
- The event and the audit row are both written.

---

## 8. Sprint AS — the catalog fields the UI reads

Small, and mostly additive to `CatalogItemDto`
(`src/catalog/dto/catalog-item.dto.ts`), which already carries `imageUrl`,
`fnsku`, `asin`, `size`, `formatCode`, `shortTitle`, `isBundle`, `weight`,
`envelopeType` and live balances.

| UI reads | Source | Action |
|---|---|---|
| `p.pdf` / `printPdfUrl(sku)` (`index.html:842`) | `Asset` where `kind: print_file` | **Add** `printFileUrl` to the DTO. This retires the URL-guessing that made the Print Queue display one filename and send another (earlier review, finding #2). |
| `p.line` / `LINE_LABEL` tabs | `Product.topicKey` + `subject` | **Map**, do not add. `topicKey` is the categorisation column; the UI's `line` is the same idea under a different name. |
| `p.sheets_db` | `Product.isBundle` + `BundleComponent` | Expose a derived `unitCount`; retires `sheetsOf()`. |
| New Arrivals 7-day window (`index.html:1963`) | `Product.createdAt` | **Add** `since` (ISO date) and `sort=newest` to `CatalogSearchDto`. Retires the `storage.googleapis.com/.../new_arrivals.json` fetch, which CSP blocks anyway. |
| `thumb_url` | `Asset` where `kind: thumbnail` | Verify `imageUrl` already resolves this; if it prefers `poster`, the packing screens' choice governs — do not add a second field. |

Migration only if a column is genuinely added; the four rows above are DTO and
query work. `printFileUrl` may need an index on `Asset(productId, kind)` —
check the existing `@@unique([productId, kind, filename])` first, which probably
already serves it.

---

## 9. Pricing — left out of this plan, deliberately

The Wholesale Sheet, the price book (cost / bulk cost / MSRP / MAP / wholesale)
and the quote builder are three of the UI's ten screens
(`viewWholesale` `index.html:1343`, `quoteMultiHtml` `index.html:1477`,
`exportExcel` `index.html:1237`). They persist to `localStorage` — meaning the
prices exist on exactly one iPad and vanish with the browser cache.

The gateway has **no pricing model at all**; I grepped the full 2078-line schema.

I am not specifying it here, because it is a product decision rather than a
migration: whether pricing belongs in this system or in Shopify (which already
holds prices for the storefront channel) changes the answer completely, and
guessing would cost more than asking. **See §12.**

If the answer is "here", it is its own sprint and its own design-doc section —
not a column bolted to `ProductVariant`, because cost, MAP, MSRP and a negotiated
wholesale price are four different facts with four different owners and audit
requirements.

---

## 10. What does not get ported

| In `index.html` | Why not |
|---|---|
| `PASSCODE='2026'` client gate (`index.html:2015`) | Replaced by `POST /api/v1/auth/login` and the four real roles. The current gate is a `div` that hides itself. |
| Direct Supabase client + anon key (`index.html:679-681`) | The whole point of the migration. Also blocked by `connect-src`. |
| Slack webhook in `localStorage` (`index.html:1637`) | The gateway owns Slack (`src/slack`). Blocked by `connect-src` regardless. |
| Theme song from `cdn1.suno.ai` (`index.html:2014`) | Blocked by `media-src`. Ship it as a local asset or drop it — a cosmetic call, not a technical one. |
| `html2canvas` from cdnjs (`index.html:1281`) | No new dependency without approval (README §6.2). If JPEG export survives the port, it needs a decision first. |
| `BYSKU` literal, 136 KB (`index.html:685`) | Same call Sprint I-a made: replaced by a live `GET /catalog`. |
| Google Sheet sync claim in the Box Register | It does not exist — the button is `toast('Demo: opens the linked Google Sheet')`. Either build it or delete the claim; do not carry a false label into the gateway. |

---

## 11. Definition of done

Per README §6.3, for **every** sprint above — all of them, not most:

- [ ] `npm test` green, output pasted
- [ ] `npm run build` clean
- [ ] `npm run typecheck` clean
- [ ] `npm run test:apps` green (any sprint touching `apps/`)
- [ ] `npm run test:browser` green (**required for AP** — it changes the static mount)
- [ ] New behaviour has a test that fails without the change
- [ ] Schema changed → migration committed, `prisma generate` run, both applied
- [ ] Design doc updated in the same PR (**required for AP** — §9 says "two apps")
- [ ] Branch + PR. Never push to `main` or `staging` (README §7.1)

Two environment notes that bite:

- `.env` points at **production**. Use `npm run dev`, never `npm run start:dev`.
  Prefix both `DATABASE_URL` and `DIRECT_URL` on every `prisma` command.
- Redis must be running or the jest suite hangs ~10 minutes.

Commit style, from `git log`: lowercase imperative, no prefix — "build the path
from a consignment to the press and back".

---

## 12. Open decisions — needed before the relevant sprint

1. **Frontend approach: B or C?** (§4) B gets a working `/beta-2` in about a
   week and keeps the current architecture; C follows the documented Sprint I-a
   precedent and costs 3–4 weeks. My recommendation is B now, C per-screen
   later. This one gates §5.
2. **Does pricing belong in the gateway, or in Shopify?** (§9) Gates any
   wholesale/quote work; nothing else depends on it.
3. **Is `/beta-2` a permanent surface or a timeboxed beta?** If timeboxed, say
   when it is removed, in the design doc, in the same PR that adds it. If
   permanent, it needs a name that is not a version number.
4. **Who is `/beta-2` for?** `/console` is the desk and `/packing` is the bench.
   If `/beta-2` is a third audience, §9 of the design doc should say so; if it
   overlaps one of the existing two, the honest question is whether these
   screens should land in that app instead of a third.
5. **Short-close roles** (§7) — confirm `admin` + `manager` matches the existing
   over-pack override rather than assuming it.

---

## 13. Summary

| Sprint | What | Schema | Depends on |
|---|---|---|---|
| **AP** | `/beta-2` static mount, `apps/beta-2` workspace | none | decision 1 |
| **AQ** | `GET /shipments/:ref/cartonisation` — advice, not records | none | — |
| **AR** | `POST /shipments/:ref/plan/short` — closing a line short | migration | — |
| **AS** | Catalog DTO fields: print file, topic, unit count, `since` | probably none | — |
| — | Pricing | unknown | decision 2 |

AQ, AR and AS are independent of each other and of the frontend decision, so
they can run in parallel and should start first. AP is small and can land ahead
of them so the URL exists.

The single biggest thing to internalise before starting: **the CSP is not a
detail to sort out at the end.** It decides whether the page works at all, and
it is the reason §4 exists.
