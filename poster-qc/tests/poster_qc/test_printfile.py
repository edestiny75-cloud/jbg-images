from PIL import Image
from poster_qc.printfile import make_print_pdf


def test_make_print_pdf_portrait(tmp_path):
    png = tmp_path / "src.png"
    Image.new("RGB", (100, 160), (200, 220, 240)).save(png)
    pdf = make_print_pdf(png, tmp_path / "out.pdf", size_in=(11, 17), dpi=300)
    assert pdf.exists()
    import fitz
    doc = fitz.open(str(pdf))
    assert doc.page_count == 1
    page = doc[0]
    assert abs(page.rect.width - 792) < 2      # 11in * 72
    assert abs(page.rect.height - 1224) < 2    # 17in * 72
    doc.close()


def test_make_print_pdf_landscape(tmp_path):
    png = tmp_path / "src2.png"
    Image.new("RGB", (160, 100), (200, 220, 240)).save(png)
    pdf = make_print_pdf(png, tmp_path / "out2.pdf", size_in=(11, 17), dpi=300)
    assert pdf.exists()
    import fitz
    doc = fitz.open(str(pdf))
    assert doc.page_count == 1
    page = doc[0]
    assert abs(page.rect.width - 1224) < 2     # 17in * 72
    assert abs(page.rect.height - 792) < 2     # 11in * 72
    doc.close()


def test_detect_print_size():
    from poster_qc.printfile import detect_print_size
    a = detect_print_size(3300, 5100)          # exact 11x17 portrait at 300 dpi
    assert a["size"] == "11x17" and a["orientation"] == "portrait" and a["ok"] and a["dpi"] == 300
    b = detect_print_size(2550, 3300)          # 8.5x11 portrait
    assert b["size"] == "8.5x11" and b["ok"]
    c = detect_print_size(1600, 2461)          # civics jpgs: 1.538 vs 1.545 -> ok, but low dpi
    assert c["size"] == "11x17" and c["ok"] and c["dpi"] < 150 and "soft" in c["note"]
    d = detect_print_size(1024, 1536)          # 1.5:1 - stretches ~3% to 11x17
    assert d["size"] == "11x17" and not d["ok"] and "stretch" in d["note"]
    e = detect_print_size(1700, 1100)
    assert e["orientation"] == "landscape"
