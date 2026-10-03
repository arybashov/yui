"""release-yandex — одна пронумерованная сборка для Яндекс Игр, как release.py в «Городках».

    python scripts/release-yandex.py          # поднять номер сборки, собрать, упаковать
    python scripts/release-yandex.py --again  # пересобрать текущую версию, не поднимая номер

Версия — MAJOR.MINOR.BUILD: MAJOR.MINOR в файле VERSION (меняется руками для шага
побольше), BUILD — в release/build_number, поднимается здесь один раз на релиз.
Номер виден в игре внизу «Настроек» («сборка 1.0.N»). Результат:

    release/YUI_yandex_v1.0.N.zip   (index.html в корне — сразу в Консоль)

и строка в release/releases.txt. Яндекс не принимает одну версию дважды —
поэтому каждая загрузка в Консоль = новый номер (в поле «Версия» — тот же 1.0.N).
"""

import argparse
import datetime
import os
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COUNTER = ROOT / "release" / "build_number"
OUT = ROOT / "release"
BUILD = ROOT / "dist-yandex"
LOG = OUT / "releases.txt"
SIZE_LIMIT = 100 * 1024 * 1024  # требование 1.21: до 100 МБ без сжатия


def run(args: list[str]) -> str:
    shell = os.name == "nt"  # npm/npx на Windows — .cmd
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", shell=shell)
    if r.returncode != 0:
        sys.stdout.write(r.stdout[-3000:] + r.stderr[-3000:])
        raise SystemExit("ошибка: " + " ".join(args[:3]))
    return r.stdout


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--again", action="store_true", help="пересобрать текущую версию без нового номера")
    a = ap.parse_args()

    build = int(COUNTER.read_text().strip() or 0) if COUNTER.exists() else 0
    if not a.again:
        build += 1
        COUNTER.write_text(f"{build}\n")
    version = f"{(ROOT / 'VERSION').read_text().strip()}.{build}"
    print(f"релиз v{version}")

    run(["npx", "tsc", "--noEmit"])
    run(["npx", "vitest", "run"])
    run(["npx", "vite", "build", "--mode", "yandex", "--outDir", "dist-yandex", "--emptyOutDir"])

    files = sorted(p for p in BUILD.rglob("*") if p.is_file())
    if not (BUILD / "index.html").is_file():
        raise SystemExit("в сборке нет index.html")
    bad = [str(p.relative_to(BUILD)) for p in files if not str(p.relative_to(BUILD)).isascii() or " " in p.name]
    if bad:
        raise SystemExit("недопустимые имена файлов (требование 1.22): " + ", ".join(bad))
    total = sum(p.stat().st_size for p in files)
    if total > SIZE_LIMIT:
        raise SystemExit(f"сборка {total / 1e6:.1f} МБ — больше 100 МБ (требование 1.21)")
    # в собранном коде должна стоять именно эта версия
    if not any(version in p.read_text(encoding="utf-8", errors="ignore") for p in files if p.suffix == ".js"):
        raise SystemExit(f"в сборке не нашлась версия {version}")

    OUT.mkdir(parents=True, exist_ok=True)
    archive = OUT / f"YUI_yandex_v{version}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(BUILD).as_posix())

    commit = run(["git", "rev-parse", "--short", "HEAD"]).strip()
    dirty = " (+незакоммиченные правки)" if run(["git", "status", "--porcelain", "--", "src", "public", "index.html"]).strip() else ""
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    line = f"{stamp}  v{version}  {archive.name}  {archive.stat().st_size / 1e6:.2f} МБ  git {commit}{dirty}\n"
    with LOG.open("a", encoding="utf-8") as log:
        log.write(line)
    print(f"{archive.relative_to(ROOT)}: {len(files)} файлов, {total / 1e6:.2f} МБ без сжатия, архив {archive.stat().st_size / 1e6:.2f} МБ")
    print(f"в поле «Версия» в Консоли: {version}")


if __name__ == "__main__":
    main()
