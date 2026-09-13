# FROM-TABILO - poster-qc deferred #3-5

**Branch:** tabilo/qc-3-5 (off tabilo/qc-nameplates @ 3f8ee88)  
**PR:** https://github.com/edestiny75-cloud/jbg-images/pull/3  
**Date:** 2026-09-13 evening (ET)  
**Scope:** poster-qc/ only. No main merge.

## Prior lane (#2) — accepted DONE
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

### Sam decisions
- Review new PR for #3-5; do not merge main until approved.
- Keep PR #2 open/separate until Sam/Susan say merge.
