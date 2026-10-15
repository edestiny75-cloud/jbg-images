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


def _framed_nameplate_on_parchment():
    """Civics-style dark ribbon cell with gold frame sitting on parchment — Claude boxes are loose."""
    from PIL import Image, ImageDraw, ImageFont
    import numpy as np
    f = ImageFont.truetype(r"C:\\Windows\\Fonts\\georgiab.ttf", 26)
    sheet = Image.new("RGB", (700, 400), (230, 216, 192))
    rng = np.random.default_rng(1)
    a = np.asarray(sheet).astype(np.float32) + rng.normal(0, 3, (400, 700, 3))
    sheet = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    px0, py0, px1, py1 = 120, 140, 580, 230
    d = ImageDraw.Draw(sheet)
    d.rectangle((px0, py0, px1, py1), fill=(88, 24, 30))
    d.rectangle((px0 + 2, py0 + 2, px1 - 2, py1 - 2), outline=(205, 168, 85), width=5)
    d.text((px0 + 30, py0 + 28), "PRIVACT AND CONSUMERS", font=f, fill=(250, 245, 230))
    loose = (80, 100, 620, 270)
    return sheet, loose, (px0, py0, px1, py1)


def test_infer_polarity_framed_nameplate_on_parchment():
    from poster_qc.locate import infer_polarity, resolve_polarity
    sheet, loose, _ = _framed_nameplate_on_parchment()
    crop = sheet.crop(loose)
    assert infer_polarity(crop) == "light"
    # Claude often leaves text_color at the dark default — pixels must win
    assert resolve_polarity(crop, "dark") == "light"
    assert resolve_polarity(crop, "light") == "light"


def test_resolved_light_ink_mask_on_nameplate():
    """Pipeline path: resolve polarity -> set light -> tighten -> ink_mask sees cream strokes."""
    from poster_qc.locate import ink_mask, set_polarity, text_lines, tighten_region, resolve_polarity
    sheet, loose, plate = _framed_nameplate_on_parchment()
    pol = resolve_polarity(sheet.crop(loose), "dark")
    assert pol == "light"
    set_polarity(pol)
    try:
        region = tighten_region(sheet, loose, pol)
        m = ink_mask(sheet.crop(region))
        lines = text_lines(m)
        assert lines, "expected a text line on the plate"
        y0, y1 = lines[0]
        assert (y1 - y0) < 0.5 * (region[3] - region[1])   # line, not whole plaque
        assert 0.01 < m.mean() < 0.35
    finally:
        set_polarity("auto")


def test_tighten_region_shrinks_to_dark_plate():
    from poster_qc.locate import tighten_region
    sheet, loose, plate = _framed_nameplate_on_parchment()
    tight = tighten_region(sheet, loose, "light")
    # tightened box should sit near the plate, not the full parchment pad
    assert tight[0] >= loose[0] and tight[2] <= loose[2]
    assert (tight[2] - tight[0]) < (loose[2] - loose[0]) - 20
    assert tight[0] <= plate[0] + 10 and tight[2] >= plate[2] - 10


def test_locate_light_nameplate_despite_dark_hint_context():
    """With polarity resolved to light, locate returns cream ink and a tight word box."""
    from poster_qc.locate import locate_word, set_polarity, tighten_region
    sheet, loose, _ = _framed_nameplate_on_parchment()
    set_polarity("light")
    try:
        region = tighten_region(sheet, loose, "light")
        loc = locate_word(sheet, region, "PRIVACT AND CONSUMERS", 0)
        assert loc.ink_color[0] > 200                     # cream lettering, not the plate
        assert (loc.word_box[2] - loc.word_box[0]) < 200  # PRIVACT, not the whole plate
        assert len(loc.words) == 3
    finally:
        set_polarity("auto")
