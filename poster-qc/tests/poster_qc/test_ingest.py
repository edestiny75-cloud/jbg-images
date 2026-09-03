from PIL import Image
from poster_qc.ingest import load_pages, sku_from_path

def test_png_and_jpg(tmp_path):
    Image.new("RGB", (40, 30), "white").save(tmp_path / "JBG-POS-LAM-Foo_TOFIX.png")
    Image.new("RGB", (40, 30), "white").save(tmp_path / "JBG-POS-LAM-Bar.jpg")
    for name in ("JBG-POS-LAM-Foo_TOFIX.png", "JBG-POS-LAM-Bar.jpg"):
        pages = load_pages(tmp_path / name)
        assert len(pages) == 1 and pages[0].size == (40, 30) and pages[0].mode == "RGB"

def test_pdf(tmp_path):
    import fitz
    doc = fitz.open(); page = doc.new_page(width=72, height=36); doc.save(tmp_path / "x.pdf")
    pages = load_pages(tmp_path / "x.pdf", dpi=300)
    assert len(pages) == 1 and pages[0].size == (300, 150)

def test_sku():
    assert sku_from_path("C:/a/JBG-POS-LAM-GettysburgAddress_v3_TOFIX.png") == "JBG-POS-LAM-GettysburgAddress"
    assert sku_from_path("random name.jpg") == "random name"


def test_extract_posters_from_zip(tmp_path):
    import zipfile
    from poster_qc.ingest import extract_posters_from_zip
    Image.new("RGB", (10, 10), "white").save(tmp_path / "a.png")
    z = tmp_path / "batch.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.write(tmp_path / "a.png", "folder/JBG-POS-LAM-One_TOFIX.png")
        zf.write(tmp_path / "a.png", "folder/JBG-POS-LAM-Two_FIXED.png")     # skipped
        zf.write(tmp_path / "a.png", "__MACOSX/._junk.png")                   # skipped
        zf.writestr("notes.txt", "hi")                                        # skipped
        zf.write(tmp_path / "a.png", "../escape.png")                         # never written outside
    out = extract_posters_from_zip(z, tmp_path / "unz")
    names = sorted(p.name for p in out)
    assert names == ["JBG-POS-LAM-One_TOFIX.png", "escape.png"]
    assert all(str(p).startswith(str(tmp_path / "unz")) for p in out)
