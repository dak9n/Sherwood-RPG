import type { MapDoc } from '../map/doc';

/**
 * Начиная с какой высоты объект считается большим — за такими игрок прячется.
 *
 * На карте это разделяет чисто: деревья 4-12 тайлов высотой (23 штуки), камни,
 * пни и грибы — 1-3 (49 штук). Тростник тоже лежит в тайлсете объектов, но он
 * низкий и в высокие не попадает — по нему игрок ходит поверху.
 */
const MIN_TALL_HEIGHT = 4;

/** Тайлсет, которым нарисованы объекты. По нему их и находим: имена слоёв — пользовательский ввод. */
const OBJECT_TILESET = 'Objects';

const GID_MASK = 0x1fffffff;

/**
 * Ищет большие объекты (деревья) и запоминает, где у каждого низ.
 *
 * Ключ — номер клетки, значение — Y нижнего края дерева в пикселях. Игрок,
 * зашедший в такую клетку выше этой линии, рисуется за деревом; ниже — перед ним.
 *
 * @returns карта «клетка -> низ дерева в пикселях»
 */
export function findTallObjects(doc: MapDoc): Map<number, number> {
  const result = new Map<number, number>();

  const tileset = doc.map.tilesets.find((t) => t.name === OBJECT_TILESET);
  if (!tileset) return result;

  const from = tileset.firstId;
  const to = tileset.firstId + tileset.tileCount - 1;
  const isObject = (raw: number): boolean => {
    const gid = raw & GID_MASK;
    return gid >= from && gid <= to;
  };

  const th = doc.map.tileHeight;

  for (let li = 0; li < doc.layers.length; li++) {
    const data = doc.layers[li].data;
    const seen = new Set<number>();

    for (let start = 0; start < data.length; start++) {
      if (!data[start] || seen.has(start) || !isObject(data[start])) continue;

      // Обход связных клеток объекта — тот же принцип, что у пипетки в редакторе.
      const cells: number[] = [];
      const queue = [start];
      seen.add(start);

      while (queue.length) {
        const i = queue.pop()!;
        cells.push(i);

        const x = i % doc.width;
        const y = Math.floor(i / doc.width);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= doc.width || ny >= doc.height) continue;

          const ni = ny * doc.width + nx;
          if (seen.has(ni) || !data[ni] || !isObject(data[ni])) continue;
          seen.add(ni);
          queue.push(ni);
        }
      }

      let minY = Infinity;
      let maxY = -Infinity;
      for (const i of cells) {
        const y = Math.floor(i / doc.width);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }

      if (maxY - minY + 1 < MIN_TALL_HEIGHT) continue;

      // Низ дерева: игрок ниже этой линии стоит перед ним, выше — за ним.
      const baseY = (maxY + 1) * th;
      for (const i of cells) {
        // Клетка может принадлежать деревьям на разных слоях — берём нижнее,
        // иначе игрок нырнёт за дальнее дерево, стоя перед ближним.
        result.set(i, Math.max(result.get(i) ?? 0, baseY));
      }
    }
  }

  return result;
}
