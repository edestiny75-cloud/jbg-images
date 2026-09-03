from __future__ import annotations
import numpy as np
from PIL import Image, ImageDraw
from .locate import WordLocation, ink_mask
from .fonts import load_font, fit_size_to_width
from .models import BBox

def background_color(img: Image.Image, box: BBox) -> tuple[int, int, int]:
    region = img.crop(box); arr = np.asarray(region); m = ink_mask(region)
    px = arr[~m] if (~m).any() else arr.reshape(-1, 3)
    return tuple(int(v) for v in np.median(px, axis=0))

ERASE_PAD = 6
ALLOW_DONOR = True   # clone-stamp paper from elsewhere; the pipeline turns this off for stylized/plate text

def _regrain(filled: np.ndarray, orig: np.ndarray, ink: np.ndarray, sel: np.ndarray, radius: int = 14, seed: int = 7) -> np.ndarray:
    """Inpainting produces a smooth fill that reads as a 'flat patch' next to grainy paper. Put the grain
    back: for every filled pixel add the high-frequency residual of a randomly chosen nearby non-ink
    pixel (its value minus the local paper mean). Keeps the fill's tone, restores the paper's texture."""
    import cv2
    H, W = ink.shape
    # donors must be clean paper: at least 2px away from any ink (antialias fringes carry dark residuals)
    paper = cv2.erode((~ink).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    if paper.sum() < 16 or not sel.any():
        return filled
    f = orig.astype(np.float32)
    k = 2 * radius + 1
    pm = paper.astype(np.float32)
    mean = cv2.blur(f * pm[..., None], (k, k)) / np.maximum(cv2.blur(pm, (k, k)), 1e-3)[..., None]
    resid = f - mean                                  # grain of the original paper
    lim = 2.5 * float(np.std(resid[paper])) + 1.0     # clamp outliers so no speckles are transplanted
    resid = np.clip(resid, -lim, lim)
    rng = np.random.default_rng(seed)
    ys, xs = np.nonzero(sel)
    out = filled.astype(np.float32).copy()
    got = np.zeros(len(ys), dtype=bool)
    grain = np.zeros((len(ys), 3), dtype=np.float32)
    for _ in range(6):                                # a few tries to land on a paper pixel
        dy = rng.integers(-radius, radius + 1, len(ys)); dx = rng.integers(-radius, radius + 1, len(ys))
        sy = np.clip(ys + dy, 0, H - 1); sx = np.clip(xs + dx, 0, W - 1)
        ok = paper[sy, sx] & ~sel[sy, sx] & ~got
        grain[ok] = resid[sy[ok], sx[ok]]
        got |= ok
        if got.all():
            break
    out[ys[got], xs[got]] += grain[got]
    return np.clip(out, 0, 255).astype(np.uint8)

def _find_paper_donor(img: Image.Image, box: BBox, shape: tuple[int, int], origin: tuple[int, int],
                      reach_x: int = 220, reach_lines: int = 6, margin: int = 2):
    """Find an ink-free rectangle the size of the erase window near `box` (same text box: to the right
    of short lines, between paragraphs). Returns its top-left (full-image) or None."""
    h, w = shape
    X0, Y0 = origin
    bh = box[3] - box[1]
    sx0, sy0 = max(X0 - reach_x, 0), max(Y0 - reach_lines * bh, 0)
    sx1, sy1 = min(X0 + w + reach_x, img.width), min(Y0 + h + reach_lines * bh, img.height)
    if sx1 - sx0 < w + 2 * margin or sy1 - sy0 < h + 2 * margin:
        return None
    region = img.crop((sx0, sy0, sx1, sy1))
    ink = ink_mask(region).astype(np.int32)
    # a donor must not overlap the erase window itself
    ink[Y0 - sy0:Y0 - sy0 + h, X0 - sx0:X0 - sx0 + w] = 1
    integ = np.pad(ink, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    H, W = ink.shape
    ww, hh = w + 2 * margin, h + 2 * margin
    best = None
    for y in range(0, H - hh + 1, 2):
        row = integ[y + hh, ww:W + 1] - integ[y, ww:W + 1] - integ[y + hh, 0:W + 1 - ww] + integ[y, 0:W + 1 - ww]
        xs = np.flatnonzero(row == 0)
        if xs.size == 0:
            continue
        for x in xs[::2]:
            d = abs((sy0 + y) - Y0) + 0.3 * abs((sx0 + x) - X0)     # prefer same rows (same paper tone)
            if best is None or d < best[0]:
                best = (d, sx0 + x + margin, sy0 + y + margin)
    return None if best is None else (best[1], best[2])

def erase(img: Image.Image, box: BBox, halo: int = 2, ext: float = 0.6) -> BBox:
    """Remove the ink inside `box` while keeping the paper texture, without touching neighbours.
    Only connected ink components that overlap `box` are erased (so a word's own descenders below
    the line band go too), the search window extends `ext` * box height above and below the box.
    Ink that is NOT part of the target (next line's ascenders, a box border) is replaced by paper
    colour in a working copy before inpainting so the fill cannot smear it into the erased area.
    Returns the box that may have changed."""
    import cv2
    x0, y0, x1, y1 = box
    vext = int(round((y1 - y0) * ext))
    X0, Y0 = max(x0 - ERASE_PAD, 0), max(y0 - vext - ERASE_PAD, 0)
    X1, Y1 = min(x1 + ERASE_PAD, img.width), min(y1 + vext + ERASE_PAD, img.height)
    region = img.crop((X0, Y0, X1, Y1))
    arr = np.asarray(region).copy()
    m = ink_mask(region)
    paper = np.median(arr[~m].reshape(-1, 3), axis=0) if (~m).any() else np.array([255, 255, 255])
    n, labels = cv2.connectedComponents(m.astype(np.uint8), connectivity=8)
    seed = np.zeros_like(m); seed[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
    keep_ids = np.unique(labels[m & seed])
    target = np.isin(labels, keep_ids) & m
    # target ink may not spread sideways past the box (touching neighbour letters stay put)
    lane = np.zeros_like(m); lane[:, max(x0 - X0 - halo, 0):x1 - X0 + halo] = True
    target &= lane
    kernel = np.ones((2 * halo + 1, 2 * halo + 1), np.uint8)
    mask8 = cv2.dilate(target.astype(np.uint8) * 255, kernel)
    mask8[~lane] = 0
    other = m & ~target
    sel = mask8 > 0
    donor = _find_paper_donor(img, box, m.shape, (X0, Y0)) if ALLOW_DONOR else None
    if donor is not None:
        dx0, dy0 = donor
        dpatch = img.crop((dx0, dy0, dx0 + (X1 - X0), dy0 + (Y1 - Y0)))
        dmask0 = ink_mask(dpatch)
        d_med = np.median(np.asarray(dpatch)[~dmask0].reshape(-1, 3), axis=0) if (~dmask0).any() else None
        l_med = np.median(arr[~m].reshape(-1, 3), axis=0) if (~m).any() else None
        if d_med is None or l_med is None or np.abs(d_med - l_med).max() > 18:
            donor = None                              # different surface (plaque/banner vs paper): inpaint instead
    if donor is not None:
        # clone-stamp: real paper texture from elsewhere in the text box, feathered at the edges
        dx0, dy0 = donor
        patch = np.asarray(img.crop((dx0, dy0, dx0 + (X1 - X0), dy0 + (Y1 - Y0)))).astype(np.float32)
        # match the donor's tone to the local paper tone (parchment varies slowly across the sheet)
        local = arr[~m].reshape(-1, 3).astype(np.float32); dmask = ink_mask(img.crop((dx0, dy0, dx0 + (X1 - X0), dy0 + (Y1 - Y0))))
        if (~dmask).sum() > 16 and local.shape[0] > 16:
            patch += (np.median(local, axis=0) - np.median(patch[~dmask].reshape(-1, 3), axis=0))
        alpha = cv2.GaussianBlur(sel.astype(np.float32), (5, 5), 0)[..., None]
        alpha = np.where(sel[..., None], np.maximum(alpha, 0.85), alpha)     # solid inside, feathered outside
        alpha[other] = 0.0                                                    # never paint over neighbouring ink/borders
        out = alpha * patch + (1 - alpha) * arr.astype(np.float32)
        arr = np.clip(out, 0, 255).astype(np.uint8)
        img.paste(Image.fromarray(arr), (X0, Y0))
        return (X0, Y0, X1, Y1)                      # feathering touches pixels beyond sel: report the window
    else:
        work = arr.copy(); work[other] = paper.astype(np.uint8)
        out = cv2.inpaint(cv2.cvtColor(work, cv2.COLOR_RGB2BGR), mask8, 3, cv2.INPAINT_TELEA)
        out = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
        out = _regrain(out, arr, m, sel)
        arr[sel] = out[sel]
        img.paste(Image.fromarray(arr), (X0, Y0))
    ys, xs = np.nonzero(sel)
    if ys.size == 0:
        return (X0, Y0, X1, Y1)
    return (X0 + int(xs.min()), Y0 + int(ys.min()), X0 + int(xs.max()) + 1, Y0 + int(ys.max()) + 1)

def draw_on_baseline(img: Image.Image, text: str, x: int, baseline: int, font, color) -> BBox:
    ascent, _ = font.getmetrics()
    d = ImageDraw.Draw(img)
    d.text((x, baseline - ascent), text, font=font, fill=color)
    l, t, r, b = d.textbbox((x, baseline - ascent), text, font=font)
    return (l, t, r, b)

def retype_word(img: Image.Image, loc: WordLocation, line_text: str, word_index: int,
                new_word: str, font_name: str = "georgiab") -> tuple[Image.Image, BBox]:
    """Returns (new image, box that was changed). Word mode if the new word fits; else line mode."""
    out = img.copy()
    words = line_text.split()
    line_w = loc.line_box[2] - loc.line_box[0]
    size = fit_size_to_width(font_name, line_text, line_w)
    font = load_font(font_name, size)
    new_w = font.getlength(new_word)
    ex0, ey0, ex1, ey1 = loc.erase_box
    fits = new_w <= (ex1 - loc.word_box[0]) + 1
    if fits:
        erased_box = erase(out, loc.erase_box)
        text_box = draw_on_baseline(out, new_word, loc.word_box[0], loc.baseline, font, loc.ink_color)
        changed = (
            min(erased_box[0], text_box[0]),
            min(erased_box[1], text_box[1]),
            max(erased_box[2], text_box[2]),
            max(erased_box[3], text_box[3]),
        )
        return out, changed
    # line mode
    new_line = " ".join(words[:word_index] + [new_word] + words[word_index + 1:])
    size = fit_size_to_width(font_name, new_line, line_w)
    font = load_font(font_name, size)
    lx0, ly0, lx1, ly1 = loc.line_box
    box = (max(lx0 - 2, 0), max(ly0 - 1, 0), min(lx1 + 2, out.width), min(ly1 + 1, out.height))
    erased_box = erase(out, box)
    text_box = draw_on_baseline(out, new_line, lx0, loc.baseline, font, loc.ink_color)
    changed = (
        min(erased_box[0], text_box[0]),
        min(erased_box[1], text_box[1]),
        max(erased_box[2], text_box[2]),
        max(erased_box[3], text_box[3]),
    )
    return out, changed

def outside_unchanged(before: Image.Image, after: Image.Image, boxes: list[BBox]) -> bool:
    a = np.asarray(before).copy(); b = np.asarray(after).copy()
    for x0, y0, x1, y1 in boxes:
        a[y0:y1, x0:x1] = 0; b[y0:y1, x0:x1] = 0
    return bool(np.array_equal(a, b))
