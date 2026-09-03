from __future__ import annotations
from dataclasses import dataclass
from PIL import Image
from .models import BBox

@dataclass
class Tile:
    index: int
    box: BBox
    image: Image.Image

def grid_tiles(img: Image.Image, tile: int = 900, overlap: int = 120) -> list[Tile]:
    W, H = img.size
    # big posters: grow the tile so the grid stays around 3x4 (each tile is resized to <=1568px for
    # the API anyway, so more tiles only add request size, not legibility)
    tile = max(tile, -(-max(W, H) // 4))
    step = tile - overlap
    xs = list(range(0, max(W - tile, 0) + 1, step)) or [0]
    ys = list(range(0, max(H - tile, 0) + 1, step)) or [0]
    if xs[-1] + tile < W: xs.append(W - tile)
    if ys[-1] + tile < H: ys.append(H - tile)
    tiles, i = [], 0
    for y in ys:
        for x in xs:
            box = (max(x, 0), max(y, 0), min(x + tile, W), min(y + tile, H))
            tiles.append(Tile(i, box, img.crop(box))); i += 1
    return tiles

def to_full(tile: Tile, norm: tuple[float, float, float, float]) -> BBox:
    x0, y0, x1, y1 = tile.box
    w, h = x1 - x0, y1 - y0
    return (x0 + int(norm[0] * w), y0 + int(norm[1] * h), x0 + int(norm[2] * w), y0 + int(norm[3] * h))

def crop_zoom(img: Image.Image, box: BBox, pad: int = 40, scale: int = 3) -> Image.Image:
    W, H = img.size
    b = (max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, W), min(box[3] + pad, H))
    c = img.crop(b)
    return c.resize((c.width * scale, c.height * scale), Image.LANCZOS)
