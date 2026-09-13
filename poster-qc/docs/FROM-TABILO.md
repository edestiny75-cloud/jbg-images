# FROM-TABILO - poster-qc missing glyphs

**Branch:** tabilo/qc-missing-glyphs (off tabilo/qc-3-5 @ ed86936)  
**PR:** https://github.com/edestiny75-cloud/jbg-images/pull/4  
**Date:** 2026-09-13 evening (ET)  
**Scope:** poster-qc/ only. No main merge. PR #2 and #3 stay OPEN.

## Prior lanes
- **PR #2** nameplates — OPEN, accepted DONE (pytest 106). Atlantic unchased.
- **PR #3** (#3-5 re-inspect / fact→spelling / punct) — OPEN on `tabilo/qc-3-5` (pytest 112). Susan OK; desk smoke done.

## This lane — missing glyphs
Highest remaining engine gap from HANDOFF: when the corrected word needs a letter that is not in the finding's own text box, clone used to fall through to OpenAI inpaint / human (or only recover if the *whole corrected word* appeared elsewhere).

### Pytest
pytest tests/poster_qc -q → **121 passed**

### Approach
1. **Poster-wide local harvest (no API):** `_poster_donor_line_entries` gathers every finding's `box_lines` + own line. `apply_fix(..., donor_lines=)` merges those into the GlyphLibrary before cloning. Sibling boxes Claude already transcribed can donate letters with zero vision cost.
2. **Character-needle recovery:** on `NoGlyph(ch)`, `find_lines_containing` is called with the missing *character* (not `f.right`). Prompt asks for lines that contain that character inside any word (e.g. `'h'` from "the house" for Busk→Bush).
3. **Safe casefold donors:** `SAFE_CASEFOLD = CcOoSsUuVvWwXxZz` — opposite-case borrow only when the skeleton matches after size scaling. Shape-changers (H/h, A/a, …) stay NoGlyph → inpaint/human. Recorded in `LAST_INFO["casefold"]`.
4. Helpers: `chars_needed_for_edit`, `GlyphLibrary.has` / `missing_in` / `absorb`.

`USE_RETYPE` stays **False**. No OpenAI calls in tests. Script / width / low-res skipped per Susan.

### Tests added
- `test_glyphclone.py`: chars_needed, has/missing+casefold, get casefold, clone casefold, borrow from other known line, still raises when truly absent
- `test_inspect.py`: char-needle prompt
- `test_pipeline.py`: sibling-box harvest without vision; char-search not whole-word

### Remaining limits
- Letter truly absent in that style → still inpaint / human.
- Unsafe case pairs (H↔h etc.) not borrowed (would fail style gate).
- Script / blackletter / painted lettering, width>15% flush, low-res — not in this PR.
- Atlantic unchased.
- Skewed map-label path does not yet merge poster-wide donors (deskew crop only).

### Sam / Susan
- Keep PR #2 and #3 **OPEN**; do not merge main.
- Review this PR tip; base is `tabilo/qc-3-5`.

