from __future__ import annotations
from pathlib import Path
from PIL import ImageFont

FONT_DIR = Path(r"C:\Windows\Fonts")
FONT_CANDIDATES: dict[str, str] = {
    "georgiab": "georgiab.ttf",   # JBG civics body copy (bold serif) — default for plain
    "georgia": "georgia.ttf",
    "cambriab": "cambriab.ttf",
    "bookosb": "BOOKOSB.TTF",
    "bookos": "BOOKOS.TTF",
    "timesbd": "timesbd.ttf",
    "times": "times.ttf",
    "gothicb": "GOTHICB.TTF",     # sans fallback
    "oldengl": "OLDENGL.TTF",     # blackletter
}

def font_path(name: str) -> Path:
    return FONT_DIR / FONT_CANDIDATES.get(name, name)

def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(font_path(name)), size)

def fit_size_to_width(name: str, text: str, target_width: float, lo: int = 6, hi: int = 200) -> int:
    """Largest integer size whose rendered width of `text` does not exceed target_width (closest fit)."""
    best, best_err = lo, float("inf")
    while lo <= hi:
        mid = (lo + hi) // 2
        w = load_font(name, mid).getlength(text)
        err = abs(w - target_width)
        if err < best_err: best, best_err = mid, err
        if w < target_width: lo = mid + 1
        elif w > target_width: hi = mid - 1
        else: return mid
    return best
