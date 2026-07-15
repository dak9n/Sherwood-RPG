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
}

/**
 * Меняет размер карты, добавляя или срезая тайлы с каждой стороны.
 * Отрицательная дельта режет карту с этой стороны.
 *
 * Функция чистая: исходная карта не меняется, а dropped известен до того,
 * как что-то применено, — иначе вопрос «потерять N тайлов?» задавался бы
 * пользователю уже после потери.
 *
 * Данные слоя — плоский массив построчно, поэтому при смене ширины нельзя
 * просто дополнить его нулями с конца: строки разъедут карту по диагонали.
 * Каждый тайл пересчитывается по координатам.
 */
export function resizeMap(map: GameMap, deltas: Deltas): ResizeResult {
  const { left, right, top, bottom } = deltas;
  const width = map.width + left + right;
  const height = map.height + top + bottom;

  if (width <= 0 || height <= 0) {
    throw new Error(`после изменения карта была бы ${width}x${height}`);
  }

  const droppedByLayer: Record<string, number> = {};
  let dropped = 0;

  const layers = map.layers.map((layer) => {
    const data = new Array<number>(width * height).fill(0);
    let lost = 0;

    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i];
      if (!raw) continue;

      const x = (i % map.width) + left;
      const y = Math.floor(i / map.width) + top;

      if (x >= 0 && x < width && y >= 0 && y < height) {
        // Значение копируется дословно — флаги отражения в старших битах
        // переживают перенос сами собой.
        data[y * width + x] = raw;
      } else {
        lost++;
      }
    }

    if (lost) {
      droppedByLayer[layer.name] = lost;
      dropped += lost;
    }
    return { ...layer, data };
  });

  return {
    map: { ...map, width, height, layers },
    dropped,
    droppedByLayer,
  };
}
