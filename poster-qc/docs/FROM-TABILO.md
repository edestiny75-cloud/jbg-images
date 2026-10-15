# FROM-TABILO - poster-qc deferred #3-5

**Branch:** tabilo/qc-3-5 (off tabilo/qc-nameplates @ 3f8ee88)  
**PR:** https://github.com/edestiny75-cloud/jbg-images/pull/3  
**Date:** 2026-09-13 evening (ET)  
**Scope:** poster-qc/ only. No main merge.

## Prior lane (#2) - accepted DONE
Susan accepted **PR #2** nameplate+map-locate lane as DONE (2026-09-13 evening).  
- pytest **106**, commit 3f8ee88, https://github.com/edestiny75-cloud/jbg-images/pull/2  
- PR #2 stays **OPEN**, no main merge until Sam/Susan say.  
- Steep skew >=45 deg clean NEEDS_HUMAN is correct. Atlantic unchased.

## This lane (#3-5)
New branch so #2 can merge cleanly later without mixing.

### Pytest
pytest tests/poster_qc -q -> **112 passed**

### What landed
- **#3 re-inspect known errors:** run_poster re-inspect now passes known= into inspect_poster and _policy(n, known) so instruction-file must-finds stay located and auto-fix eligible after a fix round.
- **#4 fact->spelling promote:** _looks_like_spelling promotes near-miss typos (Mississipi->Mississippi) from fact to spelling for auto-fix; real fact swaps (Congress->House) stay review. Known instruction pairs force spelling eligibility even if Claude said fact.
- **#5 locate punctuation hardening:** _normalize_index matches by folded core (not substring), then syncs attached punctuation from the printed line token onto wrong/right (_with_printed_punct) so locate/glyphclone see the ink as printed.

### Tests
tests/poster_qc/test_qc_3_5.py (6 new).

## Susan decisions (2026-09-13 ~6:47pm ET)
1. Review **OK** on #3-5.
2. Sync QC Desk from PR #3 branch `tabilo/qc-3-5` and run **ONE** smoke (civics / typo+punct).
3. **No main merge** - keep PR #2 and #3 **OPEN**.
4. Atlantic **unchased**.

## Desk sync + smoke (Sam-Jams)

### Sync
- Repo: `C:\dev\jbg-images` on `tabilo/qc-3-5` @ **1fc2d0197c342adfb0b7915e5fff7896152627f1**
- Robocopy `poster-qc` -> `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\desk\engine` (kept desk `.venv`, desk `.env` POSTER_QC_BACKEND=claude-code, desk `web`)
- Desk restarted on `:8766` (claude-code backend)

### Smoke
- Poster: `demo\JBG-POS-LAM-GettysburgAddress_v3_TOFIX.png` (spelling+punct; known instructions for Pennsylvaia,/casualties)
- Backend: claude-code
- Job: `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\20260913-184947-2f35ef`
- Result: **NEEDS_HUMAN** (findings=5, fixed=1) - smoke **PASS** (ran clean; behaviors visible). Poster not CLEAN.

| Finding | kind | status | note vs #3-5 |
|---|---|---|---|
| `Pennsylvaia,` -> `Pennsylvania,` | spelling | needs_human | #4 spelling (not fact); #5 comma kept on wrong/right; locate+fix attempted |
| `casualties),` -> `casualties).` | grammar | **fixed** (glyphclone style=95) | #5 punct-only change located + auto-fixed |
| `Everest,` -> `Everett,` | consistency | needs_human | fix attempted, style fail |
| `Library` -> `White House (Bliss copy)` | fact | **review** | #4 real fact stays review / not auto-fix |
| `minutes` -> `minutes.` | consistency | skipped | low conf |

- **#3 re-inspect known:** after fix round, `re-inspect round 1: 5 finding(s)`; known instruction pairs stayed in play; new findings appeared under policy.
- **#4 fact->spelling:** typo kept as spelling / auto-fix eligible; fact finding stayed review.
- **#5 punct locate:** wrong/right carried printed punctuation; punct fix PASS.
- Atlantic: not on this poster; left unchased per Susan (prior FrenchIndianWar Atlantic fact remains review-only).

### Artifacts
- `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\20260913-184947-2f35ef\out\JBG-POS-LAM-GettysburgAddress_NEEDS_HUMAN.png`
- `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\20260913-184947-2f35ef\out\JBG-POS-LAM-GettysburgAddress_CHANGES.png`
- `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\20260913-184947-2f35ef\out\JBG-POS-LAM-GettysburgAddress_QC.html`
- `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\20260913-184947-2f35ef\out\JBG-POS-LAM-GettysburgAddress_QC.json`
- `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\20260913-184947-2f35ef\out\QC_Summary.xlsx`
- crops under `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\jobs\20260913-184947-2f35ef\out\_work\JBG-POS-LAM-GettysburgAddress\`

### Sam decisions (still)
- Keep PR #2 and #3 **OPEN**; do not merge main until Sam/Susan say.