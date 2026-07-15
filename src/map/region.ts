import type { MapDoc } from './doc';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Прямоугольник между двумя клетками — тянуть рамку можно в любую сторону. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x) + 1,
    h: Math.abs(a.y - b.y) + 1,
  };
}

/**
 * Вырезать обведённый кусок слоя как кисть.
 *
 * Нужен, когда объекты соприкасаются и обход связных тайлов забирает соседей:
 * рамкой указывают ровно то дерево, которое нужно. Пустые клетки внутри рамки
 * остаются нулями — кисть не затрёт ими то, на что её положат.
 */
export function extractRect(doc: MapDoc, layerIndex: number, rect: Rect): { raws: number[]; count: number } {
  const raws: number[] = [];
  let count = 0;

  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      // getRaw за границами вернёт 0 — рамку, вылезшую за карту, обрезать не надо.
      const raw = doc.getRaw(layerIndex, rect.x + dx, rect.y + dy);
      raws.push(raw);
      if (raw) count++;
    }
  }
  return { raws, count };
}

export interface Region {
  /** Левый верхний угол найденного объекта в координатах карты. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Прямоугольник w*h: 0 там, где клетка в объект не входит (дырки формы). */
  raws: number[];
  /** Сколько тайлов реально вошло в объект. */
  count: number;
  /** Обход упёрся в предел — объект оказался слишком большим. */
  tooBig: boolean;
}

/**
 * Предел обхода. Дерево на карте — это блок примерно 4x5, самый крупный объект
 * заметно меньше сотни тайлов. Предел нужен для другого случая: на слое травы
 * или воды все тайлы связаны друг с другом, и без него Alt+клик по траве утащил
 * бы в кисть пол-карты.
 */
const MAX_TILES = 400;

/**
 * Находит цельный объект под курсором: обходит связные непустые тайлы слоя,
 * начиная от клетки клика.
 *
 * Связность только по сторонам, без диагоналей: объекты на карте нарисованы
 * плотными блоками, а диагональная связность склеивала бы соседние деревья,
 * задевшие друг друга кронами.
 *
 * Возвращает null, если в клетке пусто. При tooBig объект не возвращается
 * целиком — решать, что делать, должен вызывающий.
 */
export function selectObject(doc: MapDoc, layerIndex: number, x: number, y: number): Region | null {
  if (!doc.inBounds(x, y)) return null;
  if (!doc.getRaw(layerIndex, x, y)) return null;

  const seen = new Set<number>();
  const cells: { x: number; y: number; raw: number }[] = [];
  const queue: { x: number; y: number }[] = [{ x, y }];
  seen.add(doc.index(x, y));

  let tooBig = false;

  while (queue.length) {
    const cell = queue.pop()!;
    const raw = doc.getRaw(layerIndex, cell.x, cell.y);
    cells.push({ ...cell, raw });

    if (cells.length >= MAX_TILES) {
      tooBig = true;
      break;
    }

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!doc.inBounds(nx, ny)) continue;

      const key = doc.index(nx, ny);
      if (seen.has(key)) continue;
      if (!doc.getRaw(layerIndex, nx, ny)) continue;

      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  if (tooBig) {
    return { x0: x, y0: y, w: 1, h: 1, raws: [doc.getRaw(layerIndex, x, y)], count: cells.length, tooBig: true };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const raws = new Array<number>(w * h).fill(0);
  for (const c of cells) {
    // Значение копируется дословно — флаги поворота едут вместе с тайлом.
    raws[(c.y - minY) * w + (c.x - minX)] = c.raw;
  }

  return { x0: minX, y0: minY, w, h, raws, count: cells.length, tooBig: false };
}
