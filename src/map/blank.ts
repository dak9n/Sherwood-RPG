import type { GameMap, Layer } from './types';

export interface BlankMapOptions {
  width: number;
  height: number;
  tileWidth?: number;
  tileHeight?: number;
  layerName?: string;
}

/**
 * Строит пустую карту заданного размера. Версия 3: тайлсеты в файле не хранятся —
 * их подставит общий каталог (applyCatalog) при загрузке. Поэтому здесь
 * `tilesets: []`; сама по себе такая карта validateMap не пройдёт (нет тайлсетов),
 * но после каталога — пройдёт, а на диск serialize и так пишет v3 без тайлсетов.
 *
 * Размер тайла по умолчанию 16 — как во всём проекте; отдельным аргументом на
 * случай другого набора.
 */
export function createBlankMap(opts: BlankMapOptions): GameMap {
  const { width, height, tileWidth = 16, tileHeight = 16, layerName = 'Слой 1' } = opts;
  const cells = width * height;
  const layer: Layer = { name: layerName, visible: true, data: new Array<number>(cells).fill(0) };
  return {
    version: 3,
    width,
    height,
    tileWidth,
    tileHeight,
    tilesets: [],
    // 0 — «проходимость не задана»: честный дефолт для пустой карты (см. types.ts).
    collision: new Array<number>(cells).fill(0),
    layers: [layer],
  };
}
