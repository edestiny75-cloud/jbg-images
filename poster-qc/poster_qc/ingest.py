from __future__ import annotations
from pathlib import Path
import re
from PIL import Image

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}

def load_pages(path: str | Path, dpi: int = 300) -> list[Image.Image]:
    p = Path(path)
    if p.suffix.lower() == ".pdf":
        import fitz
        out = []
        with fitz.open(p) as doc:
            for page in doc:
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                out.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
        return out
    if p.suffix.lower() in IMAGE_EXT:
        return [Image.open(p).convert("RGB")]
    raise ValueError(f"Unsupported file type: {p}")

_SKU_RE = re.compile(r"^(JBG-[A-Z]{3}-[A-Z]{3}-[A-Za-z0-9]+)")

def sku_from_path(path: str | Path) -> str:
    stem = Path(path).stem
    m = _SKU_RE.match(stem)
    if m:
        return m.group(1)
    return re.sub(r"_(TOFIX|FIXED|FINAL|v\d+).*$", "", stem)


def extract_posters_from_zip(zip_path: str | Path, dest_dir: str | Path,
                             skip_markers: tuple[str, ...] = ("_FIXED", "_FINAL", "_NEEDS_HUMAN")) -> list[Path]:
    """Unpack only poster files (images/PDF) from a zip into dest_dir, flattening folders.
    Skips already-processed names, hidden/macOS junk, and any path that tries to escape dest_dir.
    Returns the extracted file paths in archive order."""
    import zipfile
    dest = Path(dest_dir); dest.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if not name or name.startswith(".") or "__MACOSX" in info.filename:
                continue
            if Path(name).suffix.lower() not in IMAGE_EXT | {".pdf"}:
                continue
            if any(m in Path(name).stem for m in skip_markers):
                continue
            target = dest / name
            i = 1
            while target.exists():
                target = dest / f"{Path(name).stem}_{i}{Path(name).suffix}"; i += 1
            if not str(target.resolve()).startswith(str(dest.resolve())):
                continue
            with zf.open(info) as src, open(target, "wb") as dst:
                dst.write(src.read())
            out.append(target)
    return out
