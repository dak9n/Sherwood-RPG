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

from PIL import Image, ImageEnhance
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
# вниз (фас), влево, вправо, спина=затылок.
#
# Шлемы helm1..helm6 — художник назвал ракурсы по-человечески: front/back/left/
# right, раскладка одна на всех. Больше шлемов появится позже — диапазон здесь
# и вырастет. Прежние именные шлемы (phoenix/ember и комплекты брони) из игры
# убраны, поэтому их записей тут больше нет.
VIEWS = {
    f"helm{n}": {
        "dir": f"public/assets/armor-icons/helm{n}",
        "files": {"down": "front.png", "left": "left.png",
                  "right": "right.png", "up": "back.png"},
    }
    for n in range(1, 7)
}

# Комплект Vanguard — нарезан из new-armor/armor1.png (4 ракурса на вещь).
#
# Параметры подобраны ПО КОМПОЗИТУ НА ГЕРОЕ (см. историю): арт комплекта
# вытянут вертикально, и на стандартной высоте 20 шлем упирался в кирасу —
# герой превращался в золотой столб. Шлем 18 с посадкой -3: накрывает причёску
# (иначе маска волос вырезала бы полголовы), но между ним и кирасой остаётся
# просвет. Кираса обрезана до торса (crop 0.5 — юбка до колен на герое ростом
# в 20px заливала ноги) и уже (14/11) — по бокам выглядывают руки.
VIEWS["vanguard_helm"] = {
    "dir": "public/assets/armor-icons/vanguard_helm",
    "files": {"down": "front.png", "left": "left.png",
              "right": "right.png", "up": "back.png"},
    "height": 16, "lift": -4, "stylize": True,
}
VIEWS["vanguard_chest"] = {
    "dir": "public/assets/armor-icons/vanguard_chest",
    "files": {"down": "front.png", "left": "left.png",
              "right": "right.png", "up": "back.png"},
    # По ВЫСОТЕ (13 — торс с ремнём, не блин), ширина капится подрезкой боков:
    # арт после обрезки юбки шире торса героя, и нормировка по ширине его
    # сплющивала (14x9). maxw держит панцирь в силуэте, руки видны.
    "kind": "chest", "crop": 0.6, "chest_h": 13,
    "maxw": {"down": 14, "left": 11, "right": 11, "up": 14},
    "stylize": True,
}

DIRS = ("down", "left", "right", "up")


def stylize(img, colors=10, sat=1.25, con=1.15):
    """Из мыла — в пиксель-арт: плоские тона, сочность, тёмная кромка.

    Ужатый в дюжину пикселей детальный арт превращается в шум: сотня цветов,
    ни одной читаемой зоны. Рисованные руками спрайты живут наоборот — крупными
    плоскими тонами и тёмным краем. Квантизация склеивает шум в зоны, лёгкий
    подъём насыщенности возвращает цвет, съеденный усреднением, а затемнённая
    кромка отделяет силуэт от героя и травы — как обводка у художника.
    Только для машинных нарезок: рисованное руками стилизовать нечего.
    """
    rgb = img.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(sat)
    rgb = ImageEnhance.Contrast(rgb).enhance(con)
    q = rgb.quantize(colors, method=Image.MEDIANCUT).convert("RGB")
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    a = img.getchannel("A").load()
    qp = q.load()
    op = out.load()
    for y in range(img.height):
        for x in range(img.width):
            if a[x, y] == 0:
                continue
            r, g, b = qp[x, y]
            edge = any(
                xx < 0 or yy < 0 or xx >= img.width or yy >= img.height or a[xx, yy] == 0
                for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
            if edge:
                r, g, b = int(r * 0.45), int(g * 0.45), int(b * 0.45)
            op[x, y] = (r, g, b, 255)
    return out


def scaled(src, height=None, width=None):
    """Ужать до высоты ИЛИ ширины, сохранив пропорции, и убрать полупрозрачные края."""
    bb = src.getbbox()
    core = src.crop(bb) if bb else src
    k = (height / core.height) if height else (width / core.width)
    small = core.resize((max(1, round(core.width * k)), max(1, round(core.height * k))), Image.LANCZOS)

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
    chest = spec.get("kind") == "chest"
    # Нагрудник: ширины фас/бок как у worn-from-icons.py, посадка по центру.
    chest_widths = spec.get("widths", {"down": 16, "left": 12, "right": 12, "up": 16})

    for i, d in enumerate(DIRS):
        path = os.path.join(ROOT, spec["dir"], spec["files"][d])
        src = Image.open(path).convert("RGBA")
        # crop — верхняя доля арта: длиннополый доспех обрезается до торса,
        # иначе на герое он заливает и ноги.
        if "crop" in spec:
            src = src.crop((0, 0, src.width, round(src.height * spec["crop"])))
        if chest and "chest_h" in spec:
            # По высоте, широкое — подрезаем бока по центру (см. VIEWS Vanguard).
            piece = scaled(src, height=spec["chest_h"])
            maxw = spec["maxw"][d]
            if piece.width > maxw:
                x0 = (piece.width - maxw) // 2
                piece = piece.crop((x0, 0, x0 + maxw, piece.height))
        elif chest:
            piece = scaled(src, width=chest_widths[d])
        else:
            piece = scaled(src, height=spec.get("height", H_HELM))
        if spec.get("stylize"):
            piece = stylize(piece)
        sizes.append(f"{d} {piece.width}x{piece.height}")

        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cell.paste(piece, ((CELL - piece.width) // 2,
                           (CELL - piece.height) // 2 + (0 if chest else spec.get("lift", HELM_LIFT))), piece)
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
