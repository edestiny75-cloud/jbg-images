"""Skewed apply_fix / warp-back tests (MISSSSIPPI-style river labels)."""
from PIL import Image, ImageDraw, ImageFont
import numpy as np

from poster_qc.locate import (
    locate_word,
    set_polarity,
    deskew_image,
    paper_fill_color,
    map_box_affine,
)
from poster_qc.pipeline import (
    _upright_loc,
    _clamp_uloc_to_line_band,
    _restore_outside_line_band,
    _warp_edit_onto_sub,
    _apply_fix_skewed,
)
from poster_qc.models import Finding
from poster_qc.glyphclone import GlyphLibrary, clone_fix, CELL_EXT


FONT = r"C:\Windows\Fonts\georgiab.ttf"
PARCHMENT = (210, 190, 155)
INK = (55, 40, 30)
RIVER = (40, 90, 170)


def _rotated_label_with_river(text: str = "MISSSSIPPI RIVER", angle: float = -60.0, size: int = 28):
    """Parchment sheet with a rotated dark label and a parallel blue river underneath."""
    f = ImageFont.truetype(FONT, size)
    pad = 20
    tw = int(f.getlength(text)) + 2 * pad
    asc, desc = f.getmetrics()
    th = asc + desc + 2 * pad + 18
    line = Image.new("RGB", (tw, th), PARCHMENT)
    rng = np.random.default_rng(1)
    a = np.asarray(line).astype(np.float32) + rng.normal(0, 2.0, (th, tw, 3))
    line = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(line)
    d.text((pad, pad), text, font=f, fill=INK)
    # river band just below the baseline
    ry = pad + asc + 6
    d.rectangle((pad, ry, tw - pad, ry + 7), fill=RIVER)
    rot = line.rotate(angle, expand=True, fillcolor=PARCHMENT, resample=Image.BICUBIC)
    sheet = Image.new("RGB", (rot.width + 50, rot.height + 80), PARCHMENT)
    sheet.paste(rot, (25, 40))
    region = (25, 40, 25 + rot.width, 40 + rot.height)
    return sheet, region, angle


def test_warp_edit_mask_is_not_huge_aabb():
    """Warped erase mask must stay near the text parallelogram, not fill the skew AABB."""
    sheet, region, angle = _rotated_label_with_river()
    set_polarity("dark")
    loc = locate_word(sheet, region, "MISSSSIPPI RIVER", 0)
    assert loc.skew_angle != 0
    sub = sheet.crop(loc.skew_region)
    fill = paper_fill_color(sub)
    rot, M, Minv = deskew_image(sub, loc.skew_angle, fill=fill)
    uloc = _clamp_uloc_to_line_band(_upright_loc(loc))
    # Simulate an edit: paint a bright rectangle over the upright word.
    out_rot = rot.copy()
    ImageDraw.Draw(out_rot).rectangle(uloc.word_box, fill=(255, 0, 0))
    composed, mask = _warp_edit_onto_sub(sub, rot, out_rot, Minv, uloc.erase_box, dilate=2)
    # Old AABB fill would cover most of a steep crop; warped mask should stay modest.
    assert float(mask.mean()) < 0.45, mask.mean()
    # Mapped erase AABB is typically huge — confirm we did NOT use that as the mask.
    ex = map_box_affine(uloc.erase_box, Minv)
    aabb = np.zeros(mask.shape, dtype=bool)
    x0, y0 = max(ex[0], 0), max(ex[1], 0)
    x1, y1 = min(ex[2], sub.width), min(ex[3], sub.height)
    aabb[y0:y1, x0:x1] = True
    assert float(mask.mean()) < float(aabb.mean()) * 0.85 or float(aabb.mean()) > 0.5
    assert composed.size == sub.size


def test_restore_outside_line_band_keeps_river():
    sheet, region, angle = _rotated_label_with_river()
    set_polarity("dark")
    loc = locate_word(sheet, region, "MISSSSIPPI RIVER", 0)
    sub = sheet.crop(loc.skew_region)
    rot, _, _ = deskew_image(sub, loc.skew_angle, fill=paper_fill_color(sub))
    uloc = _upright_loc(loc)
    damaged = rot.copy()
    # Wipe everything below the line (would destroy river after a bad erase).
    ImageDraw.Draw(damaged).rectangle((0, uloc.line_box[3] + 1, rot.width, rot.height), fill=(255, 0, 255))
    fixed = _restore_outside_line_band(damaged, rot, uloc.line_box, pad=2)
    below = np.asarray(fixed)[uloc.line_box[3] + 4 :]
    orig_below = np.asarray(rot)[uloc.line_box[3] + 4 :]
    assert below.shape == orig_below.shape
    assert np.allclose(below, orig_below)


def test_clamp_uloc_shrinks_tall_erase():
    from poster_qc.locate import WordLocation
    uloc = WordLocation(
        word_box=(10, 50, 200, 80),
        erase_box=(8, 20, 220, 140),  # spills far above/below the line
        line_box=(10, 50, 260, 80),
        baseline=70,
        ink_color=(40, 40, 40),
        words=[(10, 50, 200, 80), (210, 50, 260, 80)],
    )
    c = _clamp_uloc_to_line_band(uloc, pad=3)
    assert c.erase_box[1] >= 47 and c.erase_box[3] <= 83
    assert c.word_box[1] >= 47 and c.word_box[3] <= 83


def test_apply_fix_skewed_glyphclone_inserts_i_and_preserves_river():
    """End-to-end skewed glyphclone: MISSSSIPPI -> MISSISSIPPI without blanking the river band."""
    sheet, region, _ = _rotated_label_with_river(angle=-58)
    set_polarity("dark")
    loc = locate_word(sheet, region, "MISSSSIPPI RIVER", 0)
    assert abs(loc.skew_angle) >= 12
    f = Finding(
        id="t", box_name="map", line_text="MISSSSIPPI RIVER", wrong="MISSSSIPPI", right="MISSISSIPPI",
        word_index=0, font_style="stylized", kind="spelling", confidence=0.95,
        bbox=list(region), text_color="dark",
    )
    sub0 = np.asarray(sheet.crop(loc.skew_region))

    out, box, prompt = _apply_fix_skewed(
        sheet, f, loc, "glyphclone", openai_client=None, client=None, model="x",
        expected_line="MISSISSIPPI RIVER",
    )
    assert "skew@" in prompt and ("glyphclone" in prompt or "surgical" in prompt)
    assert CELL_EXT == 0.6  # restored after apply
    sub1 = np.asarray(out.crop(loc.skew_region))
    # Change box should be finite and inside the poster.
    assert box[2] > box[0] and box[3] > box[1]
    # Upright clone path should have altered some pixels in the skew crop.
    delta = np.abs(sub1.astype(int) - sub0.astype(int)).max(axis=2)
    assert float((delta > 10).mean()) > 0.005
    # Warped-mask compose must not rewrite most of the crop (AABB fill did on steep angles).
    assert float((delta > 6).mean()) < 0.50, float((delta > 6).mean())


def test_skew_words_list_no_duplicate_target():
    """A near-duplicate of word_box in upright_words must not collapse clone slack to ~0."""
    from poster_qc.locate import WordLocation
    from poster_qc.pipeline import _clamp_uloc_to_line_band, _upright_loc
    # Simulate cand0: word_box y differs slightly from words[0]
    loc = WordLocation(
        word_box=(100, 100, 200, 200),
        erase_box=(98, 100, 202, 200),
        line_box=(100, 100, 300, 200),
        baseline=180,
        ink_color=(40, 40, 40),
        words=[(100, 100, 200, 200)],
        skew_angle=-57.0,
        skew_region=(0, 0, 400, 400),
        upright_word_box=(47, 174, 284, 210),
        upright_erase_box=(43, 142, 286, 210),
        upright_line_box=(47, 142, 424, 210),
        upright_words=[(47, 142, 284, 210), (288, 142, 424, 210)],
        upright_baseline=200,
    )
    # Inline the same normalization _apply_fix_skewed uses
    uloc = _clamp_uloc_to_line_band(_upright_loc(loc))
    wb = uloc.word_box
    trailers = []
    for w in (uloc.words or []):
        if (w[2] - w[0]) < 12:
            continue
        if abs(w[0] - wb[0]) <= 2 and abs(w[2] - wb[2]) <= 2:
            continue
        trailers.append(w)
    words = [wb] + trailers
    assert words[0] == wb
    assert len(words) == 2
    assert words[1][0] > wb[2] - 5  # RIVER starts after MISSSSIPPI


def test_backends_for_steep_skew_escalates_stylized():
    from poster_qc.pipeline import _backends_for_finding
    assert _backends_for_finding("stylized", -64) == ["higgsfield"]
    assert _backends_for_finding("stylized", 50) == ["higgsfield"]
    mild = _backends_for_finding("stylized", -30)
    assert mild[0] == "glyphclone" and "inpaint_openai" not in mild
    plain = _backends_for_finding("plain", -64)
    assert plain[0] == "glyphclone"
