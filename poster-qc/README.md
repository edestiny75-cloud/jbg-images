# JBG Poster QC

Finds and fixes text errors on AI-generated Jelly Bean Genius posters, verifies every fix, and produces
print-ready files. Full docs: [poster_qc/README.md](poster_qc/README.md).

## Setup (Windows)
1. Install Python 3.12+ and run `pip install -r requirements.txt`.
2. Install Claude Code and log in once (`claude`, then `/login`) so the tool runs on the subscription;
   or put `ANTHROPIC_API_KEY=` in `poster_qc/.env`. `OPENAI_API_KEY=` is optional (inpaint fallback).
3. Start the dashboard: `python -m poster_qc.web` (opens http://127.0.0.1:8765).

## Tests
`python -m pytest tests/poster_qc -q`
