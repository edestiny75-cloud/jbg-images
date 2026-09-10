# ANSWER TABILO — poster_qc handoff (from Claude, the poster QC session)

Susan's note says you start a full build on poster_qc Thu 9am ET. Here is everything you need. Read this before touching code.

## What the tool is

JBG Poster QC. Finds spelling / grammar / consistency / fact errors on AI-generated poster images (Higgsfield / Nano Banana output), fixes text errors pixel-precisely by cloning letters already on the poster, verifies each fix with Claude vision, and writes a report plus a Fiery print PDF. Owner Sam uses it through a browser dashboard. John (johnpatrick254) is helping on it too.

## Where the code is (work from here, not from Sam's desktop)

- GitHub: https://github.com/edestiny75-cloud/jbg-images — folder **`/poster-qc`** only.
- Same repo also holds `/agent` (the Fiery print agent) and the catalog. **Do not touch anything outside `/poster-qc`.**
- Latest commit on main: `e4652ef Add JBG Poster QC tool under /poster-qc`. 73 tests, all passing as of 2026-09-10.
- Sam's live working copy is `C:\Users\Jamsp\OneDrive\Desktop\Claude Code\poster_qc` (the dashboard runs from there). It is synced to the repo folder `C:\dev\jbg-images\poster-qc`. Repo is the source of truth for you and John.

Setup:

```
git clone https://github.com/edestiny75-cloud/jbg-images.git
cd jbg-images/poster-qc
pip install -r requirements.txt
python -m pytest tests/poster_qc -q        # expect 73 passed
python -m poster_qc.web                    # dashboard on http://127.0.0.1:8765
```

Python 3.14. Deps: Pillow, numpy, opencv-python-headless, PyMuPDF, reportlab, openpyxl, anthropic, openai, fastapi, uvicorn, pytest.

## Rules (non-negotiable)

1. **Work on a branch, open a PR.** Never push straight to main. Sam reviews every change before it lands in the folder his dashboard runs from.
2. **Do not spend Sam's API credits.** The tool has a Claude Code CLI backend that runs on his subscription (`POSTER_QC_BACKEND=auto|claude-code` in `poster_qc/config.py` / `claude_client.py` / `code_client.py`). Keep that the default. Never loop test runs against the Anthropic API key. OpenAI inpaint calls cost a few cents each; do not batch them in tests.
3. **Fixes must be invisible.** Same font, size, weight, color, position. No retyping in a system font (`USE_RETYPE=False` stays off). No text boxes, no patches, no restyle.
4. **Keep the output contract.** Sam's workflow and the dashboard depend on these files per poster: `<SKU>_FIXED.png` or `<SKU>_NEEDS_HUMAN.png`, `<SKU>_CHANGES.png` (before/after with red outlines), `<SKU>_QC.html` + `_QC.json`, `<SKU>_11x17_Fiery.pdf` or `<SKU>_85x11_Fiery.pdf`, `QC_Summary.xlsx`, `_work/<SKU>/` crops.
5. **JBG guardrails.** No medical-instruction phrasing, no AI-generated children. The inspector flags these as `guardrail` findings for review; never auto-edit them.
6. Tests must stay green. Add tests for anything you add.

## How it works (pipeline, `poster_qc/pipeline.py`)

1. **Inspect** (`inspect.py`) — Claude reads the full poster + overlapping tiles (JPEG, ~900 px tiles, 120 px overlap). Returns findings JSON: line text, wrong/right token, word index, box name, box lines, bbox, text color, kind, confidence, plus `facts_checked`. JSON is repaired and retried if invalid.
2. **Policy** — auto-fix only `spelling`, `consistency`, `grammar` with confidence ≥ 0.6. `facts`, `guardrail`, `layout` → review only. Below 0.5 → skipped. Known errors from the instructions file are always must-find.
3. **Locate + confirm** (`locate.py`) — Otsu ink mask with polarity, borders and rules stripped, tall components and antialias slivers removed, line bands by profile hysteresis, profile-guided word split. Claude reads the chosen line and word back; both must match before any pixel changes.
4. **Fix chain** (`apply_fix`) — `glyphclone` (letters cloned from same word → same box → whole poster, original positions kept, ≤15% squeeze, real paper clone-stamped behind) → `inpaint_openai` (gpt-image-2, masked to the word, word region pasted back) → `higgsfield` / ChatGPT hand-off prompt for a human (`handoff.py`).
5. **Verify** (`verify.py`) — Claude compares before/after zooms. Text must read corrected, style score ≥ 85 (≥ 75 when condensed). Pixels outside the edited box must be identical (`retype.outside_unchanged`). Near miss → retry with alternate erase.
6. **Re-inspect** the whole poster after each round, max 3 rounds.
7. **Print check** (`printfile.py`) — detects 8.5x11 or 11x17, either orientation, flags stretch > 2% or DPI < 150, writes the Fiery PDF at the detected size.

Key modules: `config.py` (all knobs), `claude_client.py` + `code_client.py` (backend), `inspect.py`, `locate.py`, `glyphclone.py`, `retype.py` (erase + paper donor), `inpaint_openai.py`, `verify.py`, `printfile.py`, `handoff.py`, `report.py`, `models.py`, `ingest.py` (files, folders, PDFs, ZIPs), `cli.py`, `web/server.py` + `web/index.html` (dashboard).

Dashboard features already built: upload one image / many / folder / ZIP, known-errors box, auto-fix toggle, job queue with persistence, click-through report with back button, original-vs-fixed two-up, print check banner, facts table, pick-and-edit changes then Apply selected, Approve & save to a clean folder, Archive finished jobs, LAN sharing bat, deep links `#poster=<sku>`.

Full design + plan: `docs/superpowers/specs/2026-09-03-poster-qc-design.md`, `docs/superpowers/plans/2026-09-03-poster-qc.md` and the addendum.

## What works and what is open

Works: plain body text on flat paper. Gettysburg test poster fixed 3/3 end to end. Rosa Parks run: grammar item flagged, 16 facts checked.

Open engine gaps (this is where a "full build" earns its keep):

- **Framed nameplates and banner cells** — light text on dark ribbon/plate backgrounds. Cell segmentation and paper donor both fail; most civics posters landed NEEDS_HUMAN (1/10 auto-fixed).
- **Missing glyphs** — when the correct word needs a letter that appears nowhere on the poster in that style. Currently falls to OpenAI inpaint or a human.
- **Script / blackletter / painted lettering** — no donor, no shift; goes to inpaint or human.
- **Width** — a corrected word needing > ~15% extra width on a line flush to a border is left for a human.
- **Judgment variance** — Claude style scores swing ±10 between runs; a NEEDS_HUMAN poster can pass on re-run. A more deterministic verify would help.
- **Resolution** — 1011 px wide posters have ~19 px body text; 1600 px+ sources clone much cleaner. An upscale-before-fix step is a candidate.

## How to report back

Put a `FROM-TABILO.md` in this folder (`C:\Users\Jamsp\jbg-creator-intel`) with: branch name, PR link, what changed, test count, and anything that needs Sam's decision. I will pull the PR into Sam's working copy once he approves it and re-run the suite.

— Claude (poster QC session), 2026-09-10
