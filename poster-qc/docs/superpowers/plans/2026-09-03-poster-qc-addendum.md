# Poster QC — Plan Addendum (look-the-same requirement)

Applies on top of `2026-09-03-poster-qc.md`. Sam's requirement: a fixed word must be indistinguishable from
its neighbours (same font, weight, size, colour, parchment texture; no flat patch, no ghost strokes, no
whole-line re-size). Three changes:

1. **Texture-aware erase** (OpenCV inpaint) replaces the flat median fill. `opencv-python-headless` is installed.
2. **Glyph-clone backend**, tried before `retype`: build the corrected word from letter pixels already on the
   poster (same word → same line → same text box). If the corrected word is wider than its slot, shift the
   rest of the line right into the ragged-right slack instead of re-sizing the line.
3. Locator picks, among lines with the right word count, the one nearest the region's vertical centre.

---

### Task 6b: Texture-aware erase

**Files:** Modify `poster_qc/retype.py` (replace `erase`, adjust `retype_word` changed box); Test: add to `tests/poster_qc/test_retype.py`

- [ ] **Step 1: Failing test** (append to `tests/poster_qc/test_retype.py`)

```python
def test_erase_keeps_texture_not_flat():
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    from poster_qc.retype import erase
    rng = np.random.default_rng(0)
    arr = np.clip(rng.normal(225, 6, (80, 200, 3)), 0, 255).astype(np.uint8)   # grainy parchment
    img = Image.fromarray(arr)
    ImageDraw.Draw(img).text((40, 20), "Everest,", font=ImageFont.truetype(r"C:\Windows\Fonts\georgiab.ttf", 24), fill=(50, 30, 20))
    erase(img, (36, 14, 150, 60))
    patch = np.asarray(img)[14:60, 36:150]
    assert patch.std() > 2.0                 # not a flat fill
    assert patch.mean() > 200                # ink is gone
```

- [ ] **Step 2: Run, expect failure (flat fill has std ≈ 0).**

- [ ] **Step 3: Implement** — replace `erase` in `poster_qc/retype.py`:

```python
ERASE_PAD = 6

def erase(img: Image.Image, box: BBox, halo: int = 2) -> BBox:
    """Remove ink inside `box`, keeping background texture. OpenCV inpaint over the dilated ink mask;
    fallback = median colour + matched noise. Returns the padded box that may have changed."""
    x0, y0, x1, y1 = box
    X0, Y0 = max(x0 - ERASE_PAD, 0), max(y0 - ERASE_PAD, 0)
    X1, Y1 = min(x1 + ERASE_PAD, img.width), min(y1 + ERASE_PAD, img.height)
    region = img.crop((X0, Y0, X1, Y1))
    arr = np.asarray(region).copy()
    inner = np.zeros(arr.shape[:2], dtype=bool); inner[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
    m = ink_mask(region) & inner
    try:
        import cv2
        kernel = np.ones((2 * halo + 1, 2 * halo + 1), np.uint8)
        mask8 = cv2.dilate(m.astype(np.uint8) * 255, kernel)
        mask8[~inner] = 0
        out = cv2.inpaint(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), mask8, 3, cv2.INPAINT_TELEA)
        arr = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
    except ImportError:
        bg = arr[~m & inner]
        med = np.median(bg, axis=0); std = bg.std(axis=0) if len(bg) > 10 else np.zeros(3)
        rng = np.random.default_rng(0)
        fill = np.clip(med + rng.normal(0, 1, arr.shape) * std, 0, 255)
        dil = m.copy()
        for _ in range(halo):
            dil[1:] |= dil[:-1]; dil[:-1] |= dil[1:]; dil[:, 1:] |= dil[:, :-1]; dil[:, :-1] |= dil[:, 1:]
        sel = dil & inner
        arr[sel] = fill[sel].astype(np.uint8)
    img.paste(Image.fromarray(arr), (X0, Y0))
    return (X0, Y0, X1, Y1)
```

In `retype_word`, `erase(...)` now returns a padded box; include it in the `changed` union in both word mode and line mode (`changed = union(erased_box, text_box)`).

- [ ] **Step 4: Run suite, expect pass.**

---

### Task 6c: Glyph-clone backend

**Files:** Create `poster_qc/glyphclone.py`; Test `tests/poster_qc/test_glyphclone.py`

Idea: the wrong word's text and pixel box are known. Slice the word into one cell per character; compute
edit ops wrong→right with `difflib.SequenceMatcher`; keep unchanged cells; for inserted/replaced characters
copy a cell of that character from the same word, else the same line, else any line in the same text box.
Reassemble left-to-right with the word's original inter-glyph spacing on the same baseline. If the result is
wider than the slot, shift everything to the right of the word on that line rightwards by the overflow, but
only if that many ink-free pixels exist between the line's last glyph and the text box's right edge. If a
needed character is unavailable, raise `NoGlyph`; the pipeline falls through to `retype`.

- [ ] **Step 1: Failing test**

```python
# tests/poster_qc/test_glyphclone.py
import pytest
from tests.poster_qc.synth import line_image
from poster_qc.locate import locate_word, ink_mask, text_lines, split_words
from poster_qc.retype import outside_unchanged
from poster_qc.glyphclone import segment_chars, clone_fix, NoGlyph, GlyphLibrary

def test_segment_chars_count_matches_text():
    img, f, _ = line_image("Pennsylvaia,")
    loc = locate_word(img, (0, 0, img.width, img.height), "Pennsylvaia,", 0)
    cells = segment_chars(img, loc.line_box, loc.word_box, "Pennsylvaia,")
    assert [c.char for c in cells] == list("Pennsylvaia,")
    assert all(cells[i].box[2] <= cells[i + 1].box[0] + 1 for i in range(len(cells) - 1))

def test_clone_insert_n_widens_word_and_keeps_outside():
    img, f, _ = line_image("Gettysburg, Pennsylvaia,")
    before = img.copy()
    loc = locate_word(img, (0, 0, img.width, img.height), "Gettysburg, Pennsylvaia,", 1)
    lib = GlyphLibrary.from_lines(img, [("Gettysburg, Pennsylvaia,", loc.line_box, loc.words)])
    out, box = clone_fix(img, loc, "Pennsylvaia,", "Pennsylvania,", lib, box_right=img.width)
    m = ink_mask(out); (y0, y1), = text_lines(m)
    words = split_words(m, y0, y1, 2)
    old_w = loc.word_box[2] - loc.word_box[0]; new_w = words[1][1] - words[1][0]
    assert new_w > old_w + 4                      # one more letter
    assert outside_unchanged(before, out, [box])

def test_clone_shifts_tail_when_word_grows_midline():
    img, f, _ = line_image("Gettysburg, Pennsylvaia, to dedicate", pad=80)   # wide right margin = slack
    before = img.copy()
    loc = locate_word(img, (0, 0, img.width, img.height), "Gettysburg, Pennsylvaia, to dedicate", 1)
    lib = GlyphLibrary.from_lines(img, [("Gettysburg, Pennsylvaia, to dedicate", loc.line_box, loc.words)])
    out, box = clone_fix(img, loc, "Pennsylvaia,", "Pennsylvania,", lib, box_right=img.width)
    m = ink_mask(out); (y0, y1), = text_lines(m)
    words = split_words(m, y0, y1, 4)
    assert len(words) == 4 and words[2][0] > loc.words[2][0]     # "to" moved right
    assert outside_unchanged(before, out, [box])

def test_clone_raises_when_glyph_missing():
    img, f, _ = line_image("Busk")
    loc = locate_word(img, (0, 0, img.width, img.height), "Busk", 0)
    lib = GlyphLibrary.from_lines(img, [("Busk", loc.line_box, loc.words)])
    with pytest.raises(NoGlyph):
        clone_fix(img, loc, "Busk", "Bush", lib, box_right=img.width)     # no 'h' anywhere
```

- [ ] **Step 2: Run, expect ImportError.**

- [ ] **Step 3: Implement**

```python
# poster_qc/glyphclone.py
from __future__ import annotations
from dataclasses import dataclass, field
from difflib import SequenceMatcher
import numpy as np
from PIL import Image
from .locate import ink_mask, runs, WordLocation
from .fonts import load_font, fit_size_to_width
from .models import BBox

class NoGlyph(Exception):
    pass

@dataclass
class Cell:
    char: str
    box: BBox            # tight ink box, full-image coords
    baseline: int        # full-image y of the baseline of the line this cell sits on

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

    def get(self, ch: str, prefer: list[Cell] | None = None) -> Cell:
        for c in (prefer or []):
            if c.char == ch: return c
        if self.cells.get(ch): return self.cells[ch][0]
        raise NoGlyph(ch)

def _baseline(mask: np.ndarray) -> int:
    band = mask.sum(axis=1)
    if band.max() == 0: return mask.shape[0]
    rows = np.flatnonzero(band >= 0.25 * band.max())
    return int(rows[-1]) + 1

def segment_chars(img: Image.Image, line_box: BBox, word_box: BBox, text: str, font_name: str = "georgiab") -> list[Cell]:
    """One Cell per character of `text` inside word_box. Zero-ink column gaps first; when glyphs touch,
    split proportionally by font advances, snapping each cut to the lowest-ink column nearby."""
    lx0, ly0, lx1, ly1 = line_box
    wx0, _, wx1, _ = word_box
    sub = img.crop((wx0, ly0, wx1, ly1))
    mask = ink_mask(sub)
    cols = mask.sum(axis=0)
    glyphs = runs(cols, min_gap=0)
    base = ly0 + _baseline(ink_mask(img.crop((lx0, ly0, lx1, ly1))))
    n = len(text)
    width = wx1 - wx0
    if len(glyphs) == n:
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
    for ch, (a, b) in zip(text, bounds):
        rows = np.flatnonzero(mask[:, a:b].sum(axis=1))
        if rows.size == 0:
            raise ValueError(f"empty cell for {ch!r}")
        cols_c = np.flatnonzero(mask[:, a:b].sum(axis=0))
        cells.append(Cell(ch, (wx0 + a + int(cols_c[0]), ly0 + int(rows[0]), wx0 + a + int(cols_c[-1]) + 1, ly0 + int(rows[-1]) + 1), base))
    return cells

def _paste_ink(dst: Image.Image, src: Image.Image, cell: Cell, x: int, baseline: int) -> BBox:
    """Copy only the ink pixels of `cell` from src to dst at x, keeping dst's background texture."""
    patch = src.crop(cell.box)
    m = ink_mask(patch)
    y = cell.box[1] + (baseline - cell.baseline)
    region = dst.crop((x, y, x + patch.width, y + patch.height))
    arr = np.asarray(region).copy(); parr = np.asarray(patch)
    arr[m] = parr[m]
    dst.paste(Image.fromarray(arr), (x, y))
    return (x, y, x + patch.width, y + patch.height)

def _union(a: BBox, b: BBox) -> BBox:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))

def clone_fix(img: Image.Image, loc: WordLocation, wrong: str, right: str, lib: GlyphLibrary,
              box_right: int) -> tuple[Image.Image, BBox]:
    """box_right: x of the right edge of the text box (full-image). Returns (image, changed box)."""
    from .retype import erase
    src = img.copy()
    out = img.copy()
    own = segment_chars(src, loc.line_box, loc.word_box, wrong)
    gaps = [own[i + 1].box[0] - own[i].box[2] for i in range(len(own) - 1)]
    gap = max(int(np.median(gaps)), 0) if gaps else 1
    plan: list[Cell] = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, wrong, right, autojunk=False).get_opcodes():
        if tag == "equal":
            plan.extend(own[i1:i2])
        elif tag in ("replace", "insert"):
            for ch in right[j1:j2]:
                plan.append(lib.get(ch, prefer=own))
    total = sum(c.box[2] - c.box[0] for c in plan) + gap * (len(plan) - 1)
    wx0 = loc.word_box[0]
    ex0, ey0, ex1, ey1 = loc.erase_box
    overflow = (wx0 + total) - (ex1 if loc.word_box[2] < loc.line_box[2] else loc.line_box[2]) 
    changed = loc.erase_box
    if overflow > 0:
        # shift the tail of the line (everything right of this word) into the ragged-right slack
        tail_x0 = loc.word_box[2] + (gap if loc.word_box[2] < loc.line_box[2] else 0)
        tail = None
        if loc.word_box[2] < loc.line_box[2]:
            tail_box = (loc.word_box[2], loc.line_box[1], loc.line_box[2], loc.line_box[3])
            slack_box = (loc.line_box[2], loc.line_box[1], min(box_right, out.width), loc.line_box[3])
            slack = slack_box[2] - slack_box[0]
            if slack < overflow + 1 or ink_mask(src.crop(slack_box)).any():
                raise NoGlyph(f"corrected word overflows by {overflow}px and the line has no slack")
            tail = src.crop(tail_box)
            erase(out, tail_box)
            out.paste(tail, (tail_box[0] + overflow, tail_box[1]))
            changed = _union(changed, (tail_box[0] - ERASE_PAD_, tail_box[1] - ERASE_PAD_, tail_box[2] + overflow + ERASE_PAD_, tail_box[3] + ERASE_PAD_))
        else:
            slack_box = (loc.line_box[2], loc.line_box[1], min(box_right, out.width), loc.line_box[3])
            if slack_box[2] - slack_box[0] < overflow + 1 or ink_mask(src.crop(slack_box)).any():
                raise NoGlyph(f"corrected word overflows by {overflow}px past the text box")
            changed = _union(changed, (ex0, ey0, ex1 + overflow, ey1))
    erased = erase(out, loc.erase_box)
    changed = _union(changed, erased)
    x = wx0
    for c in plan:
        b = _paste_ink(out, src, c, x, loc.baseline)
        changed = _union(changed, b)
        x = b[2] + gap
    W, H = out.size
    return out, (max(changed[0], 0), max(changed[1], 0), min(changed[2], W), min(changed[3], H))

ERASE_PAD_ = 6
```

Notes for the implementer: `ERASE_PAD_` must equal `retype.ERASE_PAD` (import it instead of redefining once Task 6b is in). If the ink-only paste leaves visibly jagged edges on real posters, paste with a soft alpha instead: alpha = normalized darkness of the patch relative to its local background (`(bg_lum - lum) / (bg_lum - ink_lum)` clipped 0..1) and blend `arr = alpha*parr + (1-alpha)*arr` — this reproduces the original antialiasing.

- [ ] **Step 4: Run suite, expect pass.**

---

### Task 4b: Locator line choice

**Files:** Modify `poster_qc/locate.py` `locate_word`; Test: add to `tests/poster_qc/test_locate.py`

- [ ] **Step 1: Failing test**

```python
def test_locate_prefers_line_nearest_region_centre():
    from PIL import Image
    a, f, _ = line_image("alpha beta gamma delta epsilon zeta eta")   # inkier line, 7 words
    b, _, _ = line_image("one two")                                  # 2 words
    c, _, _ = line_image("three four")                               # 2 words, inkier than b? equal-ish
    W = max(a.width, b.width, c.width); H = a.height + b.height + c.height
    img = Image.new("RGB", (W, H), a.getpixel((0, 0)))
    img.paste(a, (0, 0)); img.paste(b, (0, a.height)); img.paste(c, (0, a.height + b.height))
    # region centred on line b (the middle one)
    region = (0, a.height - 5, W, a.height + b.height + 5)
    loc = locate_word(img, region, "one two", 1)
    assert a.height < loc.line_box[1] < a.height + b.height
```

- [ ] **Step 2: Implement** — in `locate_word`, replace the `score` line with:

```python
        centre = (ry1 - ry0) / 2
        score = (len(words) == n_words, -abs((y0 + y1) / 2 - centre))
```

- [ ] **Step 3: Run suite, expect pass.**

---

### Pipeline changes (apply in Task 11) and config

- `BACKENDS_PLAIN = ["glyphclone", "retype", "inpaint_openai", "higgsfield"]`, `BACKENDS_STYLED = ["inpaint_openai", "glyphclone", "retype", "higgsfield"]`.
- `Finding` gains `box_lines: list[dict] = field(default_factory=list)` — every line in the same text box as `{"text": str, "bbox": [x0,y0,x1,y1] full-image}` — and `box_bbox: BBox | None = None` (the whole text box). Inspector (Task 8) asks for these per finding (`box_lines` with normalized tile bboxes + `box_bbox`), and maps them to full-image coords like `bbox`.
- In `apply_fix`, backend `glyphclone`: for each `box_lines` entry run `locate_word(img, tuple(bbox), text, 0)` to get `line_box` + `words` (skip entries that raise), build `GlyphLibrary.from_lines(img, lines)`, then `clone_fix(img, loc, f.wrong, f.right, lib, box_right=(f.box_bbox or f.bbox)[2])`. `NoGlyph`/`ValueError` → next backend.
- `config.STYLE_GATE_MIN = 90`; `config.OPENAI_IMAGE_MODEL = "gpt-image-2"`; in `inpaint_word`, on an API error whose message mentions the model, retry once with `"gpt-image-1"`.
- `verify_fix` PROMPT: add "The AFTER crop must look like nothing was ever edited: same letterforms, stroke weight, size, colour and background grain as the untouched neighbours. Deduct heavily for any patch that is flatter or smoother than the surrounding paper."
