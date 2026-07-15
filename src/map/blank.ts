import type { GameMap, Layer, Tileset } from './types';

export interface BlankMapOptions {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  /** Тайлсеты берём из существующей карты (обычно forest) — иначе рисовать нечем. */
  tilesets: Tileset[];
  layerName?: string;
}

/**
 * Строит пустую карту заданного размера, годную для validateMap. Чистая: тайлсеты
 * глубоко копирует (structuredClone), чтобы новая карта не делила объекты с
 * шаблоном — иначе правка её тайлсетов молча испортила бы forest в памяти.
 *
 * Размер и валидность тайлсетов на входе — забота вызывающего (диалог размера +
 * проверка, что у шаблона вообще есть тайлсеты). Здесь версия/слой/collision
 * гарантированы по построению. Пустой слой собираем на месте, а не через
 * emptyLayer из layers.ts: тесты гоняются через `node --strip-types`, который не
 * резолвит runtime-импорт соседнего модуля без расширения.
 */
export function createBlankMap(opts: BlankMapOptions): GameMap {
  const { width, height, tileWidth, tileHeight, tilesets, layerName = 'Слой 1' } = opts;
  const cells = width * height;
  const layer: Layer = { name: layerName, visible: true, data: new Array<number>(cells).fill(0) };
  return {
    version: 2,
    width,
    height,
    tileWidth,
    tileHeight,
    tilesets: structuredClone(tilesets),
    layers: [layer],
    // 0 — «проходимость не задана»: честный дефолт для пустой карты (см. types.ts).
    collision: new Array<number>(cells).fill(0),
  };
}
