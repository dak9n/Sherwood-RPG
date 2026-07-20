#!/usr/bin/env python3
"""
Делает спрайты нагрудников НА ГЕРОЕ из иконок самих предметов.

Зачем: заказчик надел Crimson Plate и увидел на герое «непонятные пиксели» —
перекраску туники, а не ту броню, что нарисована на иконке. Иконка же готовая:
её достаточно ужать до торса. На макете проверено — при ширине ~14px кираса
читается, при 12 мелко, при 18+ вылезает на руки.

Результат: public/assets/worn/<id>.png — полоса 128x32, четыре ячейки 32x32
(вниз/влево/вправо/спина), центр ячейки игра сажает в якорь нагрудника.
Профили уже фаса: торс сбоку узкий.

Запуск: python3 tools/worn-from-icons.py
Перезапуск перетирает файлы — нарисованное руками в ?helm сначала сохрани.
Требует Pillow (есть в системе; в игру и сборку не входит — это офлайн-утилита).
"""

from PIL import Image
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "public/assets/armor-icons/Icons")
UI_SHEET = os.path.join(ROOT, "public/assets/interface/PNG/Icons.png")
OUT = os.path.join(ROOT, "public/assets/worn")

CELL = 32
# Ширина брони на герое: фас/спина и профиль. Замерено по макету на модельке.
W_FRONT = 14
W_SIDE = 11

# id предмета -> откуда взять иконку. ("atlas", N) — файл Icons_6_NN.png,
# ("ui", x, y, w, h) — вырезка из листа интерфейса (у старой Plate Armor).
CHESTS = {
    "leather_chest": ("atlas", 51),
    "iron_chest": ("atlas", 13),
    "azure_chest": ("atlas", 18),
    "bronze_chest": ("atlas", 11),
    "gilded_chest": ("atlas", 15),
    "emerald_chest": ("atlas", 19),
    "crimson_chest": ("atlas", 20),
    "cloth_chest": ("atlas", 91),
    "armor": ("ui", 5 * 16, 6 * 16, 16, 16),
}


def icon_of(src):
    if src[0] == "atlas":
        im = Image.open(os.path.join(ICONS, f"Icons_6_{src[1]:02d}.png")).convert("RGBA")
    else:
        _, x, y, w, h = src
        im = Image.open(UI_SHEET).convert("RGBA").crop((x, y, x + w, y + h))
    bb = im.getbbox()  # обрезаем прозрачные поля: масштабируем саму вещь
    return im.crop(bb) if bb else im


def scaled(core, width):
    k = width / core.width
    small = core.resize((width, max(1, round(core.height * k))), Image.LANCZOS)
    # Пиксель-арт не терпит полупрозрачных краёв: край либо есть, либо нет.
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a > 110 else 0)
    return small


def build(item_id, src):
    core = icon_of(src)
    strip = Image.new("RGBA", (CELL * 4, CELL), (0, 0, 0, 0))
    for i, width in enumerate([W_FRONT, W_SIDE, W_SIDE, W_FRONT]):
        piece = scaled(core, width)
        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cell.paste(piece, ((CELL - piece.width) // 2, (CELL - piece.height) // 2), piece)
        strip.paste(cell, (i * CELL, 0))
    strip.save(os.path.join(OUT, f"{item_id}.png"))


os.makedirs(OUT, exist_ok=True)
for item_id, src in CHESTS.items():
    build(item_id, src)
    print(f"  {item_id}: спрайт из иконки")

ids = sorted(f[:-4] for f in os.listdir(OUT) if f.endswith(".png"))
with open(os.path.join(OUT, "manifest.json"), "w") as f:
    f.write(json.dumps(ids, indent=1) + "\n")
print(f"\nманифест: {len(ids)} спрайтов")
