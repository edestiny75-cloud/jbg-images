from __future__ import annotations
import argparse, sys
from pathlib import Path
from . import config
from .ingest import IMAGE_EXT, sku_from_path
from .instructions import load_instructions
from .pipeline import run_poster
from .report import write_summary_xlsx

def main(argv=None):
    ap = argparse.ArgumentParser(prog="poster_qc", description="JBG poster text QC + auto-fix")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="QC (and fix) one file or every poster in a folder")
    r.add_argument("input"); r.add_argument("--out", default=None)
    r.add_argument("--instructions", default=None, help="FIX_INSTRUCTIONS.md with known errors")
    r.add_argument("--no-fix", "--dry-run", dest="no_fix", action="store_true",
                   help="inspect only, do not attempt any fixes")
    r.add_argument("--no-print", dest="no_print", action="store_true",
                   help="skip building the Fiery-ready print PDF")
    r.add_argument("--max-rounds", type=int, default=config.MAX_ROUNDS)
    r.add_argument("--model", default=config.DEFAULT_MODEL)
    args = ap.parse_args(argv)
    inp = Path(args.input)
    if inp.is_file() and inp.suffix.lower() == ".zip":
        from .ingest import extract_posters_from_zip
        unz = inp.with_name(inp.stem + "_unzipped")
        files = sorted(extract_posters_from_zip(inp, unz)); inp = unz
        print(f"unpacked {len(files)} poster file(s) to {unz}")
    else:
        files = [inp] if inp.is_file() else sorted(p for p in inp.iterdir() if p.suffix.lower() in IMAGE_EXT | {".pdf"})
    files = [p for p in files if not any(t in p.stem for t in ("_FIXED", "_FINAL", "_NEEDS_HUMAN"))]
    out = Path(args.out) if args.out else (inp.parent if inp.is_file() else inp) / "QC_OUT"
    known_all = load_instructions(args.instructions) if args.instructions else {}
    from .claude_client import make_client
    client = make_client()
    results = []
    for p in files:
        known = known_all.get(sku_from_path(p))
        print(f"== {p.name}", flush=True)
        res = run_poster(p, out, client, known=known, model=args.model, max_rounds=args.max_rounds,
                         fix=not args.no_fix, make_print_pdf=not args.no_print)
        print(f"   {res.status}  findings={len(res.findings)}  fixed={sum(f.status=='fixed' for f in res.findings)}  -> {res.output_png}", flush=True)
        results.append(res)
    write_summary_xlsx(results, out / "QC_Summary.xlsx")
    print(f"Summary: {out / 'QC_Summary.xlsx'}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
