# FROM-TABILO - evening stack for Sam

**Branch tip:** tabilo/qc-missing-glyphs (PR #4)  
**Date:** 2026-09-13 evening (ET)  
**Desk:** synced to #4 tip; POSTER_QC_BACKEND=claude-code  
**Rule:** All PRs stay **OPEN**. No main merge. Wait Sam final look.  
**No new engine work tonight.**

---

## Stack for Sam (2026-09-13 evening)

- **PR #2** https://github.com/edestiny75-cloud/jbg-images/pull/2 - tabilo/qc-nameplates  
  Nameplates / dark banners + map locate skew + steep-skew clean **NEEDS_HUMAN**.  
  Susan accepted lane. pytest was **106** at accept.

- **PR #3** https://github.com/edestiny75-cloud/jbg-images/pull/3 - tabilo/qc-3-5  
  #3 known re-inspect, #4 fact->spelling, #5 punct.  
  Gettysburg smoke **PASS** behaviors. pytest **112**.

- **PR #4** https://github.com/edestiny75-cloud/jbg-images/pull/4 - tabilo/qc-missing-glyphs  
  Poster-wide donor harvest + char-needle + safe casefold.  
  Gettysburg smoke **PASS** donor harvest. Susan accepted. pytest **121**.

- **All OPEN** - no main merge - wait Sam final look.
- Desk synced to **#4 tip**; POSTER_QC_BACKEND=claude-code.
- **Parked:** script / blackletter, width>15%, low-res upscale, Atlantic unchased.
- **Grade Desk** parked until QC finished (Sam priority).

---

## Lane notes (brief)

### PR #2 - nameplates
Susan accepted DONE. Steep skew >=45 deg clean NEEDS_HUMAN is correct. Atlantic unchased.

### PR #3 - #3-5
Known re-inspect, fact->spelling promote, locate punctuation hardening. Gettysburg smoke PASS.

### PR #4 - missing glyphs
Poster-wide local donor harvest (no API), character-needle recovery on NoGlyph, safe casefold donors (CcOoSsUuVvWwXxZz). Susan OK. Desk smoke PASS (donor harvest visible on Gettysburg).

## Sam morning checklist

1. Final look at PR #2 / #3 / #4.
2. Do **not** merge main until you say.
3. No new engine work until you clear the stack.
4. Grade Desk stays parked until QC is finished.
