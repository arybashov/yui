"""Готовит картинки для черновика Яндекс Игр и иконки сайта — по образцу «Городков».

Вход (art/raw): icon_c_fire.png — иконка (квадрат), cover.png — обложка (альбомная).
Выход:
  promo/yandex/upload/icon_512.png           иконка каталога 512×512
  promo/yandex/upload/icon_maskable_512.png  иконка с безопасной зоной под маску
  promo/yandex/upload/cover_{ru,en}.png      обложка 800×470 (название YUI одно на оба языка)
  public/favicon.ico, public/icon-192.png, public/apple-touch-icon.png — значки сайта

Скриншоты и видео делает scripts/store-shots.mjs.
Запуск: python scripts/promo-yandex.py
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
UPLOAD = ROOT / "promo" / "yandex" / "upload"
PUBLIC = ROOT / "public"

ICON_SOURCE = "icon_c_fire.png"
COVER_SIZE = (800, 470)
# W3C maskable: всё важное — в круге радиусом 40% размера; рисунок уменьшаем с запасом
MASKABLE_SCALE = 0.6


def square(image: Image.Image) -> Image.Image:
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side))


def crop_to(image: Image.Image, ratio: float, top_share: float) -> Image.Image:
    """Обрезать до отношения сторон; top_share — какая доля лишней высоты срезается сверху."""
    width, height = image.size
    if width / height > ratio:
        new_width = round(height * ratio)
        left = (width - new_width) // 2
        return image.crop((left, 0, left + new_width, height))
    new_height = round(width / ratio)
    top = round((height - new_height) * top_share)
    return image.crop((0, top, width, top + new_height))


def radial(size: int, center: tuple, edge: tuple) -> Image.Image:
    """Радиальный градиент от центра к краям — фон в тон исходной иконки."""
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    half = size / 2
    reach = half * 1.42
    for y in range(size):
        for x in range(size):
            t = min(1.0, ((x - half) ** 2 + (y - half) ** 2) ** 0.5 / reach)
            pixels[x, y] = tuple(round(c + (e - c) * t) for c, e in zip(center, edge))
    return image


def maskable(icon: Image.Image, size: int) -> Image.Image:
    """Рисунок поменьше по центру, края растворяются в фоне цвета краёв иконки."""
    small = icon.resize((64, 64), Image.LANCZOS)
    corner = small.getpixel((1, 1))
    glow = small.getpixel((4, 32))  # середина левого края — тёплое свечение фона
    background = radial(size, ImageEnhance.Brightness(Image.new("RGB", (1, 1), glow)).enhance(1.2).getpixel((0, 0)), corner)
    inner = round(size * MASKABLE_SCALE)
    foreground = icon.resize((inner, inner), Image.LANCZOS)
    fade = round(inner * 0.12)
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rectangle((fade, fade, inner - fade, inner - fade), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(fade / 2))
    offset = (size - inner) // 2
    background.paste(foreground, (offset, offset), mask)
    return background


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    UPLOAD.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    icon = square(Image.open(RAW / ICON_SOURCE).convert("RGB"))
    outputs = {
        UPLOAD / "icon_512.png": icon.resize((512, 512), Image.LANCZOS),
        UPLOAD / "icon_maskable_512.png": maskable(icon, 512),
        PUBLIC / "icon-192.png": icon.resize((192, 192), Image.LANCZOS),
        PUBLIC / "apple-touch-icon.png": icon.resize((180, 180), Image.LANCZOS),
    }
    cover = crop_to(Image.open(RAW / "cover.png").convert("RGB"), COVER_SIZE[0] / COVER_SIZE[1], 0.2)
    cover = cover.resize(COVER_SIZE, Image.LANCZOS)
    for lang in ("ru", "en"):
        outputs[UPLOAD / f"cover_{lang}.png"] = cover

    for path, image in outputs.items():
        image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}: {image.width}×{image.height}")

    favicon = PUBLIC / "favicon.ico"
    icon.save(favicon, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"{favicon.relative_to(ROOT)}: 16/32/48")


if __name__ == "__main__":
    main()
