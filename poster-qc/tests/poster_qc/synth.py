from PIL import Image, ImageDraw, ImageFont
FONT = r"C:\Windows\Fonts\georgiab.ttf"
PARCHMENT = (236, 222, 190)
INK = (60, 40, 30)

def line_image(text: str, size: int = 24, pad: int = 30, font=FONT):
    f = ImageFont.truetype(font, size)
    w = int(f.getlength(text)) + 2 * pad
    asc, desc = f.getmetrics()
    img = Image.new("RGB", (w, asc + desc + 2 * pad), PARCHMENT)
    ImageDraw.Draw(img).text((pad, pad), text, font=f, fill=INK)
    return img, f, (pad, pad + asc)  # image, font, (x0, baseline_y)
