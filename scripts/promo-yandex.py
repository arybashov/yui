"""Готовит иконку и обложку для черновика в Консоли Яндекс Игр.

Вход: art/raw/icon.png (квадрат) и art/raw/cover.png (альбомная картинка).
Выход: promo/yandex/icon-512.png (512×512) и promo/yandex/cover-800x470.png —
размеры и формат, которые требует площадка.

Запуск: python scripts/promo-yandex.py
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
OUT = ROOT / "promo" / "yandex"

ICON_SIZE = (512, 512)
COVER_SIZE = (800, 470)


def crop(image: Image.Image, ratio: float, top_share: float) -> Image.Image:
    """Обрезает картинку до нужного отношения ширины к высоте.

    top_share — какая доля срезаемой высоты снимается сверху (0.5 — поровну сверху и снизу).
    """
    width, height = image.size
    if width / height > ratio:
        new_width = round(height * ratio)
        left = (width - new_width) // 2
        return image.crop((left, 0, left + new_width, height))
    new_height = round(width / ratio)
    top = round((height - new_height) * top_share)
    return image.crop((0, top, width, top + new_height))


def export(source: str, size: tuple[int, int], name: str, top_share: float = 0.5) -> None:
    image = Image.open(RAW / source).convert("RGB")
    result = crop(image, size[0] / size[1], top_share).resize(size, Image.LANCZOS)
    result.save(OUT / name, optimize=True)
    print(f"{name}: {result.width}×{result.height}, {(OUT / name).stat().st_size / 1024:.0f} КБ")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    export("icon.png", ICON_SIZE, "icon-512.png")
    # сверху срезаем меньше: верхние карты на обложке лежат близко к краю
    export("cover.png", COVER_SIZE, "cover-800x470.png", top_share=0.2)


if __name__ == "__main__":
    main()
