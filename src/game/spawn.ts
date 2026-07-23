import type { MapDoc } from '../map/doc';

const GID_MASK = 0x1fffffff;

/**
 * Тайлсеты, которыми нарисована земля и вода.
 *
 * `Water_coasts` вопреки имени — ЗЕМЛЯ с водяной каймой: им нарисовано 1368
 * клеток слоя main_space, то есть почти вся суша. Пометить его водой — отправить
 * пауков плавать.
 *
 * Смотрим на тайлсеты, а не на имена слоёв: имена правит пользователь, «Слой 27»
 * в карте уже есть.
 */
const LAND = new Set(['Ground_grass', 'Water_coasts', 'spots', 'spots_rock', 'stairs_grass']);
const WATER = new Set(['Water_detilazation', 'Water_detilazation2', 'water_lilis']);

/**
 * Клетки суши.
 *
 * Слой воды залит фоном под всей картой, а земля нарисована поверх и прорезает
 * в ней водоёмы. Поэтому «есть водяной тайл» ничего не значит — важно, что
 * лежит СВЕРХУ: если земляной слой выше водяного, это берег, а не пруд.
 */
export function landCells(doc: MapDoc): Set<number> {
  const ranges = doc.map.tilesets.map((ts) => ({
    name: ts.name,
    from: ts.firstId,
    to: ts.firstId + ts.tileCount - 1,
  }));

  const tilesetOf = (raw: number): string | null => {
    const gid = raw & GID_MASK;
    for (const r of ranges) if (gid >= r.from && gid <= r.to) return r.name;
    return null;
  };

  const cells = new Set<number>();

  for (let i = 0; i < doc.width * doc.height; i++) {
    let topLand = -1;
    let topWater = -1;

    for (let li = 0; li < doc.layers.length; li++) {
      const raw = doc.layers[li].data[i];
      if (!raw) continue;
      const ts = tilesetOf(raw);
      if (!ts) continue;
      if (LAND.has(ts)) topLand = li;
      else if (WATER.has(ts)) topWater = li;
    }

    if (topLand > topWater && topLand !== -1) cells.add(i);
  }

  return cells;
}

/** Оставляет только самый большой связный кусок суши: на островке паук недостижим. */
export function largestArea(cells: Set<number>, width: number): Set<number> {
  const seen = new Set<number>();
  let best = new Set<number>();

  for (const start of cells) {
    if (seen.has(start)) continue;

    const area = new Set<number>();
    const queue = [start];
    seen.add(start);

    while (queue.length) {
      const i = queue.pop()!;
      area.add(i);

      const x = i % width;
      const y = Math.floor(i / width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width) continue;
        const ni = ny * width + nx;
        if (!cells.has(ni) || seen.has(ni)) continue;
        seen.add(ni);
        queue.push(ni);
      }
    }

    if (area.size > best.size) best = area;
  }

  return best;
}

export interface SpawnPoint {
  kind: string;
  x: number;
  y: number;
}

/** kind у маркера точки старта игрока. Совпадает с редактором. */
export const PLAYER_KIND = 'player';

/**
 * Точка старта игрока из маркеров карты — в ПИКСЕЛЯХ (центр клетки), или null,
 * если маркера нет. Тогда игра ставит игрока по-старому, в центр нарисованного.
 * Берём первый: player-маркер в карте осмыслен один (за этим следит редактор).
 */
export function mapPlayerStart(doc: MapDoc): { x: number; y: number } | null {
  const sp = doc.map.spawns?.find((s) => s.kind === PLAYER_KIND);
  if (!sp) return null;
  const tw = doc.map.tileWidth;
  const th = doc.map.tileHeight;
  return { x: sp.x * tw + tw / 2, y: sp.y * th + th / 2 };
}

/**
 * Точки спавна монстров и боссов из маркеров карты — в ПИКСЕЛЯХ (центр клетки).
 *
 * Player-маркер сюда не попадает, это не существо. Пустой список означает «в
 * карте маркеров монстров нет» — тогда сцена расселяет их по-старому, случайно
 * вокруг игрока. Так карта без разметки играется как раньше.
 */
export function mapMobSpawns(doc: MapDoc): SpawnPoint[] {
  const tw = doc.map.tileWidth;
  const th = doc.map.tileHeight;
  return (doc.map.spawns ?? [])
    .filter((s) => s.kind !== PLAYER_KIND)
    .map((s) => ({ kind: s.kind, x: s.x * tw + tw / 2, y: s.y * th + th / 2 }));
}

/**
 * Расселяет монстров по суше вокруг игрока.
 *
 * @param near ближе этого к игроку не селим — первые секунды без драки
 * @param far дальше этого не селим, иначе их никто не найдёт
 */
/**
 * Где поставить боссов.
 *
 * Отдельно от pickSpawns по двум причинам.
 *
 * Первая — размер. Голем нарисован шириной в три тайла. Поставить его в
 * случайную проходимую клетку между двух деревьев значит запереть его там
 * навсегда: поводок будет тянуть домой сквозь ствол, а тело не пролезет.
 * Поэтому клетка обязана иметь ЗАПАС чистой земли вокруг (clearance клеток во
 * все стороны), а не просто быть проходимой сама по себе.
 *
 * Вторая — встреча должна быть событием. Боссов трое на всю карту, и случай
 * слишком охотно ставил бы их всех в одну рощу у самого старта. Поэтому не
 * случайно: берём самые дальние подходящие поляны, разнесённые между собой.
 * До босса надо дойти.
 *
 * Если полян с запрошенным запасом на карте не набирается, запас ужимается
 * шаг за шагом: лучше поставить босса на тесную поляну, чем не поставить.
 */
export function pickBossSpawns(
  doc: MapDoc,
  blocked: Set<number>,
  wanted: { kind: string; count: number }[],
  player: { x: number; y: number },
  clearance = 3,
  minApart = 200,
): SpawnPoint[] {
  const land = largestArea(landCells(doc), doc.width);
  const tw = doc.map.tileWidth;
  const th = doc.map.tileHeight;
  const total = wanted.reduce((n, w) => n + w.count, 0);

  /** Свободен ли квадрат (2r+1)x(2r+1) вокруг клетки. */
  const isClear = (i: number, r: number): boolean => {
    const cx = i % doc.width;
    const cy = Math.floor(i / doc.width);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= doc.width || ny >= doc.height) return false;
        const ni = ny * doc.width + nx;
        if (blocked.has(ni) || !land.has(ni)) return false;
      }
    }
    return true;
  };

  let spots: { x: number; y: number }[] = [];
  for (let r = clearance; r >= 1; r--) {
    spots = [];
    for (const i of land) {
      if (blocked.has(i) || !isClear(i, r)) continue;
      spots.push({
        x: (i % doc.width) * tw + tw / 2,
        y: Math.floor(i / doc.width) * th + th / 2,
      });
    }
    if (spots.length >= total) break;
  }

  // Самые дальние от игрока — первыми: до босса надо идти.
  spots.sort(
    (a, b) => Math.hypot(b.x - player.x, b.y - player.y) - Math.hypot(a.x - player.x, a.y - player.y),
  );

  const points: SpawnPoint[] = [];
  const taken: { x: number; y: number }[] = [];

  for (const { kind, count } of wanted) {
    for (let n = 0; n < count; n++) {
      // Первая поляна, до которой от уже занятых не меньше minApart. Сама точка
      // от себя на нуле, поэтому дважды одна и та же не возьмётся.
      const spot = spots.find((s) => taken.every((t) => Math.hypot(t.x - s.x, t.y - s.y) >= minApart));
      if (!spot) return points;
      taken.push(spot);
      points.push({ kind, x: spot.x, y: spot.y });
    }
  }

  return points;
}

export function pickSpawns(
  doc: MapDoc,
  blocked: Set<number>,
  wanted: { kind: string; count: number }[],
  player: { x: number; y: number },
  rng: () => number = Math.random,
  near = 60,
  far = 260,
): SpawnPoint[] {
  const land = largestArea(landCells(doc), doc.width);
  const tw = doc.map.tileWidth;
  const th = doc.map.tileHeight;

  const candidates: number[] = [];
  for (const i of land) {
    if (blocked.has(i)) continue; // под деревом не селим

    const x = (i % doc.width) * tw + tw / 2;
    const y = Math.floor(i / doc.width) * th + th / 2;
    const d = Math.hypot(x - player.x, y - player.y);
    if (d < near || d > far) continue;

    candidates.push(i);
  }

  const points: SpawnPoint[] = [];
  const taken: { x: number; y: number }[] = [];

  for (const { kind, count } of wanted) {
    for (let n = 0; n < count; n++) {
      // Ищем место, не занятое соседом: иначе пауки слипнутся в кучу.
      for (let tries = 0; tries < 40 && candidates.length; tries++) {
        const pick = Math.floor(rng() * candidates.length);
        const i = candidates[pick];
        const x = (i % doc.width) * tw + tw / 2;
        const y = Math.floor(i / doc.width) * th + th / 2;

        if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < 24)) continue;

        candidates.splice(pick, 1);
        taken.push({ x, y });
        points.push({ kind, x, y });
        break;
      }
    }
  }

  return points;
}
