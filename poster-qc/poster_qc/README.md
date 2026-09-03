# poster_qc — JBG poster text QC + auto-fix

Finds spelling / grammar / consistency errors on AI-generated poster images, fixes them **pixel-precisely**
(cloning letters already on the poster), verifies every fix with Claude vision, and writes a report.

## Run

```bash
cd "C:/Users/Jamsp/OneDrive/Desktop/Claude Code"
python -m poster_qc run "<poster.png|.jpg|.pdf or folder>" [--instructions FIX_INSTRUCTIONS.md] [--out DIR] [--no-fix]
```

- `--instructions`: a markdown list of known errors per SKU (`"wrong" → "right"` lines). They are injected as
  must-find items; the inspector still looks for everything else.
- `--no-fix` / `--dry-run`: inspect and report only.
- Output (default `<input>/QC_OUT`): `<SKU>_FIXED.png` (status CLEAN or REVIEW) or `<SKU>_NEEDS_HUMAN.png`,
  `<SKU>_QC.html` (findings, attempts, before/after zoom crops), `<SKU>_QC.json`, `QC_Summary.xlsx`,
  `_work/<SKU>/` intermediates (never deleted).

Keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` from the environment, `poster_qc/.env`, `ai-diary/.env`, or the
Windows user registry (`config.get_key`).

## Which Claude pays for the vision calls

`POSTER_QC_BACKEND` (env var or a line in `poster_qc/.env`):
- `auto` (default): use the **Claude Code CLI** (your subscription, no API credits) when `claude` is
  installed and logged in; otherwise fall back to the API key.
- `claude-code`: always the CLI. Log in once: open a terminal, run `claude`, type `/login`, finish in
  the browser. The dashboard log shows `backend: claude-code (subscription)` when it is active.
- `api`: always the Anthropic API key (pay-as-you-go credits at console.anthropic.com).
OpenAI inpaint attempts still use the OpenAI key (a few cents each).

## Dashboard (easiest way to use it)

Double-click `C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX\OPEN_DASHBOARD.bat` (or run `python -m poster_qc.web`).
A browser tab opens at http://127.0.0.1:8765. Drag in images/PDFs, a whole folder, or a ZIP of posters, or type a server folder
(or zip) path, optionally paste known errors, tick/untick Auto-fix, press Run. Jobs run one poster at a time; each card
shows the status pill (CLEAN / REVIEW / NEEDS HUMAN / REPORT for inspect-only), the findings table,
before/after crops per attempt, the Higgsfield prompt when it gave up, and download links. Jobs live under
`JBG_QC_INBOX\jobs\<job>\{in,out}` and survive restarts.

## How a fix happens

1. **Inspect** — Claude reads the full poster + overlapping tiles, returns findings with the line text,
   the wrong/right token, the text-box lines and boxes.
2. **Policy** — only `spelling`, `consistency`, `grammar` with confidence ≥ 0.6 are auto-fixed. Facts,
   guardrails, layout → `review` (reported, untouched). Below 0.5 → skipped.
3. **Locate + confirm** — pixel locator finds candidate lines (borders stripped, tight leading handled),
   Claude reads the chosen line and the chosen word back; both must match before anything is edited.
4. **Fix chain** — `glyphclone` (letters cloned from the same word → same box → whole poster, original
   letter positions kept, ≤15% squeeze on flush lines, real paper clone-stamped behind) → `inpaint_openai`
   (gpt-image-2, masked to the word) → `higgsfield` prompt for a human. `retype` (system font) is off.
5. **Verify** — Claude compares before/after zooms: text must read as corrected and style ≥ 85
   (≥ 75 when the word had to be condensed to fit). Pixels outside the changed box must be identical.
6. **Re-inspect** the whole poster after each round (max 3).

## Tuning knobs (`poster_qc/config.py`)

`STYLE_GATE_MIN`, `STYLE_GATE_MIN_CONDENSED`, `AUTO_FIX_KINDS`, `AUTO_FIX_MIN_CONFIDENCE`,
`NOTE_MIN_CONFIDENCE`, `USE_RETYPE`, `REGION_PAD_Y`, `OPENAI_IMAGE_MODEL`, `DEFAULT_MODEL`.

## Tests

```bash
python -m pytest tests/poster_qc -q
```

## Known limits

- Works on plain body text; script / blackletter / painted labels go to OpenAI inpaint or a human.
- A corrected word that needs more than ~15% extra width on a line flush against a border is left for a human.
- Claude's judgments vary run to run (±10 style points); a poster that lands NEEDS_HUMAN can simply be re-run.
- Resolution matters: 1011 px wide posters have ~19 px body text; 1600 px+ sources give cleaner clones.
