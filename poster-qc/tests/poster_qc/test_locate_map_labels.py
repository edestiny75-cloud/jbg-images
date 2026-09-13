"""Map-label / rotated-text locate tests (MISSSSIPPI-style river labels)."""
from PIL import Image, ImageDraw, ImageFont
import numpy as np

from poster_qc.locate import (
    locate_candidates,
    locate_word,
    set_polarity,
    choose_deskew_angle,
    deskew_image,
    paper_fill_color,
)


FONT = r"C:\Windows\Fonts\georgiab.ttf"
PARCHMENT = (210, 190, 155)
INK = (55, 40, 30)


def _rotated_map_label(text: str = "MISSSSIPPI RIVER", angle: float = -60.0, size: int = 28):
    """Dark serif label on parchment, rotated to mimic a river map label; returns (sheet, region, angle)."""
    f = ImageFont.truetype(FONT, size)
    # Render upright first
    pad = 20
    tw = int(f.getlength(text)) + 2 * pad
    asc, desc = f.getmetrics()
    th = asc + desc + 2 * pad
    line = Image.new("RGB", (tw, th), PARCHMENT)
    # subtle paper noise
    rng = np.random.default_rng(0)
    a = np.asarray(line).astype(np.float32) + rng.normal(0, 2.5, (th, tw, 3))
    line = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    ImageDraw.Draw(line).text((pad, pad), text, font=f, fill=INK)
    # Rotate into a tall sheet like Claude's map-label box
    rot = line.rotate(angle, expand=True, fillcolor=PARCHMENT, resample=Image.BICUBIC)
    # Place on a taller parchment sheet with margins
    sheet = Image.new("RGB", (rot.width + 40, rot.height + 60), PARCHMENT)
    sheet.paste(rot, (20, 30))
    region = (20, 30, 20 + rot.width, 30 + rot.height)
    return sheet, region, angle


def test_choose_deskew_angle_recovers_rotation():
    sheet, region, angle = _rotated_map_label(angle=-60)
    crop = sheet.crop(region)
    set_polarity("dark")
    got = choose_deskew_angle(crop, "MISSSSIPPI RIVER")
    assert got is not None
    # +60 and -60 both make the line horizontal (one upside-down); either is fine.
    assert abs(abs(got) - 60) <= 10, got


def test_locate_rotated_map_label_sets_skew_and_upright():
    sheet, region, _ = _rotated_map_label(angle=-60)
    set_polarity("dark")
    cands = locate_candidates(sheet, region, "MISSSSIPPI RIVER", 0)
    assert cands
    loc = cands[0]
    assert abs(loc.skew_angle) >= 12
    assert loc.skew_region is not None
    assert loc.upright_word_box is not None
    assert loc.upright_line_box is not None
    assert loc.upright_words and len(loc.upright_words) == 2
    # upright word is wide and short (MISSSSIPPI), not a tall blob
    uw = loc.upright_word_box
    assert (uw[2] - uw[0]) > (uw[3] - uw[1])
    assert loc.ink_color[0] < 120  # dark ink


def test_locate_word_rotated_matches_candidates():
    sheet, region, _ = _rotated_map_label(angle=-55)
    set_polarity("dark")
    loc = locate_word(sheet, region, "MISSSSIPPI RIVER", 0)
    assert loc.skew_angle != 0
    assert loc.word_box[2] > loc.word_box[0]


def test_deskew_roundtrip_preserves_size_meta():
    sheet, region, _ = _rotated_map_label(angle=-60)
    crop = sheet.crop(region)
    set_polarity("dark")
    fill = paper_fill_color(crop)
    rot, M, Minv = deskew_image(crop, -60.0, fill=fill)
    assert rot.width >= crop.width or rot.height >= crop.height
    assert M.shape == (2, 3) and Minv.shape == (2, 3)


def test_horizontal_body_text_still_axis_aligned():
    """Wide horizontal body lines must not take the skew path."""
    from tests.poster_qc.synth import line_image
    img, _, _ = line_image("Gettysburg, Pennsylvaia,")
    set_polarity("dark")
    loc = locate_word(img, (0, 0, img.width, img.height), "Gettysburg, Pennsylvaia,", 1)
    assert loc.skew_angle == 0.0
    assert loc.upright_word_box is None
