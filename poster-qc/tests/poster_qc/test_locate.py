import numpy as np
from tests.poster_qc.synth import line_image
from poster_qc.locate import ink_mask, text_lines, split_words, locate_word

def test_ink_mask_finds_dark_text():
    img, _, _ = line_image("Hello")
    m = ink_mask(img)
    assert 0.01 < m.mean() < 0.5

def test_text_lines_one_band():
    img, f, (x0, base) = line_image("Gettysburg, Pennsylvaia,")
    m = ink_mask(img)
    lines = text_lines(m)
    assert len(lines) == 1 and lines[0][0] < base < lines[0][1]

def test_split_words_by_count():
    img, _, _ = line_image("Gettysburg, Pennsylvaia, to dedicate")
    m = ink_mask(img); (y0, y1), = text_lines(m)
    words = split_words(m, y0, y1, n_words=4)
    assert len(words) == 4 and all(words[i][1] < words[i+1][0] for i in range(3))

def test_locate_word_box_contains_ink_and_baseline():
    img, f, (x0, base) = line_image("Gettysburg, Pennsylvaia,")
    loc = locate_word(img, (0, 0, img.width, img.height), line_text="Gettysburg, Pennsylvaia,", word_index=1)
    wx0, wy0, wx1, wy1 = loc.word_box
    assert wx0 > x0 + f.getlength("Gettysburg,") - 2
    assert abs(loc.baseline - base) <= 2
    assert loc.ink_color[0] < 120

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


def test_locate_candidates_first_is_locate_word():
    from poster_qc.locate import locate_candidates
    img, f, _ = line_image("Gettysburg, Pennsylvaia,")
    cands = locate_candidates(img, (0, 0, img.width, img.height), "Gettysburg, Pennsylvaia,", 1)
    assert 1 <= len(cands) <= 3
    assert cands[0].word_box == locate_word(img, (0, 0, img.width, img.height), "Gettysburg, Pennsylvaia,", 1).word_box


def test_ink_mask_light_on_dark():
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (220, 60), (120, 20, 20))
    ImageDraw.Draw(img).text((20, 15), "PRIVACY", font=ImageFont.truetype(r"C:\Windows\Fonts\georgiab.ttf", 28), fill=(255, 255, 255))
    m = ink_mask(img)
    assert 0.02 < m.mean() < 0.4                 # lettering is the minority
    assert m[30, 25:60].any()                    # and it is where the letters are


def test_polarity_context():
    from PIL import Image, ImageDraw, ImageFont
    from poster_qc import locate
    img = Image.new("RGB", (220, 60), (120, 20, 20))
    ImageDraw.Draw(img).text((20, 15), "PRIVACY", font=ImageFont.truetype(r"C:\Windows\Fonts\georgiab.ttf", 28), fill=(255, 255, 255))
    try:
        locate.set_polarity("light"); assert ink_mask(img).mean() < 0.4
        locate.set_polarity("dark");  assert ink_mask(img).mean() > 0.6      # wrong polarity picks the plate
    finally:
        locate.set_polarity("auto")
