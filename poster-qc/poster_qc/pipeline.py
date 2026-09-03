from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw
from . import config
from .ingest import load_pages, sku_from_path
from .inspect import inspect_poster, find_lines_containing, read_line
from .locate import locate_candidates, set_polarity
from difflib import SequenceMatcher
import re as _re
from .locate import locate_word
from .retype import retype_word, outside_unchanged
from .glyphclone import GlyphLibrary, clone_fix, NoGlyph
from .inpaint_openai import inpaint_word, build_prompt
from .verify import verify_fix
from .tiles import crop_zoom
from .models import Finding, FixAttempt, PosterResult
from .report import write_report

# Plain body copy: try the pixel-exact backends before the generative ones. Stylized/script/blackletter
# text rarely has a clean local letterform to clone or a fitting system font, so lean on inpainting first.
def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)

BACKENDS_PLAIN = ["glyphclone", "inpaint_openai", "retype", "higgsfield"]
BACKENDS_STYLED = ["inpaint_openai", "glyphclone", "retype", "higgsfield"]


def _save_crop(img: Image.Image, box, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    crop_zoom(img, box).save(path)
    return path.name


CHANGE_BOX_COLOR = "#d32f2f"
CHANGE_BOX_PAD = 6
CHANGE_BOX_WIDTH = 3


def _write_changes_png(res: PosterResult, img: Image.Image, path: Path) -> bool:
    """Save a copy of the fixed poster with a red rounded rectangle around every fixed finding's
    change box. Returns True if anything was drawn (i.e. the file is worth linking to)."""
    out = img.copy()
    draw = ImageDraw.Draw(out)
    drew_any = False
    for f in res.findings:
        if f.status != "fixed":
            continue
        att = next((a for a in f.attempts if a.passed and a.box), None)
        if att is None:
            continue
        x0, y0, x1, y1 = att.box
        box = [max(x0 - CHANGE_BOX_PAD, 0), max(y0 - CHANGE_BOX_PAD, 0),
               min(x1 + CHANGE_BOX_PAD, out.width), min(y1 + CHANGE_BOX_PAD, out.height)]
        draw.rounded_rectangle(box, radius=8, outline=CHANGE_BOX_COLOR, width=CHANGE_BOX_WIDTH)
        drew_any = True
    if drew_any:
        path.parent.mkdir(parents=True, exist_ok=True)
        out.save(path)
    return drew_any


def _locate_lines(img: Image.Image, entries: list[dict]) -> list[tuple[str, tuple, list]]:
    """Turn [{"text","bbox"}] entries into (text, line_box, words) tuples for GlyphLibrary.from_lines,
    via locate_word(img, bbox, text, 0) per entry. Entries whose text can't be located are skipped."""
    lines: list[tuple[str, tuple, list]] = []
    for e in entries:
        try:
            loc = locate_word(img, tuple(e["bbox"]), e["text"], 0)
        except Exception:
            continue
        lines.append((e["text"], loc.line_box, loc.words))
    return lines


def _norm(t: str) -> str:
    return _re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()

def _similar(a: str, b: str) -> float:
    """Similarity of a read-back to the expected text. The crop may catch neighbouring lines, so the
    best-matching line of the read-back counts, and a read that contains the expected text scores 1."""
    nb = _norm(b)
    best = 0.0
    for part in [a] + a.splitlines():
        na = _norm(part)
        if not na:
            continue
        if nb and nb in na and len(nb) >= 0.5 * len(na):
            return 1.0
        best = max(best, SequenceMatcher(None, na, nb, autojunk=False).ratio())
    return best

LINE_MATCH_MIN = 0.75

def _normalize_index(f: Finding) -> None:
    """Claude's word_index is sometimes off by one; trust the token text over the index."""
    toks = f.line_text.split()
    if not toks:
        return
    if f.word_index >= len(toks) or toks[f.word_index] != f.wrong:
        if f.wrong in toks:
            f.word_index = toks.index(f.wrong)
        else:
            # token containing the wrong text (e.g. Claude quoted without punctuation)
            for i, t in enumerate(toks):
                if f.wrong.strip(".,;:!?\"'()") and f.wrong.strip(".,;:!?\"'()") in t:
                    f.word_index = i; break

WORD_MATCH_MIN = 0.7
WORD_MATCH_STRONG = 0.9     # required when the line read-back only loosely matched
LINE_MATCH_SOFT = 0.5       # below this a candidate line is rejected outright

def _locate_checked(img: Image.Image, f: Finding, client, model: str, cache: dict | None = None):
    """Locate the word, then have Claude read the chosen line crop and confirm it matches the transcript.
    Tries up to three candidate lines. Cached per finding so retries across backends do not re-read."""
    if cache is not None and f.id in cache:
        return cache[f.id]
    x0, y0, x1, y1 = f.bbox
    pad_y = max(6, int(round((y1 - y0) * config.REGION_PAD_Y)))
    region = (max(x0 - config.REGION_PAD_X, 0), max(y0 - pad_y, 0), min(x1 + config.REGION_PAD_X, img.width), min(y1 + pad_y, img.height))
    cands = locate_candidates(img, region, f.line_text, f.word_index)
    last = ""
    _normalize_index(f)
    reads: list[str] = []
    for loc in cands:
        read = read_line(client, img, loc.line_box, model=model)
        reads.append(read)
        sim = _similar(read, f.line_text)
        log(f"  [{f.id}] line check: read={read!r} sim={sim:.2f} box={loc.line_box}")
        if sim < LINE_MATCH_SOFT:
            last = read
            continue
        need_word = WORD_MATCH_MIN if sim >= LINE_MATCH_MIN else WORD_MATCH_STRONG
        # token of the wrong word as read in context (more reliable than the findings JSON quote)
        best_line = max([read] + read.splitlines(), key=lambda t: _similar(t, f.line_text))
        rtoks = best_line.split()
        f.read_line_token = rtoks[f.word_index] if len(rtoks) == len(f.line_text.split()) and f.word_index < len(rtoks) else None
        # word check: the located word must read as the wrong token; else try neighbouring indices
        tried = []
        order = sorted(range(len(loc.words)), key=lambda k: (abs(k - f.word_index), k))[:8]
        for wi in order:
            if wi < 0 or wi >= len(loc.words) or wi in tried:
                continue
            tried.append(wi)
            cand = loc if wi == f.word_index else _relocate(img, f, wi, loc)
            if cand is None:
                continue
            wread = read_line(client, img, cand.word_box, model=model, pad=3)
            # Claude often "helpfully" reads the corrected spelling: a match to either token counts
            wsim = max(_similar(wread, f.wrong), _similar(wread, f.right))
            log(f"  [{f.id}] word check idx={wi}: read={wread!r} sim={wsim:.2f} box={cand.word_box}")
            if wsim >= need_word:
                f.word_index = wi
                f.read_wrong = wread
                if cache is not None:
                    cache[f.id] = cand
                return cand
        last = read
    # Nothing matched. If a read-back line actually contains the wrong token, Claude's transcript was
    # probably two poster lines merged (or garbled): adopt that read line as the transcript and retry once.
    if not getattr(f, "_adopted", False):
        wn = _norm(f.wrong)
        for read in reads:
            for line in read.splitlines():
                toks = line.split()
                idx = next((i for i, t in enumerate(toks) if _norm(t) == wn), None)
                if idx is not None and _similar(line, f.line_text) < 0.9:
                    log(f"  [{f.id}] adopting read-back line as transcript: {line!r} (word {idx})")
                    f.line_text, f.word_index, f._adopted = line, idx, True
                    return _locate_checked(img, f, client, model, cache)
    # Claude's box may simply be off: widen the search once (x2 vertically, +40px sideways) and retry
    if not getattr(f, "_widened", False):
        f._widened = True
        x0, y0, x1, y1 = f.bbox
        h = max(y1 - y0, 12)
        f.bbox = (max(x0 - 40, 0), max(y0 - h, 0), min(x1 + 40, img.width), min(y1 + h, img.height))
        log(f"  [{f.id}] widening search region to {f.bbox}")
        return _locate_checked(img, f, client, model, cache)
    raise ValueError(f"no candidate line passed the line+word checks for {f.line_text!r} (last read {last!r})")

def _relocate(img: Image.Image, f: Finding, wi: int, ref):
    """Same confirmed line, different word index."""
    x0, y0, x1, y1 = f.bbox
    pad_y = max(6, int(round((y1 - y0) * config.REGION_PAD_Y)))
    region = (max(x0 - config.REGION_PAD_X, 0), max(y0 - pad_y, 0), min(x1 + config.REGION_PAD_X, img.width), min(y1 + pad_y, img.height))
    try:
        for c in locate_candidates(img, region, f.line_text, wi):
            if c.line_box[1] == ref.line_box[1]:
                return c
    except ValueError:
        return None
    return None

def apply_fix(img: Image.Image, f: Finding, backend: str, openai_client, client,
              model: str = config.DEFAULT_MODEL, loc_cache: dict | None = None) -> tuple[Image.Image, tuple, str]:
    loc = _locate_checked(img, f, client, model, loc_cache)
    f.word_box, f.line_box = loc.word_box, loc.line_box
    expected_line = " ".join(f.line_text.split()[:f.word_index] + [f.right] + f.line_text.split()[f.word_index + 1:])
    if backend == "glyphclone":
        lines = _locate_lines(img, f.box_lines)
        lib = GlyphLibrary.from_lines(img, lines)
        box_right = (f.box_bbox or f.bbox)[2]
        alt = getattr(f, "read_line_token", None) or getattr(f, "read_wrong", None)
        try:
            out, box = clone_fix(img, loc, f.wrong, f.right, lib, box_right=box_right, alt_wrong=alt)
        except NoGlyph as e:
            # A NoGlyph whose message is a single character means GlyphLibrary.get() couldn't find that
            # character anywhere yet (see glyphclone.GlyphLibrary.get raising NoGlyph(ch)); other NoGlyph
            # messages (overflow past available slack) mean cloning can't work here at all, so re-raise.
            if len(str(e)) == 1:
                needle = f.right.strip(".,;:!?\"'()")
                extra = find_lines_containing(client, img, needle, model=config.DEFAULT_MODEL)
                lines = lines + _locate_lines(img, extra)
                lib = GlyphLibrary.from_lines(img, lines)
                out, box = clone_fix(img, loc, f.wrong, f.right, lib, box_right=box_right, alt_wrong=alt)
            else:
                raise
        from . import glyphclone as _gc
        info = dict(_gc.LAST_INFO)
        return out, box, f"glyphclone {info.get('wrong_used', f.wrong)!r} -> {f.right!r}" + (f" (condensed x{info['squeeze']})" if info.get("squeeze") else "")
    if backend == "retype":
        out, box = retype_word(img, loc, f.line_text, f.word_index, f.right)
        return out, box, f"retype {f.wrong!r} -> {f.right!r}"
    if backend == "inpaint_openai":
        return inpaint_word(img, loc.word_box, loc.line_box, f.wrong, f.right, expected_line, client=openai_client)
    raise ValueError(backend)


def _known_matches(f: Finding, w: str, r: str) -> bool:
    """A finding matches an instruction pair when the tokens are equal, or when the finding's
    wrong/right tokens are exactly the tokens that differ between the instruction's phrases
    ("Francis Scott Ray" -> "Francis Scott Key" covers the finding 'Ray' -> 'Key')."""
    fw, fr = _norm(f.wrong), _norm(f.right)
    if fw == _norm(w) and fr == _norm(r):
        return True
    wt, rt = _norm(w).split(), _norm(r).split()
    if len(wt) == len(rt):
        diff = [(a, b) for a, b in zip(wt, rt) if a != b]
        if len(diff) == 1 and diff[0] == (fw, fr):
            return True
    return fw in wt and fr in rt and fw != fr

def _policy(f: Finding, known=None) -> None:
    """Mark findings that must not be auto-fixed as 'review' (reported, untouched).
    Errors listed in the instructions file are always eligible, whatever kind Claude assigned."""
    if f.status != "open":
        return
    if known and any(_known_matches(f, w, r) for w, r in known):
        f.confidence = max(f.confidence, 0.99)
        return
    if _norm(f.wrong) == _norm(f.right) and f.wrong == f.right:
        f.status = "skipped"; return                      # no actual change proposed
    if f.confidence < config.NOTE_MIN_CONFIDENCE:
        f.status = "skipped"; return                      # too weak even to bother a human with
    if f.kind not in config.AUTO_FIX_KINDS or f.confidence < config.AUTO_FIX_MIN_CONFIDENCE:
        f.status = "review"

def run_poster(path: str | Path, out_dir: str | Path, client, openai_client=None, known=None,
               model: str = config.DEFAULT_MODEL, max_rounds: int = config.MAX_ROUNDS, fix: bool = True,
               tile: int = 900, overlap: int = 120, make_print_pdf: bool | None = None,
               findings_override: list[Finding] | None = None) -> PosterResult:
    path = Path(path); out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    sku = sku_from_path(path)
    work = out_dir / "_work" / sku
    img = load_pages(path)[0]
    original_img = img.copy()
    res = PosterResult(sku=sku, source=str(path), width=img.width, height=img.height)
    if findings_override is not None:
        # A human already chose these changes (dashboard "review mode"): skip inspect_poster and
        # policy entirely, run them straight through the normal fix/verify/re-inspect loop below.
        findings = findings_override
        res.findings.extend(findings)
        for f in findings:
            log(f"  finding [{f.id}] {f.box_name}: {f.wrong!r} -> {f.right!r} ({f.kind}, {f.font_style}, "
                f"conf {f.confidence:.2f}) bbox={f.bbox} [override]")
    else:
        findings = inspect_poster(client, img, known=known, model=model, tile=tile, overlap=overlap, facts_out=res.facts)
        res.findings.extend(findings)
        for f in findings:
            _policy(f, known)
            log(f"  finding [{f.id}] {f.box_name}: {f.wrong!r} -> {f.right!r} ({f.kind}, {f.font_style}, conf {f.confidence:.2f}) bbox={f.bbox}")
    if not fix:
        res.mode = "inspect"
        write_report(res, out_dir, img, original_img=original_img)
        return res
    for rnd in range(1, max_rounds + 1):
        res.rounds = rnd
        open_ = [f for f in res.findings if f.status == "open"]
        if not open_:
            break
        loc_cache: dict = {}
        for f in open_:
            set_polarity(getattr(f, "text_color", "dark"))
            from . import retype as _rt, glyphclone as _gc
            _rt.ALLOW_DONOR = _gc.ALLOW_SHIFT = (f.font_style == "plain")
            order = BACKENDS_PLAIN if f.font_style == "plain" else BACKENDS_STYLED
            if not config.USE_RETYPE:
                order = [b for b in order if b != "retype"]
            for backend in order:
                if backend == "higgsfield":
                    line = " ".join(f.line_text.split()[:f.word_index] + [f.right] + f.line_text.split()[f.word_index + 1:])
                    f.attempts.append(FixAttempt(backend="higgsfield", round=rnd, prompt=build_prompt(f.wrong, f.right, line),
                                                 note="run in Higgsfield edit mode via MCP"))
                    f.status = "needs_human"; break
                if backend == "inpaint_openai" and openai_client is None and not config.get_key("OPENAI_API_KEY"):
                    continue
                try:
                    before = img
                    after, box, prompt = apply_fix(img, f, backend, openai_client, client, model=model, loc_cache=loc_cache)
                    expected_line = " ".join(f.line_text.split()[:f.word_index] + [f.right] + f.line_text.split()[f.word_index + 1:])
                    note, gate = "", config.STYLE_GATE_MIN
                    if backend == "glyphclone":
                        from . import glyphclone as _gc
                        sq = _gc.LAST_INFO.get("squeeze")
                        if sq and sq < 0.97:
                            note = (f"The corrected word is longer than the original and the line is flush against the box "
                                    f"border, so it had to be condensed horizontally to {int(sq*100)}% to fit. Do NOT deduct "
                                    f"for the word being narrower/condensed; judge letterforms, weight, colour, baseline and paper.")
                            gate = config.STYLE_GATE_MIN_CONDENSED
                    v = verify_fix(client, before, after, box, expected_line, model=model, min_style=gate, note=note)
                    # the model's matches flag is flaky on tight crops; trust the read-back text too
                    right_n = _norm(f.right); wrong_n = _norm(f.wrong); read_n = _norm(v.read_back)
                    text_ok = bool(right_n) and right_n in read_n and (wrong_n == right_n or wrong_n not in read_n)
                    if text_ok and not v.matches:
                        v.matches = True; v.passed = v.style_score >= gate
                    elif not text_ok and v.matches and right_n and right_n not in read_n:
                        v.matches = False; v.passed = False
                    att = FixAttempt(backend=backend, round=rnd, prompt=prompt, read_back=v.read_back, style_score=v.style_score,
                                     passed=v.passed and outside_unchanged(before, after, [box]),
                                     note="; ".join(v.artifacts), box=list(box),
                                     before_crop=_save_crop(before, box, work / f"{f.id}_{backend}_r{rnd}_before.png"),
                                     after_crop=_save_crop(after, box, work / f"{f.id}_{backend}_r{rnd}_after.png"))
                    f.attempts.append(att)
                    log(f"  [{f.id}] {f.wrong!r} -> {f.right!r} via {backend}: {'PASS' if att.passed else 'FAIL'} "
                        f"style={v.style_score} read={v.read_back!r} {att.note}")
                    if backend == "glyphclone" and not att.passed and v.matches and gate - 15 <= v.style_score < gate:
                        # near miss: try the other erase strategy (clone-stamp vs inpaint) once
                        from . import retype as _rt
                        _rt.ALLOW_DONOR = not _rt.ALLOW_DONOR
                        try:
                            after2, box2, prompt2 = apply_fix(before, f, backend, openai_client, client, model=model, loc_cache=loc_cache)
                            v2 = verify_fix(client, before, after2, box2, expected_line, model=model, min_style=gate, note=note)
                            r2 = _norm(v2.read_back)
                            ok2 = bool(right_n) and right_n in r2 and (wrong_n == right_n or wrong_n not in r2)
                            passed2 = (v2.matches or ok2) and v2.style_score >= gate and outside_unchanged(before, after2, [box2])
                            att2 = FixAttempt(backend=backend, round=rnd, prompt=prompt2 + " [alt erase]", read_back=v2.read_back,
                                              style_score=v2.style_score, passed=passed2, note="; ".join(v2.artifacts), box=list(box2),
                                              before_crop=_save_crop(before, box2, work / f"{f.id}_{backend}_r{rnd}_alt_before.png"),
                                              after_crop=_save_crop(after2, box2, work / f"{f.id}_{backend}_r{rnd}_alt_after.png"))
                            f.attempts.append(att2)
                            log(f"  [{f.id}] {f.wrong!r} -> {f.right!r} via {backend} (alt erase): {'PASS' if att2.passed else 'FAIL'} style={v2.style_score}")
                            if att2.passed:
                                after, att = after2, att2
                        finally:
                            _rt.ALLOW_DONOR = not _rt.ALLOW_DONOR
                    if att.passed:
                        img = after; f.status = "fixed"; break
                except Exception as e:  # noqa: BLE001 - record and escalate to the next backend
                    f.attempts.append(FixAttempt(backend=backend, round=rnd, note=f"error: {e}"))
                    log(f"  [{f.id}] {f.wrong!r} -> {f.right!r} via {backend}: ERROR {type(e).__name__}: {e}")
        work.mkdir(parents=True, exist_ok=True)
        img.save(work / f"round{rnd}.png")
        set_polarity("auto")
        # full re-inspect: anything new (including anything a backend's edit introduced) goes into the
        # next round
        try:
            new = inspect_poster(client, img, known=None, model=model, tile=tile, overlap=overlap)
        except Exception as e:  # noqa: BLE001 - never lose a round to a bad re-inspect reply
            res.notes.append(f"round {rnd}: re-inspect failed ({type(e).__name__}: {e})")
            log(f"  re-inspect failed: {e}"); new = []
        log(f"  re-inspect round {rnd}: {len(new)} finding(s)")
        seen = {(x.line_text, x.wrong) for x in res.findings}
        for n in new:
            if (n.line_text, n.wrong) not in seen:
                _policy(n)
                res.findings.append(n)
                log(f"  new finding [{n.id}] {n.box_name}: {n.wrong!r} -> {n.right!r} ({n.kind}, conf {n.confidence:.2f}) status={n.status}")
        if not any(f.status == "open" for f in res.findings):
            break
    from .handoff import build_handoff
    from .printfile import detect_print_size
    res.handoff = build_handoff(res)
    res.print_check = detect_print_size(img.width, img.height)
    log(f"  print check: {res.print_check.get('note')}")
    suffix = "_NEEDS_HUMAN.png" if res.status == "NEEDS_HUMAN" else "_FIXED.png"
    res.output_png = str(out_dir / f"{sku}{suffix}")
    img.save(res.output_png)
    if any(f.status == "fixed" for f in res.findings):
        changes_path = out_dir / f"{sku}_CHANGES.png"
        try:
            if _write_changes_png(res, img, changes_path):
                res.changes_png = str(changes_path)
        except Exception as e:  # noqa: BLE001 - never lose the run over the overlay image
            res.notes.append(f"changes overlay failed: {type(e).__name__}: {e}")
    want_print_pdf = config.MAKE_PRINT_PDF if make_print_pdf is None else make_print_pdf
    if want_print_pdf and res.status != "NEEDS_HUMAN":
        try:
            from .printfile import make_print_pdf as _make_print_pdf
            pdf_path = out_dir / f"{sku}_{(res.print_check.get('size') or '11x17').replace('.', '')}_Fiery.pdf"
            _make_print_pdf(res.output_png, pdf_path, size_in=tuple(res.print_check.get('size_in') or config.PRINT_SIZE_IN), dpi=config.PRINT_DPI)
            res.print_pdf = str(pdf_path)
        except Exception as e:  # noqa: BLE001 - never lose the run over the print PDF
            res.notes.append(f"print PDF failed: {type(e).__name__}: {e}")
    write_report(res, out_dir, img, original_img=original_img)
    return res
