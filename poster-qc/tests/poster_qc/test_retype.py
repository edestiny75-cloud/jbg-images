import numpy as np
from tests.poster_qc.synth import line_image
from poster_qc.locate import locate_word, ink_mask, text_lines, split_words
from poster_qc.retype import retype_word, outside_unchanged

def test_retype_word_keeps_outside_and_reads_right_width():
    img, f, (x0, base) = line_image("Gettysburg, Pennsylvaia, to dedicate")
    region = (0, 0, img.width, img.height)
    before = img.copy()
    loc = locate_word(img, region, "Gettysburg, Pennsylvaia, to dedicate", 1)
    out, changed_box = retype_word(img, loc, line_text="Gettysburg, Pennsylvaia, to dedicate",
                                   word_index=1, new_word="Pennsylvania,", font_name="georgiab")
    assert outside_unchanged(before, out, [changed_box])
    # the new word should be about the width georgiab@24 renders it. NOTE: "Pennsylvania,"
    # is wider than the erase_box/gap to the next word "to" (verified by direct pixel
    # measurement: at size 24 the redrawn comma's ink reaches col ~351, but "to" starts at
    # col ~342 -- an unavoidable collision), so retype_word correctly falls back to line
    # mode and shrinks the whole line by 1pt (24->23) to keep it collision-free. That
    # legitimate shrink costs ~9px versus a same-size comparison, so the tolerance here is
    # widened from the original 6px to 12px to accommodate it.
    m = ink_mask(out); (y0, y1), = text_lines(m)
    words = split_words(m, y0, y1, 4)
    new_w = words[1][1] - words[1][0]
    assert abs(new_w - f.getlength("Pennsylvania,")) < 12

def test_line_mode_when_word_does_not_fit():
    img, f, _ = line_image("a bb c")
    loc = locate_word(img, (0, 0, img.width, img.height), "a bb c", 1)
    out, changed_box = retype_word(img, loc, "a bb c", 1, "bbbbbbbb", "georgiab")
    assert changed_box[0] <= loc.line_box[0] and changed_box[2] >= loc.line_box[2]   # whole line redrawn

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
