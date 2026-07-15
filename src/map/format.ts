import type { GameMap } from './types';

/**
 * Сериализация карты для записи на диск.
 *
 * Обычный JSON.stringify(map) даёт файл в одну строку: git показывает такую правку
 * как «изменилась строка 1» и не может слить две правки вообще. Здесь каждый слой
 * и каждый тайлсет — на своей строке, поэтому git видит, какой именно слой тронули,
 * и правки в разные слои сливаются сами. Стоит это доли процента размера.
 *
 * Обратно читается обычным JSON.parse — свой парсер не нужен.
 */
export function serialize(map: GameMap): string {
  const layers = map.layers.map((l) => '    ' + JSON.stringify(l)).join(',\n');

  return (
    '{\n' +
    // Всегда версия 3: тайлсеты не пишем, они в общем каталоге assets/tilesets.json.
    // Иначе карта унесла бы копию списка, и та начала бы расходиться с каталогом.
    '  "version": 3,\n' +
    `  "width": ${map.width},\n` +
    `  "height": ${map.height},\n` +
    `  "tileWidth": ${map.tileWidth},\n` +
    `  "tileHeight": ${map.tileHeight},\n` +
    '  "layers": [\n' +
    layers +
    '\n  ],\n' +
    // Проходимость — своей строкой, как слои: git покажет её правку отдельно.
    `  "collision": ${JSON.stringify(map.collision)}\n` +
    '}\n'
  );
}
