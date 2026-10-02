"""Режет сгенерированные листы карт на отдельные картинки с прозрачным фоном.

Вход: art/raw/{tens,jacks,queens,kings,aces}.png — по четыре карты в ряд
(пики, червы, бубны, трефы) на зелёном фоне, art/raw/back.png — рубашка,
art/raw/table.png — фон стола.
Выход: public/cards/<id>.webp, public/cards/back.webp, public/table.webp.

Запуск: python art/slice.py
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
OUT = ROOT / "public" / "cards"

SHEETS = {"tens": 10, "jacks": 11, "queens": 12, "kings": 13, "aces": 14}
SUITS = ["S", "H", "D", "C"]
CARD_WIDTH = 300

# Насколько зелёный канал должен превышать остальные, чтобы пиксель считался фоном.
KEY_SOFT = 25
KEY_HARD = 90


def greenness(rgb: np.ndarray) -> np.ndarray:
    r, g, b = (rgb[..., i].astype(np.int16) for i in range(3))
    return g - np.maximum(r, b)


def runs(mask: np.ndarray, min_length: int) -> list[tuple[int, int]]:
    """Непрерывные отрезки True длиной не меньше min_length."""
    found, start = [], None
    for i, value in enumerate(list(mask) + [False]):
        if value and start is None:
            start = i
        elif not value and start is not None:
            if i - start >= min_length:
                found.append((start, i))
            start = None
    return found


def cut_cards(path: Path, expected: int) -> list[Image.Image]:
    rgb = np.asarray(Image.open(path).convert("RGB"))
    height, width = rgb.shape[:2]
    solid = greenness(rgb) < KEY_SOFT

    columns = runs(solid.sum(axis=0) > height * 0.15, min_length=width // 12)
    if len(columns) != expected:
        raise SystemExit(f"{path.name}: найдено карт {len(columns)}, ожидалось {expected}")

    cards = []
    for left, right in columns:
        rows = runs(solid[:, left:right].sum(axis=1) > (right - left) * 0.15, min_length=height // 6)
        top, bottom = rows[0][0], rows[-1][1]
        pad = 6
        box = (max(left - pad, 0), max(top - pad, 0), min(right + pad, width), min(bottom + pad, height))
        crop = rgb[box[1] : box[3], box[0] : box[2]].astype(np.int16)

        spill = greenness(crop)
        alpha = 1 - np.clip((spill - KEY_SOFT) / (KEY_HARD - KEY_SOFT), 0, 1)
        # убираем зелёный ореол на полупрозрачных краях
        limit = np.maximum(crop[..., 0], crop[..., 2])
        crop[..., 1] = np.minimum(crop[..., 1], limit)

        rgba = np.dstack([crop, alpha * 255]).astype(np.uint8)
        cards.append(Image.fromarray(rgba, "RGBA"))
    return cards


def main() -> None:
    # консоль Windows по умолчанию не печатает кириллицу
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)

    faces: dict[str, Image.Image] = {}
    for sheet, rank in SHEETS.items():
        for suit, card in zip(SUITS, cut_cards(RAW / f"{sheet}.png", 4)):
            faces[f"{rank}{suit}"] = card
    back = cut_cards(RAW / "back.png", 1)[0]

    # все карты приводим к одному размеру, чтобы на столе они не «прыгали»
    ratios = sorted(card.height / card.width for card in faces.values())
    ratio = ratios[len(ratios) // 2]
    size = (CARD_WIDTH, round(CARD_WIDTH * ratio))
    for name, card in {**faces, "back": back}.items():
        own = card.height / card.width
        print(f"{name}: {card.width}x{card.height}, пропорция {own:.3f}")
        card.resize(size, Image.LANCZOS).save(OUT / f"{name}.webp", quality=90, method=6)

    table = Image.open(RAW / "table.png").convert("RGB")
    table.save(ROOT / "public" / "table.webp", quality=82, method=6)
    print(f"размер карты {size[0]}x{size[1]}, пропорция {ratio:.3f}")


if __name__ == "__main__":
    main()
