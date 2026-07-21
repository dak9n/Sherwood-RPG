#!/usr/bin/env python3
"""
Считает маску волос для шлема: где именно они торчат из-под него.

Зачем: шлем — спрайт ПОВЕРХ головы, и всё, что он не накрыл, остаётся видно.
У закрытых шлемов силуэт бывает уже головы на пиксель-другой, и по краям лезут
волосы — в статике почти незаметно, в движении мерцает.

Руками это ищется мышкой по четырём ячейкам (ластик «Hair rubber» в ?helm), но
искать не обязательно:游 у нас есть и голова героя, и шлем, и та же геометрия,
что в игре. Перебираем ВСЕ кадры ВСЕХ анимаций, находим пиксели волос, которые
шлем не накрыл, и складываем их в одну маску на направление.

Маска — полоса 128x32 в public/assets/worn/mask/<id>.png: закрашенный пиксель
значит «здесь голову не рисовать» (Player.drawHeadMasked).

Результат — заготовка, а не приговор: в ?helm её можно дорисовать ластиком или
снести кнопкой «Clear hair».

Запуск: python3 tools/hair-mask.py <id> [<id> ...]
Требует Pillow. В игру и сборку не входит.
"""

from PIL import Image
import json
import math
import os
import sys


def jsround(v):
    """Округление КАК В БРАУЗЕРЕ: .5 всегда вверх.

    Встроенный round() в Python банковский: round(14.5) == 14, а Math.round(14.5)
    == 15. Игра считает посадку ячейки на JS, центры головы у героя полуцелые
    (фас 30.5/27.5, спина 32.5/27.5) — и маска, посчитанная питоновским round,
    ложилась на пиксель мимо. Ровно тот же баг был в самом редакторе.
    """
    return math.floor(v + 0.5)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = os.path.join(ROOT, "public/assets/characters/PNG/Swordsman_lvl1/Parts")
PREFIX = "Swordsman_lvl1_"
WORN = os.path.join(ROOT, "public/assets/worn")
MASKS = os.path.join(WORN, "mask")

FRAME = 64
CELL = 32
SHEETS = ("Idle", "Walk", "attack", "Death")  # регистр как на диске: на Linux важен

# Тона волос героя. Кожу и глаза НЕ трогаем: подбородок и щека из-под открытого
# шлема — это нормально и даже нужно, а вот прядь поверх забрала — нет.
HAIR = {
    (33, 26, 28), (43, 32, 35), (59, 44, 51),
    (77, 57, 69), (104, 79, 90), (135, 108, 125), (17, 11, 0),
}
# Запас вокруг найденного пикселя: край рисунка шлема гуляет на полпикселя от
# кадра к кадру, и без запаса на границе остаётся мерцающая крошка.
GROW = 1


def head_center(frame):
    """Центр головы ТОЧНО как его считает игра (scanHeadCenters в player.ts).

    Своим обходом, а не getbbox(), по двум причинам, и обе стоили ошибок:

    1. ПОРОГ. Игра берёт пиксель за непрозрачный при alpha > 24, а getbbox() —
       при alpha > 0.
    2. ГРАНИЦЫ. getbbox() отдаёт правый и нижний край ИСКЛЮЧИТЕЛЬНО, а игра ведёт
       x1 включительно ('if (x > x1) x1 = x'). Из-за этого (bb[0]+bb[2])/2
       давало центр на полпикселя правее и ниже настоящего — маска ложилась
       мимо на 14 клеток из 361.
    """
    px = frame.load()
    x0 = y0 = FRAME
    x1 = y1 = -1
    for y in range(FRAME):
        for x in range(FRAME):
            if px[x, y][3] > 24:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    return None if y1 < 0 else ((x0 + x1) / 2, (y0 + y1) / 2)


def build(item_id):
    helm_path = os.path.join(WORN, f"{item_id}.png")
    if not os.path.exists(helm_path):
        print(f"  {item_id}: спрайта нет — пропускаю")
        return False

    helm = Image.open(helm_path).convert("RGBA")
    cells = [helm.crop((i * CELL, 0, i * CELL + CELL, CELL)).load() for i in range(4)]
    hit = [set() for _ in range(4)]

    for sheet in SHEETS:
        head = Image.open(os.path.join(PARTS, f"{PREFIX}{sheet}_head.png")).convert("RGBA")
        cols = head.width // FRAME
        for row in range(min(4, head.height // FRAME)):
            for col in range(cols):
                f = head.crop((col * FRAME, row * FRAME, col * FRAME + FRAME, row * FRAME + FRAME))
                c = head_center(f)
                if c is None:
                    continue
                ox, oy = jsround(c[0] - 16), jsround(c[1] - 16)
                px = f.load()
                bb = f.getbbox()
                for y in range(bb[1], bb[3]):
                    for x in range(bb[0], bb[2]):
                        p = px[x, y]
                        if p[3] <= 24 or p[:3] not in HAIR:
                            continue
                        cx, cy = x - ox, y - oy
                        if not (0 <= cx < CELL and 0 <= cy < CELL):
                            continue  # вылезло за ячейку — маской не достать
                        if cells[row][cx, cy][3] > 0:
                            continue  # шлем и так закрывает
                        hit[row].add((cx, cy))

    strip = Image.new("RGBA", (CELL * 4, CELL), (0, 0, 0, 0))
    total = 0
    for row in range(4):
        grown = set()
        for (x, y) in hit[row]:
            for dy in range(-GROW, GROW + 1):
                for dx in range(-GROW, GROW + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < CELL and 0 <= ny < CELL:
                        grown.add((nx, ny))
        for (x, y) in grown:
            strip.putpixel((row * CELL + x, y), (255, 255, 255, 255))
        total += len(grown)

    if total == 0:
        print(f"  {item_id}: волосы не торчат — маска не нужна")
        return False

    os.makedirs(MASKS, exist_ok=True)
    strip.save(os.path.join(MASKS, f"{item_id}.png"))
    per = ", ".join(f"{d} {len([1 for p in hit[i]])}" for i, d in enumerate(("фас", "влево", "вправо", "спина")))
    print(f"  {item_id}: найдено волос — {per}; в маске {total} px (с запасом {GROW})")
    return True


ids = sys.argv[1:]
if not ids:
    print(__doc__)
    raise SystemExit(2)

for item_id in ids:
    build(item_id)

os.makedirs(MASKS, exist_ok=True)
have = sorted(f[:-4] for f in os.listdir(MASKS) if f.endswith(".png"))
with open(os.path.join(MASKS, "manifest.json"), "w") as f:
    f.write(json.dumps(have, indent=1) + "\n")
print(f"\nманифест масок: {len(have)}")
