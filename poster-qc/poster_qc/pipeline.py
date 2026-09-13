from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw
from . import config
from .ingest import load_pages, sku_from_path
from .inspect import inspect_poster, find_lines_containing, read_line
from .locate import locate_candidates, set_polarity, resolve_polarity, tighten_region, infer_polarity, deskew_image, map_box_affine, paper_fill_color
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


def _backends_for_finding(font_style: str, skew_angle: float = 0.0) -> list[str]:
    """Backend try-order for one finding. Steep stylized skew → human only (see run_poster)."""
    order = list(BACKENDS_PLAIN if font_style == "plain" else BACKENDS_STYLED)
    if not config.USE_RETYPE:
        order = [b for b in order if b != "retype"]
    ang = float(skew_angle or 0)
    if ang:
        if abs(ang) >= 45 and font_style != "plain":
            return ["higgsfield"]
        return ["glyphclone"] + [b for b in order if b not in ("glyphclone", "inpaint_openai")]
    return order


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


def _has_whole_token(haystack_norm: str, needle_norm: str) -> bool:
    """True if needle_norm appears as contiguous whole word(s) in haystack_norm (both _norm'd)."""
    if not needle_norm:
        return False
    hay = haystack_norm.split()
    needle = needle_norm.split()
    if not needle:
        return False
    n = len(needle)
    for i in range(len(hay) - n + 1):
        if hay[i:i + n] == needle:
            return True
    return False


def _verify_text_ok(read_back: str, wrong: str, right: str) -> bool:
    """Word-boundary check that the fix landed: right present, wrong gone (when they differ).

    Uses the same punctuation folding as `_norm`. Substring `in` is intentionally avoided so
    e.g. right='art' does not false-pass on 'artifact', and wrong='cat' is not flagged present
    inside 'category'.
    """
    right_n = _norm(right)
    wrong_n = _norm(wrong)
    read_n = _norm(read_back)
    if not right_n:
        return False
    if not _has_whole_token(read_n, right_n):
        return False
    if wrong_n != right_n and _has_whole_token(read_n, wrong_n):
        return False
    return True


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

def _search_region(img: Image.Image, f: Finding) -> tuple:
    """Padded locate region. Prefer a tighter box_bbox for tall map-label crops (Claude's line bbox is
    often a long vertical strip that includes river and chrome)."""
    src = f.bbox
    if f.box_bbox:
        bx0, by0, bx1, by1 = f.box_bbox
        x0, y0, x1, y1 = f.bbox
        b_area = max((bx1 - bx0) * (by1 - by0), 1)
        a_area = max((x1 - x0) * (y1 - y0), 1)
        # Use box_bbox when it is meaningfully tighter, especially for tall/rotated labels.
        if b_area < 0.85 * a_area or (by1 - by0) > (bx1 - bx0) * 1.1:
            src = f.box_bbox
    x0, y0, x1, y1 = src
    tall = (y1 - y0) >= (x1 - x0) * 1.15
    # Tall map labels need little vertical pad (extra river/chrome confuses deskew). Wide nameplate /
    # body boxes still use REGION_PAD_Y because Claude often clips ascenders.
    pad_frac = 0.12 if tall else config.REGION_PAD_Y
    pad_y = max(6, int(round((y1 - y0) * pad_frac)))
    return (max(x0 - config.REGION_PAD_X, 0), max(y0 - pad_y, 0),
            min(x1 + config.REGION_PAD_X, img.width), min(y1 + pad_y, img.height))


def _locate_checked(img: Image.Image, f: Finding, client, model: str, cache: dict | None = None):
    """Locate the word, then have Claude read the chosen line crop and confirm it matches the transcript.
    Tries up to three candidate lines. Cached per finding so retries across backends do not re-read."""
    if cache is not None and f.id in cache:
        return cache[f.id]
    region = _search_region(img, f)
    rw, rh = region[2] - region[0], region[3] - region[1]
    tall = rh >= rw * 1.15
    # Light cream lettering on a dark ribbon/plate: Claude's box often includes parchment around the
    # cell. Tightening to the dark plate keeps Otsu / glyph splits on the lettering, not the plaque.
    # Skip tighten on tall map-label crops: the "dark plate" heuristic latches onto rivers/borders.
    pol = getattr(f, "text_color", None) or infer_polarity(img.crop(region))
    if tall:
        pol = "dark"
        f.text_color = "dark"
        set_polarity("dark")
    else:
        region = tighten_region(img, region, pol)
        set_polarity(pol)
    cands = locate_candidates(img, region, f.line_text, f.word_index)
    # Skewed map-label hits force dark ink polarity for glyphclone / donor downstream.
    if cands and getattr(cands[0], "skew_angle", 0):
        f.text_color = "dark"
        set_polarity("dark")
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
    region = _search_region(img, f)
    pol = getattr(f, "text_color", None) or infer_polarity(img.crop(region))
    region = tighten_region(img, region, pol)
    try:
        for c in locate_candidates(img, region, f.line_text, wi):
            if c.line_box[1] == ref.line_box[1]:
                return c
    except ValueError:
        return None
    return None

def _upright_loc(loc):
    """WordLocation in deskewed-crop coords for skewed map labels."""
    from .locate import WordLocation
    return WordLocation(
        word_box=loc.upright_word_box,
        erase_box=loc.upright_erase_box,
        line_box=loc.upright_line_box,
        baseline=loc.upright_baseline if loc.upright_baseline is not None else 0,
        ink_color=loc.ink_color,
        words=list(loc.upright_words or []),
    )


def _clamp_uloc_to_line_band(uloc, pad: int = 3):
    """Keep upright erase/word boxes inside the line band so river chrome is not treated as ink."""
    from .locate import WordLocation
    lx0, ly0, lx1, ly1 = uloc.line_box
    y0, y1 = ly0 - pad, ly1 + pad

    def _clamp(b):
        if b is None:
            return b
        return (b[0], max(b[1], y0), b[2], min(b[3], y1))

    wb = _clamp(uloc.word_box)
    # Prefer word-box x (plus 2px) over a wide erase that reaches into the next (often clipped) word.
    eb = _clamp(uloc.erase_box)
    if wb is not None and eb is not None:
        eb = (max(eb[0], wb[0] - 2), eb[1], min(eb[2], wb[2] + 2), eb[3])
    return WordLocation(
        word_box=wb,
        erase_box=eb,
        line_box=uloc.line_box,
        baseline=uloc.baseline,
        ink_color=uloc.ink_color,
        words=[_clamp(w) for w in (uloc.words or [])],
    )


def _restore_outside_line_band(edited: Image.Image, original: Image.Image, line_box, pad: int = 4) -> Image.Image:
    """Undo clone/erase damage below/above the text band (river lines, borders)."""
    import numpy as np
    a = np.asarray(edited.convert("RGB")).copy()
    b = np.asarray(original.convert("RGB"))
    ly0 = max(line_box[1] - pad, 0)
    ly1 = min(line_box[3] + pad, a.shape[0])
    if ly0 > 0:
        a[:ly0] = b[:ly0]
    if ly1 < a.shape[0]:
        a[ly1:] = b[ly1:]
    return Image.fromarray(a)


def _warp_edit_onto_sub(sub: Image.Image, rot: Image.Image, out_rot: Image.Image, Minv,
                        erase_box, dilate: int = 3) -> tuple:
    """Warp an upright edit back onto the skewed sub-crop using a *warped* mask.

    Filling the axis-aligned bounding box of the mapped erase box (old behaviour) paints a huge
    parallelogram over rivers/borders on steep map labels. Instead, build the mask in upright
    space and warp it with NEAREST so only the text band is composited.
    """
    import cv2
    import numpy as np
    arr_rot = np.asarray(out_rot.convert("RGB"))
    arr_pre = np.asarray(rot.convert("RGB"))
    arr_sub = np.asarray(sub.convert("RGB"))
    # Delta-only mask in upright space (dilated). Filling the whole erase band and warping it
    # paints a text-aligned parallelogram that often clips the parallel river on map labels.
    em = np.zeros(arr_rot.shape[:2], dtype=np.uint8)
    delta = np.abs(arr_rot.astype(np.int16) - arr_pre.astype(np.int16)).max(axis=2) > 6
    # Restrict deltas to the erase band so deskew interpolation noise elsewhere is ignored.
    ex0, ey0, ex1, ey1 = erase_box
    ey0, ey1 = max(ey0, 0), min(ey1, em.shape[0])
    ex0, ex1 = max(ex0, 0), min(ex1, em.shape[1])
    band = np.zeros_like(delta)
    if ey1 > ey0 and ex1 > ex0:
        band[ey0:ey1, ex0:ex1] = True
    em[delta & band] = 255
    if dilate > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate * 2 + 1, dilate * 2 + 1))
        em = cv2.dilate(em, k)
        # Keep dilation from escaping far outside the erase band.
        if ey1 > ey0 and ex1 > ex0:
            allow = np.zeros_like(em)
            ay0, ay1 = max(ey0 - dilate - 1, 0), min(ey1 + dilate + 1, em.shape[0])
            ax0, ax1 = max(ex0 - dilate - 1, 0), min(ex1 + dilate + 1, em.shape[1])
            allow[ay0:ay1, ax0:ax1] = 255
            em = cv2.bitwise_and(em, allow)
    mask = cv2.warpAffine(em, Minv, (sub.width, sub.height), flags=cv2.INTER_NEAREST) > 0
    back = cv2.warpAffine(arr_rot, Minv, (sub.width, sub.height), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REFLECT)
    composed = arr_sub.copy()
    composed[mask] = back[mask]
    return Image.fromarray(composed), mask


def _apply_fix_skewed(img: Image.Image, f: Finding, loc, backend: str, openai_client, client,
                       model: str, expected_line: str) -> tuple[Image.Image, tuple, str]:
    """Clone/inpaint on a deskewed crop, then warp the edit back onto the poster."""
    from .glyphclone import GlyphLibrary, clone_fix, NoGlyph
    from .inpaint_openai import inpaint_word
    from .retype import retype_word
    from . import glyphclone as _gc

    rx0, ry0, rx1, ry1 = loc.skew_region
    sub = img.crop(loc.skew_region)
    fill = paper_fill_color(sub)
    rot, M, Minv = deskew_image(sub, loc.skew_angle, fill=fill)
    uloc = _clamp_uloc_to_line_band(_upright_loc(loc))
    # Skew crops often clip the next word (e.g. "RIVER"); a 6px stub makes clone_fix think the
    # line is flush and force a heavy squeeze. Keep a clean [target, ...trailers] word list — never
    # insert a duplicate of word_box (that sets next_x0 == word_x0 and collapses slack to ~0).
    from .locate import WordLocation as _WL
    wb = uloc.word_box
    trailers = []
    for w in (uloc.words or []):
        if (w[2] - w[0]) < 12:
            continue
        # same span as the target (or nearly): skip
        if abs(w[0] - wb[0]) <= 2 and abs(w[2] - wb[2]) <= 2:
            continue
        trailers.append(w)
    words = [wb] + trailers
    uloc = _WL(
        word_box=wb, erase_box=uloc.erase_box, line_box=uloc.line_box,
        baseline=uloc.baseline, ink_color=uloc.ink_color, words=words,
    )
    set_polarity("dark")
    # Tight glyph window: map-label river ink sits just under the line and poisons CELL_EXT=0.6.
    # Allow a little ragged-right shift on parchment so an inserted letter need not be squeezed away.
    prev_ext = _gc.CELL_EXT
    prev_shift = _gc.ALLOW_SHIFT
    _gc.CELL_EXT = 0.12
    _gc.ALLOW_SHIFT = True
    try:
        if backend == "glyphclone":
            lines = [(f.line_text, uloc.line_box, uloc.words)]
            lib = GlyphLibrary.from_lines(rot, lines)
            box_right = rot.width
            alt = getattr(f, "read_line_token", None) or getattr(f, "read_wrong", None)
            wrong_used = _gc.reconcile_wrong(rot, uloc, f.wrong, alt)
            surgical = _gc.surgical_insert(rot, uloc, wrong_used, f.right, lib, box_right=box_right)
            if surgical is not None:
                out_rot, box_rot = surgical
            else:
                out_rot, box_rot = clone_fix(rot, uloc, f.wrong, f.right, lib, box_right=box_right, alt_wrong=alt)
            info = dict(_gc.LAST_INFO)
            tag = "surgical" if info.get("surgical") else "glyphclone"
            prompt = f"{tag}-skew@{loc.skew_angle:.0f} {info.get('wrong_used', f.wrong)!r} -> {f.right!r}"
        elif backend == "retype":
            out_rot, box_rot = retype_word(rot, uloc, f.line_text, f.word_index, f.right)
            prompt = f"retype-skew@{loc.skew_angle:.0f} {f.wrong!r} -> {f.right!r}"
        elif backend == "inpaint_openai":
            out_rot, box_rot, prompt = inpaint_word(
                rot, uloc.word_box, uloc.line_box, f.wrong, f.right, expected_line, client=openai_client
            )
            prompt = f"inpaint-skew@{loc.skew_angle:.0f} " + (prompt or "")
        else:
            raise ValueError(backend)
    finally:
        _gc.CELL_EXT = prev_ext
        _gc.ALLOW_SHIFT = prev_shift

    # Keep river / borders: only the line band may differ from the pre-edit deskew.
    out_rot = _restore_outside_line_band(out_rot, rot, uloc.line_box, pad=3)
    # Clamp reported change box into the line band too (avoids verify zooming onto river seams).
    if isinstance(box_rot, (list, tuple)) and len(box_rot) == 4:
        bx0, by0, bx1, by1 = box_rot
        box_rot = (bx0, max(by0, uloc.line_box[1] - 2), bx1, min(by1, uloc.line_box[3] + 2))

    # Warp mask follows the actual change box (surgical inserts are local); fall back to erase band.
    warp_erase = tuple(box_rot) if isinstance(box_rot, (list, tuple)) and len(box_rot) == 4 else uloc.erase_box
    # Pad a few px so antialiased edges land, but stay inside the line band.
    we = (max(warp_erase[0] - 2, uloc.line_box[0] - 2),
          max(warp_erase[1] - 1, uloc.line_box[1] - 1),
          min(warp_erase[2] + 2, uloc.line_box[2] + 2),
          min(warp_erase[3] + 1, uloc.line_box[3] + 1))
    composed, _mask = _warp_edit_onto_sub(sub, rot, out_rot, Minv, we, dilate=2)
    out = img.copy()
    out.paste(composed, (rx0, ry0))
    box_full = map_box_affine(tuple(box_rot), Minv)
    box_full = (box_full[0] + rx0, box_full[1] + ry0, box_full[2] + rx0, box_full[3] + ry0)
    return out, box_full, prompt


def apply_fix(img: Image.Image, f: Finding, backend: str, openai_client, client,
              model: str = config.DEFAULT_MODEL, loc_cache: dict | None = None) -> tuple[Image.Image, tuple, str]:
    loc = _locate_checked(img, f, client, model, loc_cache)
    f.word_box, f.line_box = loc.word_box, loc.line_box
    expected_line = " ".join(f.line_text.split()[:f.word_index] + [f.right] + f.line_text.split()[f.word_index + 1:])
    if getattr(loc, "skew_angle", 0) and loc.skew_region and loc.upright_word_box:
        return _apply_fix_skewed(img, f, loc, backend, openai_client, client, model, expected_line)
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
                needle = f.right.strip('.,;:!?"\'()')
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
            # Resolve light-on-dark nameplates/ribbons from pixels (Claude's text_color is often wrong
            # or left at the dark default). Wrong polarity makes glyph segmentation and paper-donor fail.
            crop = img.crop(tuple(f.bbox)) if f.bbox else img
            pol = resolve_polarity(crop, getattr(f, "text_color", None))
            f.text_color = pol
            set_polarity(pol)
            from . import retype as _rt, glyphclone as _gc
            # Dark ribbon/plate cells: never clone-stamp from surrounding parchment; inpaint + regrain
            # keeps the plaque surface. Shifting into slack also fights tight frames.
            plate = (pol == "light")
            _rt.ALLOW_DONOR = (f.font_style == "plain") and not plate
            _gc.ALLOW_SHIFT = (f.font_style == "plain") and not plate
            order = _backends_for_finding(f.font_style, 0)
            try:
                loc_peek = _locate_checked(img, f, client, model, loc_cache)
                ang = float(getattr(loc_peek, "skew_angle", 0) or 0)
                order = _backends_for_finding(f.font_style, ang)
                if order == ["higgsfield"] and ang:
                    log(f"  [{f.id}] steep skewed stylized label (angle={ang:.0f}): skip auto-fix → human")
            except Exception:
                pass
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
                    text_ok = _verify_text_ok(v.read_back, f.wrong, f.right)
                    right_n = _norm(f.right)
                    if text_ok and not v.matches:
                        v.matches = True; v.passed = v.style_score >= gate
                    elif not text_ok and v.matches and right_n and not _has_whole_token(_norm(v.read_back), right_n):
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
                            ok2 = _verify_text_ok(v2.read_back, f.wrong, f.right)
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
