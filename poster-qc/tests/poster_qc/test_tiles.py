from PIL import Image
from poster_qc.tiles import grid_tiles, crop_zoom, to_full

def test_grid_covers_and_overlaps():
    img = Image.new("RGB", (1600, 2400), "white")
    tiles = grid_tiles(img, tile=900, overlap=120)
    assert tiles[0].box[:2] == (0, 0)
    xs = {t.box[2] for t in tiles}; ys = {t.box[3] for t in tiles}
    assert 1600 in xs and 2400 in ys
    assert all(t.image.size[0] <= 900 and t.image.size[1] <= 900 for t in tiles)

def test_to_full_maps_tile_bbox():
    img = Image.new("RGB", (1600, 2400), "white")
    t = grid_tiles(img, tile=900, overlap=120)[1]
    assert to_full(t, (0.5, 0.5, 1.0, 1.0)) == (t.box[0] + (t.box[2]-t.box[0])//2, t.box[1] + (t.box[3]-t.box[1])//2, t.box[2], t.box[3])

def test_crop_zoom_scales():
    img = Image.new("RGB", (200, 200), "white")
    z = crop_zoom(img, (50, 50, 100, 100), pad=10, scale=3)
    assert z.size == (210, 210)
