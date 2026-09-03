from __future__ import annotations
from dataclasses import dataclass, field
from difflib import SequenceMatcher
import numpy as np
from PIL import Image
from .locate import ink_mask, runs, WordLocation
from .fonts import load_font, fit_size_to_width
from .models import BBox
from .retype import ERASE_PAD

class NoGlyph(Exception):
    pass

@dataclass
class Cell:
    char: str
    box: BBox            # tight ink box, full-image coords
    baseline: int        # full-image y of the baseline of the line this cell sits on
    line_h: int = 0      # height of the line band the cell came from (for cross-size scaling)
    clean: bool = True   # produced by clean glyph separation (not a proportional guess)
    line_y: int = -1     # y of the line the cell came from (same-line preference)

@dataclass
class GlyphLibrary:
    cells: dict[str, list[Cell]] = field(default_factory=dict)

    @classmethod
    def from_lines(cls, img: Image.Image, lines: list[tuple[str, BBox, list[BBox]]]) -> "GlyphLibrary":
        """lines: [(line_text, line_box, word_boxes)] for every line in the same text box."""
        lib = cls()
        for text, line_box, word_boxes in lines:
            words = text.split()
            if len(words) != len(word_boxes):
                continue
            for w, wb in zip(words, word_boxes):
                try:
                    for c in segment_chars(img, line_box, wb, w):
                        lib.cells.setdefault(c.char, []).append(c)
                except ValueError:
                    continue
        return lib

    def get(self, ch: str, prefer: list[Cell] | None = None, target_w: int | None = None,
            target_h: int | None = None) -> Cell:
        """Best cell for `ch`: same line height first, then width closest to target_w (the glyph being
        replaced), then cells from the word itself. Raises NoGlyph(ch) when the character is unavailable."""
        pool = [c for c in (prefer or []) if c.char == ch] + [c for c in self.cells.get(ch, []) if c not in (prefer or [])]
        if not pool:
            raise NoGlyph(ch)
        own_y = prefer[0].line_y if prefer else -1
        def key(c):
            h_pen = 0 if (target_h is None or not c.line_h or abs(c.line_h - target_h) <= 0.08 * target_h) else 1
            w_diff = 0 if target_w is None else abs((c.box[2] - c.box[0]) - target_w)
            own = bool(prefer and c in prefer)
            same_line = c.line_y == own_y
            # safest sources first: the word's own letters, then the same line (same font/style),
            # then anywhere else; a proportionally-guessed (unclean) foreign cell is a last resort
            tier = 0 if (own and w_diff <= 3) else 1 if (same_line and w_diff <= 3) else 2
            return (h_pen, 0 if (own or c.clean) else 1, tier, w_diff, 0 if own else 1)
        return min(pool, key=key)

def _baseline(mask: np.ndarray) -> int:
    band = mask.sum(axis=1)
    if band.max() == 0: return mask.shape[0]
    rows = np.flatnonzero(band >= 0.25 * band.max())
    return int(rows[-1]) + 1

CELL_EXT = 0.6   # look this fraction of the line height above/below the band for the glyphs' full extent

def _word_mask(img: Image.Image, line_box: BBox, word_box: BBox):
    """Ink mask of the word including ascenders/descenders that poke outside the (often clipped) line
    band: taken from a taller window, keeping only components that overlap the band rows.
    Returns (mask, window_top_y) where mask rows are relative to window_top_y."""
    import cv2
    lx0, ly0, lx1, ly1 = line_box
    wx0, _, wx1, _ = word_box
    ext = int(round((ly1 - ly0) * CELL_EXT))
    top = max(ly0 - ext, 0); bot = min(ly1 + ext, img.height)
    win = img.crop((wx0, top, wx1, bot))
    m = ink_mask(win)
    n, labels = cv2.connectedComponents(m.astype(np.uint8), connectivity=8)
    band = np.zeros_like(m); band[ly0 - top:ly1 - top, :] = True
    keep = np.unique(labels[m & band])
    m = m & np.isin(labels, keep)
    return m, top

def segment_chars(img: Image.Image, line_box: BBox, word_box: BBox, text: str, font_name: str = "georgiab") -> list[Cell]:
    """One Cell per character of `text` inside word_box. Zero-ink column gaps first; when glyphs touch,
    split proportionally by font advances, snapping each cut to the lowest-ink column nearby.
    Cells keep their full vertical extent (descenders/ascenders) even when the line band is clipped."""
    lx0, ly0, lx1, ly1 = line_box
    wx0, _, wx1, _ = word_box
    mask, top = _word_mask(img, line_box, word_box)
    cols = mask.sum(axis=0)
    glyphs = runs(cols, min_gap=0)
    base = ly0 + _baseline(ink_mask(img.crop((lx0, ly0, lx1, ly1))))
    n = len(text)
    width = wx1 - wx0
    clean = len(glyphs) == n
    if clean:
        bounds = glyphs
    else:
        size = fit_size_to_width(font_name, text, width)
        f = load_font(font_name, size)
        adv = np.array([max(f.getlength(ch), 1.0) for ch in text], dtype=float)
        cuts = np.cumsum(adv) / adv.sum() * width
        bounds, start = [], 0
        for i in range(n - 1):
            c = int(round(cuts[i])); r = max(int(0.25 * adv[i] / adv.sum() * width), 1)
            lo, hi = max(c - r, start + 1), min(c + r, width - 1)
            cut = c if hi <= lo else lo + int(np.argmin(cols[lo:hi]))
            bounds.append((start, cut)); start = cut
        bounds.append((start, width))
    cells = []
    for ch, (a0, b0) in zip(text, bounds):
        rows = np.flatnonzero(mask[:, a0:b0].sum(axis=1))
        if rows.size == 0:
            raise ValueError(f"empty cell for {ch!r}")
        cols_c = np.flatnonzero(mask[:, a0:b0].sum(axis=0))
        cells.append(Cell(ch, (wx0 + a0 + int(cols_c[0]), top + int(rows[0]), wx0 + a0 + int(cols_c[-1]) + 1, top + int(rows[-1]) + 1), base, ly1 - ly0, clean, ly0))
    return cells

def _paste_ink(dst: Image.Image, src: Image.Image, cell: Cell, x: int, baseline: int,
               width: int | None = None, sy: float = 1.0, paper=None) -> BBox:
    """Blend `cell`'s ink onto dst at x using a soft (antialias-preserving) alpha mask, keeping dst's
    background texture. Optional resize: `width` (horizontal squeeze/stretch) and `sy` (vertical scale
    for glyphs borrowed from a line of a different size)."""
    patch = src.crop(cell.box)
    w = width if width else patch.width
    h = max(1, int(round(patch.height * sy)))
    if (w, h) != patch.size:
        patch = patch.resize((max(1, w), h), Image.LANCZOS)
    parr = np.asarray(patch).astype(np.float32)
    m = ink_mask(patch)
    # darkness reference = the paper immediately around this glyph (parchment tone varies across a poster)
    hx0, hy0 = max(cell.box[0] - 4, 0), max(cell.box[1] - 4, 0)
    hx1, hy1 = min(cell.box[2] + 4, src.width), min(cell.box[3] + 4, src.height)
    halo = np.asarray(src.crop((hx0, hy0, hx1, hy1))).astype(np.float32)
    hm = ink_mask(src.crop((hx0, hy0, hx1, hy1)))
    if (~hm).sum() >= 8:
        bg = np.median(halo[~hm].reshape(-1, 3), axis=0)
    elif paper is not None:
        bg = np.asarray(paper, dtype=np.float32)
    else:
        bg = np.median(parr[~m].reshape(-1, 3), axis=0) if (~m).any() else np.full(3, 255.0)
    dev = parr - bg                                   # signed deviation from the glyph's own background
    mag = np.abs(dev).mean(axis=2, keepdims=True)
    dev = dev * np.clip((mag - 3.0) / 6.0, 0.0, 1.0)  # ignore paper noise, keep antialiased edges
    if width and width < (cell.box[2] - cell.box[0]):  # squeezing thins strokes; compensate a little
        dev *= min(((cell.box[2] - cell.box[0]) / float(width)) * 1.1, 1.35)
    darkness = -dev
    y = int(round(baseline - (cell.baseline - cell.box[1]) * sy))
    region = dst.crop((x, y, x + patch.width, y + patch.height))
    arr = np.asarray(region).astype(np.float32)
    blended = arr - darkness                          # deviation transfer keeps antialiasing + full weight
    dst.paste(Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8)), (x, y))
    return (x, y, x + patch.width, y + patch.height)

def _union(a: BBox, b: BBox) -> BBox:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))

def _has_ink(img: Image.Image, context_box: BBox, box: BBox) -> bool:
    """Whether `box` (a subset of context_box) contains ink. Otsu is computed over `context_box` rather
    than `box` alone: a narrow near-blank crop has too little contrast for a stable threshold and otsu
    ends up classifying antialiasing noise at its own edge as the 'ink' class. Widening the context to
    include real text (or, failing that, more background) gives a threshold that doesn't do that."""
    cx0, cy0, cx1, cy1 = context_box
    mask = ink_mask(img.crop(context_box))
    bx0, by0, bx1, by1 = box[0] - cx0, box[1] - cy0, box[2] - cx0, box[3] - cy0
    bx0, by0 = max(bx0, 0), max(by0, 0)
    bx1, by1 = min(bx1, mask.shape[1]), min(by1, mask.shape[0])
    if bx1 <= bx0 or by1 <= by0:
        return False
    return bool(mask[by0:by1, bx0:bx1].any())

MAX_SQUEEZE = 0.85      # never compress a rebuilt word below 85% of its natural width
BORDER_MARGIN = 1       # keep this many px clear of a detected border/rule
SOFT_SQUEEZE = 0.93     # squeeze up to this much before touching the word space
MAX_HEAD_SHIFT = 2
ALLOW_SHIFT = True      # head/tail shifting into slack; off for stylized/plate text (tight frames)      # px the head of a flush line may slide left into the margin
SIZE_TOL = 0.08         # rescale borrowed glyphs when their line height differs by more than 8%

def _free_left(src: Image.Image, line_box: BBox, box_left: int = 0) -> int:
    """Ink-free pixels immediately left of the line start, stopping at the first ink column or box_left."""
    lx0, ly0, lx1, ly1 = line_box
    limit = max(box_left, 0)
    if lx0 <= limit:
        return 0
    mask = ink_mask(src.crop((limit, ly0, lx1, ly1)))
    cols = mask[:, : lx0 - limit].sum(axis=0)
    ink = np.flatnonzero(cols > 0)
    return max((lx0 - limit) - int(ink[-1]) - 2, 0) if ink.size else lx0 - limit

def _paper(src: Image.Image, line_box: BBox) -> np.ndarray:
    region = src.crop(line_box); arr = np.asarray(region).astype(np.float32); m = ink_mask(region)
    return np.median(arr[~m].reshape(-1, 3), axis=0) if (~m).any() else np.full(3, 255.0, dtype=np.float32)

def _free_slack(src: Image.Image, line_box: BBox, box_right: int) -> int:
    """Ink-free pixels immediately right of the line end, stopping at the first ink column (a box border,
    rule or decoration) or at box_right. Otsu is computed over the whole line so the threshold is stable."""
    lx0, ly0, lx1, ly1 = line_box
    limit = min(box_right, src.width)
    if limit <= lx1:
        return 0
    mask = ink_mask(src.crop((lx0, ly0, limit, ly1)))
    cols = mask[:, lx1 - lx0:].sum(axis=0)
    ink = np.flatnonzero(cols > 0)
    return max(int(ink[0]) - 1, 0) if ink.size else limit - lx1

def _layout(own: list[Cell], wrong: str, right: str, lib: GlyphLibrary, gap: int, scales: list[float] | None = None):
    """Place cells for `right`, keeping every untouched letter at its ORIGINAL x (shifted only by the
    width change of edits before it), so the poster's own letter spacing is preserved. Inserted or
    replaced letters are placed with the word's median inter-glyph gap. Returns [(cell, x, width, sy)]."""
    items = []          # (cell, x, w, sy)
    items_offsets = []  # (item index, extra x offset) applied after layout
    delta = 0
    def cell_w(c):
        sy = 1.0
        return c.box[2] - c.box[0], sy
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, wrong, right, autojunk=False).get_opcodes():
        if tag == "equal":
            for c in own[i1:i2]:
                w, sy = cell_w(c)
                items.append((c, c.box[0] + delta, w, sy))
        elif tag in ("replace", "insert"):
            if i1 > 0:
                anchor = items[-1][1] + items[-1][2] + gap if items else own[i1 - 1].box[2] + delta + gap
            else:
                anchor = own[0].box[0] + delta
            x = anchor
            old_cells = own[i1:i2] if tag == "replace" else []
            for k, ch in enumerate(right[j1:j2]):
                tw = (old_cells[k].box[2] - old_cells[k].box[0]) if k < len(old_cells) else None
                c = lib.get(ch, prefer=own, target_w=tw, target_h=own[0].line_h if own else None)
                w, sy = cell_w(c)
                items.append((c, x, w, sy))
                x += w + gap
            new_end = x - gap
            if tag == "replace":
                old_end = own[i2 - 1].box[2] + delta
                d = new_end - old_end
                if d < 0 and i2 < len(own):
                    # narrower replacement: do not pull the rest of the word left (that widens the gap to
                    # the next word); spread the slack as +1px gaps after the following letters instead
                    slack = -d
                    following = own[i2:]
                    per = [1] * min(slack, len(following)) + [0] * max(len(following) - slack, 0)
                    items_offsets.extend([(len(items) + k, sum(per[:k + 1])) for k in range(len(following))])
                    delta += d + sum(per)
                else:
                    delta += d
            else:
                # inserted before own[i1]: everything after moves right by the inserted span
                nxt = own[i1].box[0] + delta if i1 < len(own) else new_end
                delta += (new_end + gap) - nxt
        elif tag == "delete":
            old_span = own[i2 - 1].box[2] - own[i1].box[0]
            delta -= old_span + gap
    for idx_i, extra in items_offsets:
        if idx_i < len(items):
            c, x, w, sy = items[idx_i]
            items[idx_i] = (c, x + extra, w, sy)
    return items

def _repack(items, start: int, sq: float):
    """Re-place cells left-to-right with widths and inter-cell gaps scaled by `sq`, computed
    cumulatively so letters that touched keep touching (no rounding gaps). items: [[cell, x, w, sy]]
    in left-to-right order, unsqueezed."""
    out = []
    prev_end = None; prev_src_end = None
    for c, x, w, sy in items:
        gap = 0 if prev_src_end is None else max(x - prev_src_end, 0)
        nx = start if prev_end is None else prev_end + int(round(gap * sq))
        nw = max(1, int(round(w * sq)))
        out.append([c, nx, nw, sy])
        prev_end = nx + nw
        prev_src_end = x + w
    return out, prev_end

LAST_INFO: dict = {}     # details of the most recent clone_fix (squeeze factor, token used)

def reconcile_wrong(img: Image.Image, loc: WordLocation, wrong: str, alt: str | None) -> str:
    """Claude sometimes drops or alters a letter when quoting the wrong token in the findings JSON.
    A read-back of the confirmed line (context helps) is more reliable: when it offers a different but
    similar token, use it for segmentation."""
    if not alt or alt == wrong:
        return wrong
    ratio = SequenceMatcher(None, alt.lower(), wrong.lower(), autojunk=False).ratio()
    return alt if ratio >= 0.7 else wrong

def clone_fix(img: Image.Image, loc: WordLocation, wrong: str, right: str, lib: GlyphLibrary,
              box_right: int, alt_wrong: str | None = None) -> tuple[Image.Image, BBox]:
    """Rebuild the word from cloned glyph cells, preserving the original letter positions of untouched
    letters. Fit strategy when the corrected word is wider than its slot: (1) shift the rest of the
    line right into ragged-right slack, (2) tighten the space before the word to 2px, (3) squeeze the
    rebuilt word horizontally down to MAX_SQUEEZE. Else raise NoGlyph.
    box_right: right edge of the text box (full-image x); the real border is detected from ink anyway."""
    from .retype import erase
    src = img.copy()
    out = img.copy()
    LAST_INFO.clear()
    wrong = reconcile_wrong(src, loc, wrong, alt_wrong)
    LAST_INFO["wrong_used"] = wrong
    own = segment_chars(src, loc.line_box, loc.word_box, wrong)
    gaps = [own[i + 1].box[0] - own[i].box[2] for i in range(len(own) - 1)]
    gap = max(int(np.median(gaps)), 0) if gaps else 1
    items = _layout(own, wrong, right, lib, gap)
    if not items:
        raise NoGlyph("nothing to draw")
    # cross-size scaling for borrowed glyphs
    target_h = loc.line_box[3] - loc.line_box[1]
    scaled = []
    for c, x, w, sy in items:
        if c.line_h and target_h and abs(c.line_h - target_h) / target_h > SIZE_TOL:
            sy = target_h / c.line_h
            w = max(1, int(round(w * sy)))
        scaled.append([c, x, w, sy])
    items = scaled
    start = min(x for _, x, _, _ in items)
    end = max(x + w for _, x, w, _ in items)
    total = end - start

    wx0 = loc.word_box[0]
    idx = next((i for i, wb in enumerate(loc.words) if wb[0] == wx0), None)
    is_last = idx is None or idx + 1 >= len(loc.words)
    slack = _free_slack(src, loc.line_box, box_right)
    if slack < 3:                                  # ink (border) right after the line: keep clear of it
        slack = max(slack - BORDER_MARGIN, 0) if slack else -BORDER_MARGIN
    if is_last:
        next_x0 = loc.line_box[2]
        word_gap = 0
        end_limit = loc.line_box[2] + slack
    else:
        next_x0 = loc.words[idx + 1][0]
        word_gap = max(next_x0 - loc.word_box[2], 1)
        end_limit = next_x0 - word_gap + slack          # the tail may move right by up to `slack`
    overflow = (start + total) - end_limit
    if overflow > 0 and idx:
        # if a gentle squeeze (>= SOFT_SQUEEZE) is enough, keep the word space; otherwise pull the word
        # left (leaving >= 2px) and squeeze the rest
        avail_now = end_limit - start
        if total and avail_now / total < SOFT_SQUEEZE:
            pull = min(overflow, max(wx0 - loc.words[idx - 1][2] - 2, 0))
            if pull > 0:
                for it in items: it[1] -= pull
                start -= pull; overflow -= pull
    head_shift = 0
    if ALLOW_SHIFT and overflow > 0 and total and (end_limit - start) / total < SOFT_SQUEEZE:
        # last resort before heavy condensing: slide the whole head of the line left by a few px into
        # the left margin (invisible at print size), gaining that much room for the word
        slack_left_now = _free_left(src, loc.line_box)
        head_shift = min(overflow, max(slack_left_now - BORDER_MARGIN, 0), MAX_HEAD_SHIFT)
        if head_shift > 0:
            head_box = (loc.line_box[0], loc.line_box[1], loc.word_box[0], loc.line_box[3])
            if head_box[2] > head_box[0]:
                head = src.crop(head_box)
                erased_head = erase(out, head_box)
                out.paste(head, (head_box[0] - head_shift, head_box[1]))
                changed_head = _union(erased_head, (head_box[0] - head_shift, head_box[1], head_box[2], head_box[3]))
            else:
                changed_head = None
            for it in items: it[1] -= head_shift
            start -= head_shift; overflow -= head_shift
    if overflow > 0:
        avail = end_limit - start
        sq = avail / total if total else 1.0
        if sq < MAX_SQUEEZE:
            raise NoGlyph(f"corrected word needs {total}px but only {avail}px are available (squeeze {sq:.2f} < {MAX_SQUEEZE})")
        base = [list(it) for it in items]
        LAST_INFO["squeeze"] = round(sq, 3)
        items, end = _repack(base, start, sq)
        while end > end_limit and sq > MAX_SQUEEZE - 0.04:      # rounding guard: nudge the factor down
            sq -= 0.01
            items, end = _repack(base, start, sq)
        if end > end_limit:
            raise NoGlyph(f"could not fit corrected word into {avail}px")
        total = end - start

    changed = loc.erase_box
    if head_shift > 0 and changed_head is not None:
        changed = _union(changed, changed_head)
    if not is_last:
        shift = max((start + total + word_gap) - next_x0, 0)
        if shift > 0:
            if shift > slack or (not ALLOW_SHIFT and shift > 2):     # framed text: tiny shifts only
                raise NoGlyph(f"tail shift {shift}px exceeds slack {slack}px")
            tail_box = (next_x0, loc.line_box[1], loc.line_box[2], loc.line_box[3])
            tail = src.crop(tail_box)
            erased_tail = erase(out, tail_box)
            out.paste(tail, (tail_box[0] + shift, tail_box[1]))
            changed = _union(changed, _union(erased_tail, (tail_box[0] + shift, tail_box[1], tail_box[2] + shift, tail_box[3])))
    slack_left = _free_left(src, loc.line_box)
    ebox = (min(loc.erase_box[0], start), loc.erase_box[1], max(loc.erase_box[2], start + total + 1), loc.erase_box[3])
    ebox = (max(ebox[0], loc.line_box[0] - slack_left, 0), ebox[1], min(ebox[2], loc.line_box[2] + max(slack, 0) + 1, out.width), ebox[3])
    changed = _union(changed, erase(out, ebox))
    paper = _paper(src, loc.line_box)
    for c, x, w, sy in items:
        b = _paste_ink(out, src, c, int(x), loc.baseline, width=int(w), sy=sy, paper=paper)
        changed = _union(changed, b)
    W, H = out.size
    return out, (max(changed[0], 0), max(changed[1], 0), min(changed[2], W), min(changed[3], H))
