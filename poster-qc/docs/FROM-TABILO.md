# FROM-TABILO — digit/date fix route (empirical)

**Branch tip:** tabilo/qc-digit-fix (off tabilo/qc-missing-glyphs / PR #4)  
**Date:** 2026-09-14 evening (ET)  
**Desk:** Sam-Jams; work only under poster-qc/  
**Rule:** All PRs stay **OPEN**. No main merge. Keep #2/#3/#4 open.

---

## Stack for Sam

- **PR #2** https://github.com/edestiny75-cloud/jbg-images/pull/2 — tabilo/qc-nameplates (OPEN)
- **PR #3** https://github.com/edestiny75-cloud/jbg-images/pull/3 — tabilo/qc-3-5 (OPEN)
- **PR #4** https://github.com/edestiny75-cloud/jbg-images/pull/4 — tabilo/qc-missing-glyphs (OPEN)
- **PR #5** (this) — tabilo/qc-digit-fix — date/digit surgical + escalate (OPEN)

---

## Evidence job (Founding Fathers)

`JBG_QC_INBOX/jobs/20260914-173514-d8ef9c`

| Finding | Edit | Old glyphclone | Why it failed |
|---------|------|----------------|---------------|
| Jefferson | 1743-1B26 → 1743-1826 | style **15** | Full-word erase+rebuild left parchment patches; donor `8` sat small/low |
| Morris | 1732-1816 → 1752-1816 | style **35**, read `1772` | Wrong/malformed digit + halo; no size-matched `5` in findings harvest |

Root causes confirmed empirically on `round1.png`:

1. **Full-word `clone_fix`** erases the entire date then repastes every glyph → rectangular patches on parchment (box area ~8k–11k px on synth).
2. **`GlyphLibrary.get` uses `line_h`**, not ink height → accepts wrong-size digits and scales them (small low 8).
3. **Findings harvest** rarely includes other portrait date lines → missing `5`/`8` unless vision hunts; vision can return wrong size.

---

## Approaches tried (empirical)

| ID | Approach | Jefferson (real) | Morris (real) | Synth metrics |
|----|----------|------------------|---------------|---------------|
| A | Stricter donor then full `clone_fix` | Still full-word patches (area ~7917) | Would need a `5` | Large rewrite area |
| B | Poster-wide digit harvest + clone | Helps find `8` (Paine/Morris) but **patches remain** if full clone | Harvest from findings alone has **no `5`** | Harvest necessary but not sufficient |
| C | Skip auto-fix / clean NEEDS_HUMAN when no good digit donor | n/a (donor exists) | **Correct** — `NoGlyph: 5` | Reject oversized donor (ratio 1.55) |
| **D (winner)** | **Surgical single-glyph replace** + ink-aware erase + **ink-height gate ±12%** + escalate on miss | **Works**: h_ratio 0.091, `outside_ok=True`, local box ~693–1k | Escalates cleanly (no `5`) | area ~600–700 vs clone ~10k; neighbors pixel-identical |

Winner = **D + C**: invisible surgical fix when a size-matched digit donor exists; otherwise clean **NEEDS_HUMAN** (skip OpenAI inpaint — costly and patchy on these).

---

## What shipped

- `surgical_digit_replace`, `best_digit_donor`, `is_short_date_token`, `DIGIT_HEIGHT_TOL=0.12` in `glyphclone.py`
- `apply_fix` tries surgical-digit first for short date tokens; no size-matched donor → `NoGlyph` (no wrong-size vision hunt)
- Runner: date `NoGlyph` → `needs_human` + **skip inpaint**
- Tests: date detect, donor reject, surgical keep-neighbors, Morris escalate, pipeline surgical note
- **pytest: 128 passed**
- Local real-poster smoke (no API): Jefferson surgical OK; Morris escalate OK
- Full live re-smoke deferred (POSTER_QC_BACKEND=claude-code) — avoid API burn; Susan can queue if wanted

---

## Parked / still true

- USE_RETYPE=False; invisible fixes only
- Grade Desk parked; no main merge until Sam says
- Script/blackletter, width>15%, low-res upscale, Atlantic still parked

