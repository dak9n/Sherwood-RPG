import type { GameMap } from './types';

export interface Deltas {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ResizeResult {
  map: GameMap;
  /** Сколько непустых тайлов не влезло в новые границы. */
  dropped: number;
  droppedByLayer: Record<string, number>;
  /**
   * Сколько маркеров спавна не влезло в новые границы. Считаем отдельно от
   * тайлов: маркер может вылезти за край даже там, где тайлов не терялось (срез
   * пустой полосы), а потеря точки старта или босса невосстановима — история
   * после ресайза очищается. Диалог обязан предупредить именно об этом.
   */
  droppedSpawns: number;
}

/**
 * Переносит плоскую сетку width*height в новые границы.
 *
 * Данные лежат построчно, поэтому при смене ширины нельзя просто дополнить их
 * нулями с конца: строки разъедут карту по диагонали. Каждая клетка
 * пересчитывается по координатам.
 *
 * Новые клетки получают 0. Для слоя это «пусто», для проходимости — «не задано»,
 * то есть стена: на дорисованную траву игрок не зайдёт, пока её не разметят.
 *
 * @returns новая сетка и сколько ненулевых значений не влезло
 */
export function remapGrid(
  data: number[],
  oldWidth: number,
  width: number,
  height: number,
  left: number,
  top: number,
): { data: number[]; dropped: number } {
  const out = new Array<number>(width * height).fill(0);
  let dropped = 0;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (!value) continue;

    const x = (i % oldWidth) + left;
    const y = Math.floor(i / oldWidth) + top;

    if (x >= 0 && x < width && y >= 0 && y < height) {
      // Значение копируется дословно — флаги отражения в старших битах
      // переживают перенос сами собой.
      out[y * width + x] = value;
    } else {
      dropped++;
    }
  }

  return { data: out, dropped };
}

/**
 * Меняет размер карты, добавляя или срезая тайлы с каждой стороны.
 * Отрицательная дельта режет карту с этой стороны.
 *
 * Функция чистая: исходная карта не меняется, а dropped известен до того,
 * как что-то применено, — иначе вопрос «потерять N тайлов?» задавался бы
 * пользователю уже после потери.
 */
export function resizeMap(map: GameMap, deltas: Deltas): ResizeResult {
  const { left, right, top, bottom } = deltas;
  const width = map.width + left + right;
  const height = map.height + top + bottom;

  if (width <= 0 || height <= 0) {
    throw new Error(`after resizing the map would be ${width}x${height}`);
  }

  const droppedByLayer: Record<string, number> = {};
  let dropped = 0;

  const layers = map.layers.map((layer) => {
    const res = remapGrid(layer.data, map.width, width, height, left, top);
    if (res.dropped) {
      droppedByLayer[layer.name] = res.dropped;
      dropped += res.dropped;
    }
    return { ...layer, data: res.data };
  });

  // Проходимость едет тем же преобразованием, что и слои: иначе она осталась бы
  // прежней длины, и карта разъехалась бы с разметкой.
  const collision = remapGrid(map.collision, map.width, width, height, left, top).data;

  // Маркеры спавна тоже сдвигаем на дельту: без этого `...map` унёс бы их со
  // старыми координатами — при срезе слева/сверху точка старта уехала бы в
  // сторону, а при обрезке вылезла бы за край и завалила валидацию. Что не
  // влезло в новые границы — отбрасываем, как и тайлы.
  const spawns = map.spawns
    ?.map((s) => ({ ...s, x: s.x + left, y: s.y + top }))
    .filter((s) => s.x >= 0 && s.x < width && s.y >= 0 && s.y < height);
  const droppedSpawns = (map.spawns?.length ?? 0) - (spawns?.length ?? 0);

  return {
    map: { ...map, width, height, layers, collision, spawns: spawns?.length ? spawns : undefined },
    dropped,
    droppedByLayer,
    droppedSpawns,
  };
}
