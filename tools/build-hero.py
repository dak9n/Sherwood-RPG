#!/usr/bin/env python3
"""
Собирает спрайт-атлас героя из исходных кадров.

Зачем: исходники — 210 файлов по 2000x1050 (26 МБ), где 89% каждого кадра пустота,
а сам эльф нарисован ростом 515px. Игре нужен один компактный атлас.

Запуск:  python3 tools/build-hero.py
Требует: pillow  (pip3 install pillow)

Исходники в git не нужны — нужен результат:
  public/assets/hero.png  + public/assets/hero.json
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("нужен pillow: pip3 install pillow")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public/assets/hero/_PNG/1"
OUT_PNG = ROOT / "public/assets/hero.png"
OUT_JSON = ROOT / "public/assets/hero.json"

VARIANT = "Elf_01"
ANIMS = ["IDLE", "WALK", "RUN", "ATTACK", "HURT", "DIE", "JUMP"]
FRAMES_PER_ANIM = 10

# Рост эльфа в атласе. Тайл карты — 16px, дерево — примерно 5 тайлов (80px),
# так что 64px это персонаж чуть ниже дерева. В игре можно ужать масштабом.
TARGET_HEIGHT = 64
PADDING = 1  # прозрачный зазор, чтобы соседние кадры не подмешивались при фильтрации


def frame_path(anim: str, i: int) -> Path:
    return SRC / f"{VARIANT}__{anim}_{i:03d}.png"


def main() -> None:
    if not SRC.exists():
        sys.exit(f"нет исходников: {SRC}")

    paths = [(a, i, frame_path(a, i)) for a in ANIMS for i in range(FRAMES_PER_ANIM)]
    paths = [(a, i, p) for a, i, p in paths if p.exists()]
    if not paths:
        sys.exit("не нашёл ни одного кадра")

    # Общий прямоугольник по ВСЕМ кадрам сразу. Обрезать каждый кадр по своим
    # границам нельзя: в RUN эльф гуляет по холсту на десяток пикселей, и от
    # покадровой обрезки он бы дёргался на месте.
    left = top = 10**9
    right = bottom = 0
    for _, _, p in paths:
        bb = Image.open(p).convert("RGBA").getbbox()
        if not bb:
            continue
        left, top = min(left, bb[0]), min(top, bb[1])
        right, bottom = max(right, bb[2]), max(bottom, bb[3])

    src_w, src_h = right - left, bottom - top
    scale = TARGET_HEIGHT / src_h
    cell_w, cell_h = round(src_w * scale), TARGET_HEIGHT

    cols = FRAMES_PER_ANIM
    rows = len(ANIMS)
    sheet_w = cols * (cell_w + PADDING * 2)
    sheet_h = rows * (cell_h + PADDING * 2)

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    frames = {}

    for anim_index, anim in enumerate(ANIMS):
        for i in range(FRAMES_PER_ANIM):
            p = frame_path(anim, i)
            if not p.exists():
                continue

            img = Image.open(p).convert("RGBA").crop((left, top, right, bottom))
            # LANCZOS, а не ближайший сосед: уменьшаем в 8 раз, и рваные края
            # выглядели бы грязью. Пиксельность карты это не задевает — она
            # рисуется своими тайлами.
            img = img.resize((cell_w, cell_h), Image.LANCZOS)

            x = i * (cell_w + PADDING * 2) + PADDING
            y = anim_index * (cell_h + PADDING * 2) + PADDING
            sheet.paste(img, (x, y))

            frames[f"{anim}_{i:03d}"] = {
                "frame": {"x": x, "y": y, "w": cell_w, "h": cell_h},
                "rotated": False,
                "trimmed": False,
                "sourceSize": {"w": cell_w, "h": cell_h},
                "spriteSourceSize": {"x": 0, "y": 0, "w": cell_w, "h": cell_h},
            }

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PNG, optimize=True)

    atlas = {
        "frames": frames,
        "meta": {
            "image": OUT_PNG.name,
            "format": "RGBA8888",
            "size": {"w": sheet_w, "h": sheet_h},
            "scale": "1",
            "anims": {a: [f"{a}_{i:03d}" for i in range(FRAMES_PER_ANIM) if frame_path(a, i).exists()] for a in ANIMS},
        },
    }
    OUT_JSON.write_text(json.dumps(atlas))

    src_size = sum(p.stat().st_size for _, _, p in paths)
    out_size = OUT_PNG.stat().st_size + OUT_JSON.stat().st_size
    print(f"кадров:    {len(frames)} ({len(ANIMS)} анимаций)")
    print(f"эльф был:  {src_w}x{src_h} -> стал {cell_w}x{cell_h} (ужат в {1/scale:.1f} раз)")
    print(f"атлас:     {sheet_w}x{sheet_h}")
    print(f"размер:    {src_size/1024/1024:.1f} МБ -> {out_size/1024:.0f} КБ")
    print(f"записано:  {OUT_PNG.relative_to(ROOT)}, {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
