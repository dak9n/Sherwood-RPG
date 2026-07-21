#!/usr/bin/env python3
"""
Делает спрайт брони НА ГЕРОЕ из четырёх нарисованных ракурсов.

Чем отличается от worn-from-icons.py: тот берёт ОДНУ иконку предмета и повторяет
её на все стороны — профиль у него это тот же фас, просто уже. Здесь художник
нарисовал четыре разных вида, и каждый ложится на своё направление. Получается
честнее: в профиль виден гребень, со спины — плюмаж, а не сплющенное лицо.

ПОЧЕМУ НОРМИРУЕМ ПО ВЫСОТЕ, А НЕ ПО ШИРИНЕ. Ракурсы у художника разной ширины
(шлем сбоку длиннее, чем анфас — так и в жизни), но одинаковой высоты. Если
подгонять каждый под свою ширину, как в worn-from-icons.py, фас выходит 16x24, а
профиль 13x15 — и шлем скачет по высоте при каждом повороте героя. Нормировка по
высоте сохраняет авторские пропорции: голова остаётся одного размера, а ширина
меняется так, как её нарисовали.

Результат: public/assets/worn/<id>.png — полоса 128x32, четыре ячейки 32x32
в порядке игры (вниз/влево/вправо/спина).

Запуск: python3 tools/worn-from-views.py
Перезапуск перетирает файл — нарисованное руками в ?helm сначала сохрани.
Требует Pillow. В игру и сборку не входит — офлайн-утилита.
"""

from PIL import Image
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public/assets/worn")

CELL = 32
# Высота шлема в ячейке. У готовых шлемов фас 16..19 px при голове героя в 15:
# 20 — верхняя граница, на которой шлем ещё сидит на голове, а не проглатывает её.
H_HELM = 20
# Шлем сидит на макушке, а не по центру лица: поднимаем спрайт в ячейке.
# То же число, что в worn-from-icons.py, — иначе новый шлем сядет иначе старых.
HELM_LIFT = -2

# id предмета -> папка с ракурсами и какой файл какому направлению отвечает.
#
# Порядок направлений в полосе задан игрой (DIRS в helm/mount.ts и player.ts):
# вниз (фас), влево, вправо, спина. Номера файлов — авторские, соответствие
# проверено глазом: на 1 прорезь смотрит вправо, на 2 влево, 3 — затылок с
# плюмажем, 4 — анфас с Т-образной прорезью.
VIEWS = {
    "phoenix_helm": {
        "dir": "public/assets/armor-icons/Новая папка",
        "files": {"down": "sprite-1-4.png", "left": "sprite-1-2.png",
                  "right": "sprite-1-1.png", "up": "sprite-1-3.png"},
    },
    # Раскладка сеткой 2x2: верхний ряд — фас и спина, нижний — профили.
    # Фас и спина опознаны по силуэту (самосимметричны на 96-97%), профили —
    # зеркальны друг другу на 95.5%. А вот какой профиль куда смотрит, по
    # пикселям не определяется: художник светит все ракурсы с одной стороны,
    # поэтому блик остаётся слева даже на зеркальной геометрии, и все замеры
    # врут. Сторону назвал автор.
    "ember_helm": {
        "dir": "public/assets/armor-icons/Icons_6_07",
        "files": {"down": "sprite-1-1.png", "left": "sprite-2-1.png",
                  "right": "sprite-2-2.png", "up": "sprite-1-2.png"},
    },
}

DIRS = ("down", "left", "right", "up")


def scaled(src, height):
    """Ужать до нужной высоты, сохранив пропорции, и убрать полупрозрачные края."""
    bb = src.getbbox()
    core = src.crop(bb) if bb else src
    k = height / core.height
    small = core.resize((max(1, round(core.width * k)), height), Image.LANCZOS)

    # Пиксель-арт не терпит полупрозрачных краёв: край либо есть, либо нет.
    # Исходники сглаженные, без этого шаг шлем получил бы мыльную кайму.
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a > 110 else 0)
    return small


def build(item_id, spec):
    # Исходников может не быть: художник унёс папку, а собранный спрайт остался
    # лежать в worn/ и прекрасно работает. Молчать об этом нельзя (пересобрать
    # уже нечем), но и падать не за чем — остальные шлемы должны собраться.
    missing = [f for f in spec["files"].values()
               if not os.path.exists(os.path.join(ROOT, spec["dir"], f))]
    if missing:
        print(f"  {item_id}: ПРОПУЩЕН — нет исходников в {spec['dir']} ({', '.join(missing)})")
        return

    strip = Image.new("RGBA", (CELL * 4, CELL), (0, 0, 0, 0))
    sizes = []

    for i, d in enumerate(DIRS):
        path = os.path.join(ROOT, spec["dir"], spec["files"][d])
        piece = scaled(Image.open(path).convert("RGBA"), H_HELM)
        sizes.append(f"{d} {piece.width}x{piece.height}")

        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cell.paste(piece, ((CELL - piece.width) // 2,
                           (CELL - piece.height) // 2 + HELM_LIFT), piece)
        strip.paste(cell, (i * CELL, 0))

    strip.save(os.path.join(OUT, f"{item_id}.png"))
    print(f"  {item_id}: " + ", ".join(sizes))


os.makedirs(OUT, exist_ok=True)
for item_id, spec in VIEWS.items():
    build(item_id, spec)

# Манифест перечисляет ВСЕ спрайты папки, а не только собранные здесь: игра
# читает его, чтобы знать, у какого предмета есть надетый вид.
ids = sorted(f[:-4] for f in os.listdir(OUT) if f.endswith(".png"))
with open(os.path.join(OUT, "manifest.json"), "w") as f:
    f.write(json.dumps(ids, indent=1) + "\n")
print(f"\nманифест: {len(ids)} спрайтов")
