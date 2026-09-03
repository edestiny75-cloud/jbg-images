from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from PIL import Image
from .models import BBox

@dataclass
class WordLocation:
    word_box: BBox          # tight ink box of the word, full-image coords
    erase_box: BBox         # box to erase: word box widened to half-gaps, full line band vertically
    line_box: BBox          # ink box of the whole line
    baseline: int           # full-image y
    ink_color: tuple[int, int, int]
    words: list[BBox]       # all word boxes on the line (full-image coords)

def otsu(gray: np.ndarray) -> int:
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = gray.size; sum_all = float((np.arange(256) * hist).sum())
    wB = sumB = 0.0; best = -1.0; thresh = 128
    for t in range(256):
        wB += hist[t]
        if wB == 0: continue
        wF = total - wB
        if wF == 0: break
        sumB += t * hist[t]
        mB = sumB / wB; mF = (sum_all - sumB) / wF
        between = wB * wF * (mB - mF) ** 2
        if between > best: best, thresh = between, t
    return thresh

POLARITY = "auto"    # "dark" (dark text on light), "light" (light text on dark), or "auto" (minority class)

def set_polarity(mode: str | None) -> None:
    global POLARITY
    POLARITY = mode if mode in ("dark", "light") else "auto"

def ink_mask(img: Image.Image) -> np.ndarray:
    """Text pixels of a crop. POLARITY 'dark' = darker-than-threshold is ink, 'light' = lighter is ink,
    'auto' = whichever class is the minority (a crop is mostly background)."""
    g = np.asarray(img.convert("L"), dtype=np.uint8)
    t = otsu(g)
    if POLARITY == "dark":
        return g < t
    if POLARITY == "light":
        return g > t
    m = g < t
    if m.mean() > 0.5:
        m = ~m
    return m

def runs(on: np.ndarray, min_gap: int = 1) -> list[tuple[int, int]]:
    """[start, end) ranges where on>0; gaps shorter than min_gap are merged."""
    idx = np.flatnonzero(on > 0)
    if idx.size == 0: return []
    breaks = np.flatnonzero(np.diff(idx) > min_gap)
    starts = np.concatenate(([idx[0]], idx[breaks + 1]))
    ends = np.concatenate((idx[breaks], [idx[-1]])) + 1
    return list(zip(starts.tolist(), ends.tolist()))

def profile_bands(profile: np.ndarray, frac: float = 0.15) -> list[tuple[int, int]]:
    """Bands [start,end) of a row/column ink profile, robust to borders and rules (a constant ink floor).
    Hysteresis: cores are where profile > floor + frac*(max-floor); each core grows outward while the
    profile stays above the floor by a small margin (keeps descenders/thin strokes attached), but never
    past the midpoint of the gap to the neighbouring core (keeps tightly leaded lines apart)."""
    n = profile.size
    if n == 0 or profile.max() == 0:
        return []
    floor = float(np.percentile(profile, 10))
    span = float(profile.max()) - floor
    if span <= 0:
        return []
    cut = floor + frac * span
    low = floor + max(1.0, 0.03 * span)
    cores = runs(profile > cut, min_gap=1)
    bands = []
    for i, (s0, e0) in enumerate(cores):
        lim_lo = 0 if i == 0 else (cores[i - 1][1] + s0) // 2
        lim_hi = n if i == len(cores) - 1 else (e0 + cores[i + 1][0]) // 2
        s, e = s0, e0
        while s > lim_lo and profile[s - 1] > low: s -= 1
        while e < lim_hi and profile[e] > low: e += 1
        bands.append((s, e))
    return bands

def denoise_profile(profile: np.ndarray, frac: float = 0.15) -> np.ndarray:
    on = np.zeros(profile.size, dtype=bool)
    for s, e in profile_bands(profile, frac):
        on[s:e] = True
    return on

def strip_rules(mask: np.ndarray, frac: float = 0.85, margin: int = 3) -> np.ndarray:
    """Zero out columns/rows that are ink for more than `frac` of the region (box borders and rules).
    Within `margin` px of a stripped rule, also drop thin, tall remnants (antialias slivers) but keep
    real glyphs such as a comma or period that happen to sit next to the border."""
    import cv2
    m = mask.copy()
    if m.size == 0:
        return m
    cols = np.flatnonzero(m.mean(axis=0) > frac)
    rows = np.flatnonzero(m.mean(axis=1) > frac)
    for c in cols:
        m[:, c] = False
    for r in rows:
        m[r, :] = False
    if cols.size == 0 and rows.size == 0:
        return m
    bands = [(s0, e0) for s0, e0 in profile_bands(m.sum(axis=1).astype(np.float64), frac=0.35) if e0 - s0 >= 5]
    med_h = float(np.median([e0 - s0 for s0, e0 in bands])) if bands else 10.0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    drop = []
    for i in range(1, n):
        x, y = int(stats[i, cv2.CC_STAT_LEFT]), int(stats[i, cv2.CC_STAT_TOP])
        w, h = int(stats[i, cv2.CC_STAT_WIDTH]), int(stats[i, cv2.CC_STAT_HEIGHT])
        near_col = any(abs(x - c) <= margin or abs(x + w - 1 - c) <= margin for c in cols)
        near_row = any(abs(y - r) <= margin or abs(y + h - 1 - r) <= margin for r in rows)
        if near_col and w <= 3 and h >= 0.5 * med_h:
            drop.append(i)
        elif near_row and h <= 3 and w >= 0.5 * med_h:
            drop.append(i)
    if drop:
        m &= ~np.isin(labels, drop)
    return m

def text_lines(mask: np.ndarray, min_height: int = 5) -> list[tuple[int, int]]:
    bands = profile_bands(mask.sum(axis=1).astype(np.float64), frac=0.35)
    return [(s, e) for s, e in bands if e - s >= min_height]

def _drop_slivers(glyphs: list[tuple[int, int]], max_w: int = 2) -> list[tuple[int, int]]:
    """Remove isolated runs no wider than max_w px that do not touch (gap > 1) a neighbouring run:
    border antialias slivers and stray specks. Real letters are wider or touch their neighbours."""
    out = []
    for i, (a, b) in enumerate(glyphs):
        if b - a <= max_w:
            near_prev = i > 0 and a - glyphs[i - 1][1] <= 1
            near_next = i + 1 < len(glyphs) and glyphs[i + 1][0] - b <= 1
            if not (near_prev or near_next):
                continue
        out.append((a, b))
    return out

def split_words(mask: np.ndarray, y0: int, y1: int, n_words: int, pred: np.ndarray | None = None) -> list[tuple[int, int]]:
    """Split a line band into exactly n_words x-ranges. Cuts are chosen among the widest gaps; when the
    transcript's predicted relative word widths (`pred`) are given, the combination of cuts whose word
    widths best match that profile wins (robust on long lines where a comma gap beats a word space)."""
    from itertools import combinations
    cols = denoise_profile(mask[y0:y1].sum(axis=0).astype(np.float64), frac=0.05).astype(np.int64)
    glyphs = runs(cols, min_gap=0)
    glyphs = _drop_slivers(glyphs)
    if not glyphs: return []
    if n_words <= 1 or len(glyphs) < n_words:
        return [(glyphs[0][0], glyphs[-1][1])]
    gaps = [(glyphs[i + 1][0] - glyphs[i][1], i) for i in range(len(glyphs) - 1)]
    ranked = [i for _, i in sorted(gaps, reverse=True)]
    def build(cut_idx):
        words, start = [], glyphs[0][0]
        for i in sorted(cut_idx):
            words.append((start, glyphs[i][1])); start = glyphs[i + 1][0]
        words.append((start, glyphs[-1][1]))
        return words
    best_cuts = ranked[: n_words - 1]
    if pred is not None and len(pred) == n_words:
        pool = ranked[: min(len(ranked), n_words - 1 + 4)]
        best_err = None
        for combo in combinations(pool, n_words - 1):
            w = np.array([b - a for a, b in build(combo)], dtype=float)
            if w.sum() <= 0: continue
            err = float(np.abs(w / w.sum() - pred).sum())
            if best_err is None or err < best_err:
                best_err, best_cuts = err, list(combo)
    return build(best_cuts)

def natural_word_count(mask: np.ndarray, y0: int, y1: int) -> int:
    """Number of words on a line band using gaps wider than 22% of the line height as word spaces."""
    cols = denoise_profile(mask[y0:y1].sum(axis=0).astype(np.float64), frac=0.05).astype(np.int64)
    glyphs = runs(cols, min_gap=0)
    if not glyphs:
        return 0
    gap_min = max(2, int(round(0.22 * (y1 - y0))))
    n = 1
    for i in range(len(glyphs) - 1):
        if glyphs[i + 1][0] - glyphs[i][1] >= gap_min:
            n += 1
    return n

def _predicted_widths(line_text: str) -> np.ndarray:
    """Relative widths of the transcript's words rendered in a serif font (font-agnostic enough to rank lines)."""
    from .fonts import load_font
    f = load_font("georgiab", 40)
    w = np.array([max(f.getlength(t), 1.0) for t in line_text.split()], dtype=float)
    return w / w.sum()

def baseline_row(mask: np.ndarray, y0: int, y1: int, x0: int, x1: int) -> int:
    band = mask[y0:y1, x0:x1].sum(axis=1)
    if band.max() == 0: return y1
    thresh = 0.25 * band.max()
    rows = np.flatnonzero(band >= thresh)
    return y0 + int(rows[-1]) + 1

def median_ink_color(img: Image.Image, box: BBox, mask: np.ndarray | None = None) -> tuple[int, int, int]:
    region = img.crop(box); arr = np.asarray(region)
    m = ink_mask(region) if mask is None else mask[box[1]:box[3], box[0]:box[2]]
    px = arr[m] if m.any() else arr.reshape(-1, 3)
    return tuple(int(v) for v in np.median(px, axis=0))

def strip_edge_slivers(mask: np.ndarray, edge: int = 8, max_w: int = 3, min_h_frac: float = 0.6) -> np.ndarray:
    """Remove thin, tall components hugging the region's left/right edge: antialias slivers of a box
    border that survived rule stripping. Text never looks like a 1-3px wide, line-tall bar at the crop edge."""
    import cv2
    bands = [(s, e) for s, e in profile_bands(mask.sum(axis=1).astype(np.float64), frac=0.35) if e - s >= 5]
    if not bands:
        return mask
    med_h = float(np.median([e - s for s, e in bands]))
    W = mask.shape[1]
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    drop = []
    for i in range(1, n):
        x, w, h = int(stats[i, cv2.CC_STAT_LEFT]), int(stats[i, cv2.CC_STAT_WIDTH]), int(stats[i, cv2.CC_STAT_HEIGHT])
        if w <= max_w and h >= min_h_frac * med_h and (x <= edge or x + w >= W - edge):
            drop.append(i)
    if not drop:
        return mask
    return mask & ~np.isin(labels, drop)

def strip_tall_components(mask: np.ndarray, factor: float = 2.5) -> np.ndarray:
    """Remove connected ink components much taller than a text line (box borders, ornaments, rules).
    Line height is estimated from the row profile; components taller than factor * that are dropped."""
    import cv2
    bands = [(s, e) for s, e in profile_bands(mask.sum(axis=1).astype(np.float64), frac=0.35) if e - s >= 5]
    if not bands:
        return mask
    med_h = float(np.median([e - s for s, e in bands]))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    tall = np.flatnonzero(stats[:, cv2.CC_STAT_HEIGHT] > factor * med_h)
    tall = tall[tall != 0]
    if tall.size == 0:
        return mask
    return mask & ~np.isin(labels, tall)

def locate_candidates(img: Image.Image, region: BBox, line_text: str, word_index: int, max_n: int = 3) -> list[WordLocation]:
    """Candidate word locations inside `region`, best first. Lines are ranked by (a) band height
    plausibility, (b) natural word count vs the transcript, (c) relative word-width profile vs the
    transcript rendered in a serif font, (d) closeness to the region's vertical centre. Claude's line
    boxes are loose, so position alone is not enough; the pipeline confirms the winner by reading it."""
    rx0, ry0, rx1, ry1 = region
    sub = img.crop(region)
    mask = strip_edge_slivers(strip_tall_components(strip_rules(ink_mask(sub))))
    n_words = len(line_text.split())
    lines = text_lines(mask)
    if not lines:
        raise ValueError("no text lines found in region")
    med_h = float(np.median([e - s for s, e in lines]))
    max_h = float(max(e - s for s, e in lines))
    centre = (ry1 - ry0) / 2
    pred = _predicted_widths(line_text)
    scored = []
    for (y0, y1) in lines:
        words = split_words(mask, y0, y1, n_words, pred=pred)
        if not words or word_index >= len(words):
            continue
        h = y1 - y0
        plaus = 0 if h >= 0.5 * max_h else -1          # thin bands (rules, banner edges) are not text lines
        nat = natural_word_count(mask, y0, y1)
        widths = np.array([b - a for a, b in words], dtype=float)
        prof_err = float(np.abs(widths / widths.sum() - pred).sum()) if len(words) == len(pred) and widths.sum() > 0 else 9.0
        score = (plaus, -abs(nat - n_words), -round(prof_err, 2), -abs((y0 + y1) / 2 - centre))
        scored.append((score, (y0, y1), words))
    if not scored:
        raise ValueError("no usable text line in region")
    scored.sort(key=lambda t: t[0], reverse=True)
    out = []
    for _, (y0, y1), words in scored[:max_n]:
        wx0, wx1 = words[word_index]
        wrows = np.flatnonzero(mask[y0:y1, wx0:wx1].sum(axis=1))
        if wrows.size == 0:
            continue
        wy0, wy1 = y0 + int(wrows[0]), y0 + int(wrows[-1]) + 1
        left = words[word_index - 1][1] if word_index > 0 else max(wx0 - 4, 0)
        right = words[word_index + 1][0] if word_index + 1 < len(words) else min(wx1 + 4, mask.shape[1])
        ex0 = (left + wx0) // 2 if word_index > 0 else left
        ex1 = (wx1 + right) // 2 if word_index + 1 < len(words) else right
        ey0, ey1 = y0, y1                      # stay inside the line band: neighbours' descenders/ascenders are off-limits
        base = baseline_row(mask, y0, y1, words[0][0], words[-1][1])
        full = lambda b: (b[0] + rx0, b[1] + ry0, b[2] + rx0, b[3] + ry0)
        word_box = full((wx0, wy0, wx1, wy1))
        out.append(WordLocation(
            word_box=word_box,
            erase_box=full((ex0, ey0, ex1, ey1)),
            line_box=full((words[0][0], y0, words[-1][1], y1)),
            baseline=base + ry0,
            ink_color=median_ink_color(img, word_box),
            words=[full((a, y0, b, y1)) for a, b in words],
        ))
    if not out:
        raise ValueError("no usable text line in region")
    return out

def locate_word(img: Image.Image, region: BBox, line_text: str, word_index: int) -> WordLocation:
    return locate_candidates(img, region, line_text, word_index, max_n=1)[0]
