# VC Fulfillment Agent — Design Spec
**Date:** 2026-08-27  
**Project:** Sales4Less / Amazon Vendor Central  
**Status:** Approved — ready for implementation

---

## Overview

A two-phase Playwright automation agent that handles the full Amazon Vendor Central weekly fulfillment workflow. Runs on the Rockaway warehouse computer, connects to the existing Edestiny Chrome session (already logged into VC), and requires zero Claude tokens per run after build.

---

## Problem

The weekly VC fulfillment process (accept POs → create shipment → ASN → invoice) is done manually through the browser, burning tokens when driven by the browser extension and requiring repetitive manual steps every week.

---

## Solution

Two standalone Node.js scripts (`phase1.js`, `phase2.js`) driven by Playwright that automate each stage. Each is triggered manually via `.bat` double-click when ready, not on a schedule.

---

## Full Workflow

### Sam (manual steps — not automated):
1. Download PO sheet from Amazon VC on Monday
2. Verify all items are in stock at Rockaway warehouse
3. Download routing confirmation from VC on Tuesday (~24 hrs after Phase 1)

### Agent — Phase 1 (Monday, after stock verified):
1. Connect to Edestiny Chrome via CDP (localhost:9222)
2. Navigate to VC Orders → select all this week's POs → bulk accept
3. Navigate to Create Shipment → select the accepted POs
4. Download VC's generated shipment template
5. Fill template with carton/quantity data from Sam's PO sheet
6. Upload completed template back to VC → routing request submitted
7. Write `output/results-phase1-YYYY-MM-DD.log`

### Agent — Phase 2 (Tuesday, after Sam drops routing confirmation):
1. Read `input/routing-sheet.xlsx` (Sam's download from VC)
2. Connect to Edestiny Chrome via CDP (localhost:9222)
3. Submit ASN in VC for each shipment (Playwright)
4. Submit Invoice in VC **keyed by ASN, not PO** — one invoice per ASN (a single ASN may cover multiple POs)
   - Select payment terms: **"2% 28, 29 NET"** (required field, must be explicitly set)
   - Check **"I acknowledge"** (first acknowledgment checkbox — required)
   - Do NOT check **"intra-Community supply of goods"** (must remain unchecked)
5. Write `output/results-phase2-YYYY-MM-DD.log` — success/fail per row

---

## Architecture

```
vc-agent/                        (lives on Rockaway computer)
  phase1.js                      ← Monday automation
  phase2.js                      ← Tuesday automation
  phase1.bat                     ← double-click to run Phase 1
  phase2.bat                     ← double-click to run Phase 2
  config.json                    ← CDP port, column mappings, VC URLs
  input/
    po-sheet.xlsx                ← Sam drops Monday's PO download here
    routing-sheet.xlsx           ← Sam drops Tuesday's routing download here
  output/
    results-phase1-YYYY-MM-DD.log
    results-phase2-YYYY-MM-DD.log
```

---

## Technical Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Runtime | Node.js (already on Rockaway) | No new installs beyond Playwright |
| Browser automation | Playwright | Free, reliable, no tokens |
| Chrome connection | CDP (localhost:9222) | Reuses existing VC login — avoids 2FA |
| Excel read/write | `xlsx` npm library | Read PO sheet, fill VC template |
| Trigger | `.bat` double-click | Sam controls timing, no scheduler |
| Logging | Plain text log file | Results reviewable after run |

---

## Config (config.json)

```json
{
  "cdpPort": 9222,
  "vcBaseUrl": "https://vendorcentral.amazon.com",
  "columns": {
    "poNumber": "PO_NUMBER",
    "quantity": "QUANTITY",
    "unitPrice": "UNIT_PRICE",
    "carrier": "CARRIER",
    "proNumber": "PRO_NUMBER",
    "trackingNumber": "TRACKING_NUMBER"
  }
}
```

**Column names are placeholders.** Actual VC template headers to be captured at Rockaway tomorrow and updated here before implementation begins.

---

## Error Handling

- All rows attempt regardless of individual failures
- Each row result logged: `SUCCESS` or `FAILED: <VC error message>`
- Phase does not stop mid-run on a single row error
- Results log written even if all rows fail
- Sam reviews log after each phase run

---

## One-Time Setup on Rockaway Computer

```bash
# 1. Install Node.js (if not already there)
# 2. Install dependencies
npm install playwright xlsx
# NOTE: do NOT run "npx playwright install chromium"
# We connect to the existing Edestiny Chrome via CDP — no separate browser needed

# 3. Ensure Chrome starts with remote debugging
# Add to Chrome shortcut: --remote-debugging-port=9222
```

---

## Constraints

- **Must run on Rockaway computer** — Playwright needs local CDP access to Edestiny Chrome
- **Edestiny Chrome must be open and logged into VC** before running either phase
- **No scheduled triggers** — manual only, Sam controls when each phase fires
- **No Claude tokens consumed** after build — purely local Node.js execution

---

## Out of Scope

- Label generation / Fiery printing (handled separately at Rockaway for Sales4Less)
- Email notifications (results log is sufficient)
- n8n integration (revisit if Sam wants a UI trigger later)
- Automatic routing confirmation download (Sam downloads manually from VC)
