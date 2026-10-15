from poster_qc.pipeline import _verify_text_ok, _has_whole_token, _norm


def test_verify_text_ok_happy_path():
    assert _verify_text_ok("Gettysburg, Pennsylvania,", "Pennsylvaia,", "Pennsylvania,") is True


def test_verify_text_ok_right_missing():
    assert _verify_text_ok("Gettysburg, Pennsylvaia,", "Pennsylvaia,", "Pennsylvania,") is False


def test_verify_text_ok_wrong_still_present():
    # both tokens present (partial fix / ghost) must fail
    assert _verify_text_ok("Pennsylvaia Pennsylvania", "Pennsylvaia,", "Pennsylvania,") is False


def test_verify_text_ok_rejects_substring_false_pass_for_right():
    # old logic: "art" in "artifact" would false-pass
    assert _verify_text_ok("the artifact remains", "foo", "art") is False
    assert _verify_text_ok("the art remains", "foo", "art") is True


def test_verify_text_ok_wrong_substring_not_treated_as_present():
    # old logic: "cat" in "category" would incorrectly block a good fix
    assert _verify_text_ok("the category is Bush", "cat", "Bush") is True


def test_verify_text_ok_same_wrong_and_right():
    assert _verify_text_ok("Library of Congress", "Congress", "Congress") is True


def test_verify_text_ok_empty_right():
    assert _verify_text_ok("something", "x", "") is False
    assert _verify_text_ok("something", "x", "!!!") is False


def test_has_whole_token_multiword():
    assert _has_whole_token(_norm("New York City skyline"), _norm("New York")) is True
    assert _has_whole_token(_norm("York New City"), _norm("New York")) is False
