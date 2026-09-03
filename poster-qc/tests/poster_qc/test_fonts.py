from poster_qc.fonts import fit_size_to_width, FONT_CANDIDATES, load_font

def test_fit_size_recovers_original():
    f24 = load_font("georgiab", 24)
    target = f24.getlength("Gettysburg, Pennsylvaia,")
    assert fit_size_to_width("georgiab", "Gettysburg, Pennsylvaia,", target) == 24

def test_candidates_exist():
    for name in FONT_CANDIDATES:
        assert load_font(name, 12) is not None
