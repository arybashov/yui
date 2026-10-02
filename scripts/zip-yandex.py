"""Упаковывает сборку для Яндекс Игр в архив yui-yandex.zip.

Площадка требует index.html в корне архива и имена файлов без пробелов
и русских букв — второе проверяется здесь же.

Запуск: npm run build:yandex (сам вызывает этот скрипт).
"""

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "dist-yandex"
ARCHIVE = ROOT / "yui-yandex.zip"
SIZE_LIMIT = 100 * 1024 * 1024


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    files = sorted(path for path in BUILD.rglob("*") if path.is_file())
    if not (BUILD / "index.html").is_file():
        raise SystemExit("В dist-yandex нет index.html — сначала соберите игру")

    bad = [str(path.relative_to(BUILD)) for path in files if not str(path.relative_to(BUILD)).isascii() or " " in path.name]
    if bad:
        raise SystemExit("Недопустимые имена файлов: " + ", ".join(bad))

    total = sum(path.stat().st_size for path in files)
    if total > SIZE_LIMIT:
        raise SystemExit(f"Сборка весит {total / 1e6:.1f} МБ — больше 100 МБ, площадка её не примет")

    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(BUILD).as_posix())
    print(f"{ARCHIVE.name}: {len(files)} файлов, {total / 1e6:.2f} МБ без сжатия")


if __name__ == "__main__":
    main()
