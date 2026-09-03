from __future__ import annotations
import tempfile
from pathlib import Path
from PIL import Image
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as _canvas


def make_print_pdf(png_path: str | Path, pdf_path: str | Path, size_in: tuple[float, float] = (11, 17),
                    dpi: int = 300) -> Path:
    """Build a full-bleed, Fiery-ready print PDF from a poster PNG/JPG.

    Orientation is chosen from the source image's aspect ratio: taller than wide -> portrait,
    otherwise landscape. `size_in` gives the two poster dimensions (either order); the shorter one
    becomes the portrait width / landscape height, the longer one the portrait height / landscape
    width. The image is upscaled (never downscaled-then-stretched oddly; LANCZOS handles both
    directions) to exactly size_in * dpi pixels with no preserved aspect ratio (full bleed), saved
    as a temporary high-quality JPEG, and dropped into a single-page PDF at the physical page size.
    """
    png_path = Path(png_path)
    pdf_path = Path(pdf_path)
    img = Image.open(png_path)
    if img.mode != "RGB":
        img = img.convert("RGB")

    portrait = img.height > img.width
    short_in, long_in = min(size_in), max(size_in)
    w_in, h_in = (short_in, long_in) if portrait else (long_in, short_in)

    px_w = int(round(w_in * dpi))
    px_h = int(round(h_in * dpi))
    upscaled = img.resize((px_w, px_h), Image.LANCZOS)

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp_path = Path(tmp_fd.name)
    tmp_fd.close()
    try:
        upscaled.save(tmp_path, "JPEG", quality=95)
        c = _canvas.Canvas(str(pdf_path), pagesize=(w_in * inch, h_in * inch))
        c.drawImage(str(tmp_path), 0, 0, w_in * inch, h_in * inch)
        c.showPage()
        c.save()
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass
    return pdf_path


PRINT_SIZES = {"8.5x11": (8.5, 11.0), "11x17": (11.0, 17.0)}
MAX_STRETCH_PCT = 2.0      # beyond this the full-bleed PDF would visibly distort the art
MIN_PRINT_DPI = 150        # below this the upscale will look soft in print

def detect_print_size(width_px: int, height_px: int) -> dict:
    """Which JBG print size the poster's proportions match (8.5x11 or 11x17, either orientation),
    how much a full-bleed print would stretch it, and the effective DPI at that size."""
    if width_px <= 0 or height_px <= 0:
        return {"ok": False, "note": "empty image"}
    portrait = height_px >= width_px
    aspect = max(width_px, height_px) / min(width_px, height_px)
    best = None
    for name, (short_in, long_in) in PRINT_SIZES.items():
        target = long_in / short_in
        stretch = abs(aspect / target - 1.0) * 100.0
        if best is None or stretch < best["stretch_pct"]:
            best = {"size": name, "short_in": short_in, "long_in": long_in, "stretch_pct": round(stretch, 2)}
    dpi = round(min(width_px, height_px) / best["short_in"])
    ok = best["stretch_pct"] <= MAX_STRETCH_PCT
    notes = []
    if not ok:
        notes.append(f"proportions are {aspect:.3f}:1, {best['size']} needs {best['long_in']/best['short_in']:.3f}:1 - "
                     f"a full-bleed print would stretch the art by {best['stretch_pct']:.1f}%")
    if dpi < MIN_PRINT_DPI:
        notes.append(f"only {dpi} dpi at {best['size']} - expect softness; upscale the art before printing")
    return {"ok": ok, "size": best["size"], "orientation": "portrait" if portrait else "landscape",
            "stretch_pct": best["stretch_pct"], "dpi": dpi, "size_in": (best["short_in"], best["long_in"]),
            "note": "; ".join(notes) if notes else f"fits {best['size']} {'portrait' if portrait else 'landscape'} at {dpi} dpi"}
