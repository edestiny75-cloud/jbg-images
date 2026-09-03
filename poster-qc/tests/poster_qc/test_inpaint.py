from PIL import Image
from poster_qc.inpaint_openai import build_crop_and_mask, paste_back, build_prompt

def test_mask_is_transparent_only_over_word():
    img = Image.new("RGB", (1000, 1000), "white")
    crop, mask, crop_box = build_crop_and_mask(img, word_box=(400, 500, 480, 520), line_box=(300, 495, 700, 525), size=512)
    assert crop.size == (512, 512) and mask.size == (512, 512)
    a = mask.getchannel("A")
    assert a.getpixel((256, 256)) == 0            # centre of word is transparent (editable)
    assert a.getpixel((5, 5)) == 255              # corner is opaque (locked)

def test_paste_back_roundtrip():
    img = Image.new("RGB", (1000, 1000), "white")
    crop, mask, crop_box = build_crop_and_mask(img, (400, 500, 480, 520), (300, 495, 700, 525), size=512)
    out = paste_back(img, crop, crop_box)
    assert out.size == img.size

def test_prompt_is_exact():
    p = build_prompt("Pennsylvaia,", "Pennsylvania,", "Gettysburg, Pennsylvania,")
    assert '"Pennsylvania,"' in p and "nothing else" in p.lower()

def test_inpaint_word_retries_with_fallback_model_on_api_error():
    import base64, io
    from poster_qc.inpaint_openai import inpaint_word
    from poster_qc import config

    def _b64_png(im):
        buf = io.BytesIO(); im.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    class FakeResp:
        def __init__(self, im):
            self.data = [type("D", (), {"b64_json": _b64_png(im)})()]

    class FakeImages:
        def __init__(self, fail_model):
            self.fail_model = fail_model
            self.calls = []
        def edit(self, model, image, mask, prompt, size, n):
            self.calls.append(model)
            if model == self.fail_model:
                raise RuntimeError(f"The model `{model}` does not exist or you do not have access to it.")
            return FakeResp(Image.new("RGB", (1024, 1024), (10, 20, 30)))

    class FakeOpenAIClient:
        def __init__(self, fail_model):
            self.images = FakeImages(fail_model)

    img = Image.new("RGB", (1000, 1000), "white")
    client = FakeOpenAIClient(fail_model=config.OPENAI_IMAGE_MODEL)
    out, box, prompt = inpaint_word(img, (400, 500, 480, 520), (300, 495, 700, 525), "Pennsylvaia,", "Pennsylvania,",
                                     "Gettysburg, Pennsylvania,", client=client)
    assert client.images.calls == [config.OPENAI_IMAGE_MODEL, config.OPENAI_IMAGE_MODEL_FALLBACK]
    assert out.size == img.size

def test_inpaint_word_reraises_when_error_unrelated_to_model():
    from poster_qc.inpaint_openai import inpaint_word
    from poster_qc import config
    import pytest

    class FakeImages:
        def __init__(self):
            self.calls = []
        def edit(self, model, image, mask, prompt, size, n):
            self.calls.append(model)
            raise RuntimeError("rate limit exceeded")

    class FakeOpenAIClient:
        def __init__(self):
            self.images = FakeImages()

    img = Image.new("RGB", (1000, 1000), "white")
    client = FakeOpenAIClient()
    with pytest.raises(RuntimeError, match="rate limit"):
        inpaint_word(img, (400, 500, 480, 520), (300, 495, 700, 525), "Pennsylvaia,", "Pennsylvania,",
                     "Gettysburg, Pennsylvania,", client=client)
    assert client.images.calls == [config.OPENAI_IMAGE_MODEL]   # no retry for unrelated errors
