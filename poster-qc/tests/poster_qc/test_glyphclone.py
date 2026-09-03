import numpy as np
import pytest
from PIL import Image
from tests.poster_qc.synth import line_image
from poster_qc.locate import locate_word, ink_mask, text_lines, split_words
from poster_qc.retype import outside_unchanged
from poster_qc.glyphclone import segment_chars, clone_fix, NoGlyph, GlyphLibrary, _paste_ink

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

def test_paste_ink_blends_soft_alpha():
    img, f, _ = line_image("Pennsylvania,")
    loc = locate_word(img, (0, 0, img.width, img.height), "Pennsylvania,", 0)
    cells = segment_chars(img, loc.line_box, loc.word_box, "Pennsylvania,")
    cell = cells[0]  # 'P'

    dst_bg = (40, 120, 200)   # a background colour unlike the source's parchment
    dst = Image.new("RGB", img.size, dst_bg)
    box = _paste_ink(dst, img, cell, cell.box[0], cell.baseline)
    out = np.asarray(dst)
    x0, y0, x1, y1 = box

    src_patch = np.asarray(img.crop(cell.box)).astype(np.float32)
    lum = src_patch.mean(axis=2)
    m = ink_mask(img.crop(cell.box))
    bg_lum = float(np.median(lum[~m])) if (~m).any() else 255.0
    ink_lum = float(np.median(lum[m])) if m.any() else 0.0

    # the most background-like pixel in the cell (highest luminance = farthest from ink) must come
    # through as dst's own background exactly (alpha ~ 0)
    fy, fx = np.unravel_index(np.argmax(lum), lum.shape)
    far_px = tuple(int(v) for v in out[y0 + fy, x0 + fx])
    assert far_px == dst_bg

    # find an antialiased edge pixel in the source patch: luminance strictly between the ink and
    # background medians used by the blend
    candidates = np.argwhere((lum > ink_lum + 15) & (lum < bg_lum - 15))
    assert candidates.size > 0, "synthetic glyph has no antialiased edge pixels to test"
    ey, ex = candidates[0]
    edge_px = tuple(int(v) for v in out[y0 + ey, x0 + ex])
    raw_px = tuple(int(v) for v in src_patch[ey, ex])
    # neither pure destination background nor a hard (binary) copy of the source pixel
    assert edge_px != dst_bg
    assert edge_px != raw_px


def test_clone_squeezes_when_line_is_flush_against_border():
    from PIL import ImageDraw
    img, f, _ = line_image("Gettysburg, Pennsylvaia,", pad=30)
    # draw a vertical border rule 3px right of the comma, like a poster text box
    m = ink_mask(img); (y0, y1), = text_lines(m)
    words = split_words(m, y0, y1, 2)
    rule_x = words[1][1] + 3
    ImageDraw.Draw(img).rectangle((rule_x, 0, rule_x + 2, img.height), fill=(60, 40, 30))
    before = img.copy()
    loc = locate_word(img, (0, 0, img.width, img.height), "Gettysburg, Pennsylvaia,", 1)
    lib = GlyphLibrary.from_lines(img, [("Gettysburg, Pennsylvaia,", loc.line_box, loc.words)])
    out, box = clone_fix(img, loc, "Pennsylvaia,", "Pennsylvania,", lib, box_right=img.width)
    import numpy as np
    m2 = ink_mask(out); (y0, y1), = text_lines(m2)
    # ink of the rebuilt word: everything right of the first word's end, left of the border
    x_from = loc.words[0][3 - 1] + 1
    cols = np.flatnonzero(m2[y0:y1, x_from:rule_x - 1].sum(axis=0))
    assert cols.size > 0
    w_new = int(cols[-1] - cols[0] + 1)
    assert x_from + cols[-1] <= rule_x - 2                # nothing touches the border
    assert outside_unchanged(before, out, [box])
    assert w_new >= 0.85 * (loc.word_box[2] - loc.word_box[0])


def test_reconcile_wrong_prefers_similar_readback():
    from poster_qc.glyphclone import reconcile_wrong
    img, f, _ = line_image("Everest, spoke")
    loc = locate_word(img, (0, 0, img.width, img.height), "Everest, spoke", 0)
    assert reconcile_wrong(img, loc, "Everet,", "Everest,") == "Everest,"
    assert reconcile_wrong(img, loc, "Everet,", "Lincoln") == "Everet,"       # unrelated read-back ignored
    assert reconcile_wrong(img, loc, "Everet,", None) == "Everet,"


def test_clone_light_text_on_dark_banner():
    from PIL import Image, ImageDraw, ImageFont
    f = ImageFont.truetype(r"C:\Windows\Fonts\georgiab.ttf", 28)
    img = Image.new("RGB", (420, 70), (120, 20, 20))
    ImageDraw.Draw(img).text((20, 18), "PRIVACT AND CONSUMERS", font=f, fill=(250, 245, 230))
    before = img.copy()
    loc = locate_word(img, (0, 0, img.width, img.height), "PRIVACT AND CONSUMERS", 0)
    lib = GlyphLibrary.from_lines(img, [("PRIVACT AND CONSUMERS", loc.line_box, loc.words)])
    # 'Y' is not on this banner: a second line elsewhere provides it
    img2 = Image.new("RGB", (420, 70), (120, 20, 20))
    ImageDraw.Draw(img2).text((20, 18), "LIBERTY", font=f, fill=(250, 245, 230))
    loc2 = locate_word(img2, (0, 0, img2.width, img2.height), "LIBERTY", 0)
    big = Image.new("RGB", (420, 140), (120, 20, 20)); big.paste(img, (0, 0)); big.paste(img2, (0, 70))
    loc = locate_word(big, (0, 0, 420, 70), "PRIVACT AND CONSUMERS", 0)
    loc2 = locate_word(big, (0, 70, 420, 140), "LIBERTY", 0)
    lib = GlyphLibrary.from_lines(big, [("PRIVACT AND CONSUMERS", loc.line_box, loc.words), ("LIBERTY", loc2.line_box, loc2.words)])
    out, box = clone_fix(big, loc, "PRIVACT", "PRIVACY", lib, box_right=big.width)
    m = ink_mask(out.crop((0, 0, 420, 70)))
    assert m.mean() > 0.02                        # lettering still there (light ink preserved)
    assert outside_unchanged(big, out, [box])
