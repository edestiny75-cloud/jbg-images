from __future__ import annotations
import base64, io
from PIL import Image
from .models import BBox
from . import config

def build_prompt(wrong: str, right: str, line: str) -> str:
    return (f'Replace the word "{wrong}" with "{right}" so the line reads exactly: "{line}". '
            f"Match the existing font, weight, size, color, and baseline exactly. Change nothing else: "
            f"keep every other letter, the background texture, and the layout pixel-identical.")

def build_crop_and_mask(img: Image.Image, word_box: BBox, line_box: BBox, size: int = 1024):
    """Square crop centred on the word (at least the line height * 6 tall), resized to size x size,
    plus an RGBA mask whose alpha is 0 over the word box and 255 elsewhere."""
    cx = (word_box[0] + word_box[2]) // 2; cy = (word_box[1] + word_box[3]) // 2
    line_h = line_box[3] - line_box[1]
    half = max(line_h * 3, (word_box[2] - word_box[0]) // 2 + 20, 64)
    crop_box = (max(cx - half, 0), max(cy - half, 0), min(cx + half, img.width), min(cy + half, img.height))
    crop = img.crop(crop_box).resize((size, size), Image.LANCZOS)
    sx = size / (crop_box[2] - crop_box[0]); sy = size / (crop_box[3] - crop_box[1])
    mask = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    wx0 = int((word_box[0] - crop_box[0] - 2) * sx); wx1 = int((word_box[2] - crop_box[0] + 2) * sx)
    wy0 = int((word_box[1] - crop_box[1] - 2) * sy); wy1 = int((word_box[3] - crop_box[1] + 2) * sy)
    mask.paste((0, 0, 0, 0), (max(wx0, 0), max(wy0, 0), min(wx1, size), min(wy1, size)))
    return crop, mask, crop_box

def paste_back(img: Image.Image, edited: Image.Image, crop_box: BBox, keep_box: BBox | None = None, feather: int = 3) -> Image.Image:
    """Put the edited crop back. When keep_box (full-image coords) is given, only that region (plus a
    feathered margin) is taken from the edit; everything else stays pixel-identical to the original."""
    import numpy as np
    out = img.copy()
    w, h = crop_box[2] - crop_box[0], crop_box[3] - crop_box[1]
    ed = edited.convert("RGB").resize((w, h), Image.LANCZOS)
    if keep_box is None:
        out.paste(ed, crop_box[:2]); return out
    orig = np.asarray(img.crop(crop_box)).astype(np.float32); new = np.asarray(ed).astype(np.float32)
    kx0, ky0 = max(keep_box[0] - crop_box[0] - feather, 0), max(keep_box[1] - crop_box[1] - feather, 0)
    kx1, ky1 = min(keep_box[2] - crop_box[0] + feather, w), min(keep_box[3] - crop_box[1] + feather, h)
    alpha = np.zeros((h, w), dtype=np.float32); alpha[ky0:ky1, kx0:kx1] = 1.0
    try:
        import cv2
        alpha = cv2.GaussianBlur(alpha, (2 * feather + 1, 2 * feather + 1), 0)
        alpha[ky0 + feather:ky1 - feather, kx0 + feather:kx1 - feather] = 1.0
    except ImportError:
        pass
    blended = alpha[..., None] * new + (1 - alpha[..., None]) * orig
    out.paste(Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8)), crop_box[:2])
    return out

def _png_bytes(im: Image.Image) -> io.BytesIO:
    b = io.BytesIO(); im.save(b, format="PNG"); b.seek(0); b.name = "image.png"; return b

def _edit(client, model: str, crop: Image.Image, mask: Image.Image, prompt: str):
    return client.images.edit(model=model, image=_png_bytes(crop), mask=_png_bytes(mask), prompt=prompt,
                              size="1024x1024", n=1)

def inpaint_word(img: Image.Image, word_box: BBox, line_box: BBox, wrong: str, right: str, line: str,
                 client=None, model: str = config.OPENAI_IMAGE_MODEL) -> tuple[Image.Image, BBox, str]:
    """Returns (new image, changed box, prompt). Raises on API failure.

    If the request fails with an error whose message mentions the requested model (e.g. the model id is
    unrecognised or unavailable to this account), retries once with config.OPENAI_IMAGE_MODEL_FALLBACK.
    Any other error propagates immediately without retry.
    """
    if client is None:
        from openai import OpenAI
        client = OpenAI(api_key=config.get_key("OPENAI_API_KEY"))
    crop, mask, crop_box = build_crop_and_mask(img, word_box, line_box)
    prompt = build_prompt(wrong, right, line)
    try:
        resp = _edit(client, model, crop, mask, prompt)
    except Exception as e:
        fallback = config.OPENAI_IMAGE_MODEL_FALLBACK
        if model != fallback and model in str(e):
            resp = _edit(client, fallback, crop, mask, prompt)
        else:
            raise
    data = resp.data[0]
    edited = Image.open(io.BytesIO(base64.b64decode(data.b64_json))) if getattr(data, "b64_json", None) else None
    if edited is None:
        raise RuntimeError("OpenAI returned no b64_json")
    keep = (word_box[0] - 2, line_box[1], word_box[2] + 2, line_box[3])
    out = paste_back(img, edited, crop_box, keep_box=keep)
    changed = (max(keep[0] - 4, 0), max(keep[1] - 4, 0), min(keep[2] + 4, img.width), min(keep[3] + 4, img.height))
    return out, changed, prompt
