# FROM-TABILO — poster-qc skewed apply_fix / Mississippi

**Branch:** `tabilo/qc-nameplates`  
**PR:** https://github.com/edestiny75-cloud/jbg-images/pull/2  
**Date:** 2026-09-13 (ET)  
**Scope:** `poster-qc/` only. No main merge.

## Pytest
`pytest tests/poster_qc -q` → **106 passed**

## Re-smoke (final)
`C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\smoke-skew-20260913-183527`  
Mississippi: **still NEEDS_HUMAN** (clean escalate — see below).  
Atlantic COASTLINE→OCEAN: review/fact (not auto-fix).

## Root cause of verify fail (why auto-fix cannot FIXED yet)
Locate for MISSSSIPPI→MISSISSIPPI **passes** (skew-aware line+word checks).  
`_apply_fix_skewed` (deskew → glyphclone/surgical → warp-back) still fails verify because:

1. **Warp-back** of any edit band on a ~−64° label that sits on the blue river paints visible parallelograms / broken river (AABB fill was worst; delta-only mask is better but still not invisible next to chrome).
2. **Double cubic warp** softens letterforms; Claude still reads MISSSSIPPI after clone/surgical insert.
3. River ink under `CELL_EXT` poisoned glyph cells until clamped.

So this is **true human judgment / Higgsfield handoff**, not a locate miss.

## What we shipped on the branch
- Warped delta-only compose (`_warp_edit_onto_sub`); restore outside line band; clamp erase to line; tight `CELL_EXT` on skew.
- Prefer glyphclone on mild skew; **skip OpenAI inpaint** on skew; **steep stylized |angle|≥45 → higgsfield only** (no doomed patch attempts).
- `surgical_insert` for pure insert edits; min cell width + median insert donors.
- Fix duplicate upright word-list collapsing slack to ~15px (`NoGlyph`).
- Rank skewed locate cands by upright width/height.
- Tests in `test_apply_fix_skewed.py`.

## Desk engine
Synced into `C:\Users\Jamsp\OneDrive\Desktop\Claude Code\poster_qc`.

## Sam decisions
- Review PR #2; do not merge main until approved.
- Mississippi remains human/Higgsfield until a non-warp (stamp-rotated glyphs) path exists.
