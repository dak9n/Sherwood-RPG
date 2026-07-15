import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeMap } from './resize.ts';
import type { GameMap } from './types.ts';

/** Карта 3x2 с узнаваемыми числами: 1 2 3 / 4 5 6 */
function makeMap(): GameMap {
  return {
    version: 1,
    width: 3,
    height: 2,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      {
        name: 't',
        image: 't.png',
        imageWidth: 16,
        imageHeight: 16,
        columns: 1,
        tileCount: 100,
        firstId: 1,
        animations: {},
      },
    ],
    layers: [{ name: 'a', visible: true, data: [1, 2, 3, 4, 5, 6] }],
  };
}

/** Что лежит в клетке (x, y). */
function at(map: GameMap, layer: number, x: number, y: number): number {
  return map.layers[layer].data[y * map.width + x];
}

test('рост вправо и вниз не двигает существующие тайлы', () => {
  const { map, dropped } = resizeMap(makeMap(), { left: 0, right: 2, top: 0, bottom: 1 });

  assert.equal(map.width, 5);
  assert.equal(map.height, 3);
  assert.equal(dropped, 0);
  assert.equal(map.layers[0].data.length, 15);

  assert.equal(at(map, 0, 0, 0), 1);
  assert.equal(at(map, 0, 2, 0), 3);
  assert.equal(at(map, 0, 0, 1), 4);
  assert.equal(at(map, 0, 2, 1), 6);
  assert.equal(at(map, 0, 3, 0), 0);
  assert.equal(at(map, 0, 0, 2), 0);
});

test('рост влево и вверх сдвигает тайлы, а не сыплет их по диагонали', () => {
  const { map, dropped } = resizeMap(makeMap(), { left: 1, right: 0, top: 2, bottom: 0 });

  assert.equal(map.width, 4);
  assert.equal(map.height, 4);
  assert.equal(dropped, 0);

  // Строка 1 2 3 должна целиком уехать на (1,2)..(3,2), оставшись строкой.
  assert.equal(at(map, 0, 1, 2), 1);
  assert.equal(at(map, 0, 2, 2), 2);
  assert.equal(at(map, 0, 3, 2), 3);
  assert.equal(at(map, 0, 1, 3), 4);
  assert.equal(at(map, 0, 3, 3), 6);

  assert.equal(at(map, 0, 0, 0), 0);
  assert.equal(at(map, 0, 0, 2), 0);
});

test('обрезка считает потерянные тайлы до применения', () => {
  const before = makeMap();
  const { map, dropped, droppedByLayer } = resizeMap(before, { left: -1, right: 0, top: 0, bottom: 0 });

  assert.equal(map.width, 2);
  assert.equal(dropped, 2); // столбец 1 и 4
  assert.deepEqual(droppedByLayer, { a: 2 });

  assert.equal(at(map, 0, 0, 0), 2);
  assert.equal(at(map, 0, 1, 0), 3);
  assert.equal(at(map, 0, 0, 1), 5);

  // исходная карта не тронута
  assert.deepEqual(before.layers[0].data, [1, 2, 3, 4, 5, 6]);
  assert.equal(before.width, 3);
});

test('флаги отражения в старших битах переживают перенос', () => {
  const src = makeMap();
  const flagged = (0x80000000 | 7) >>> 0; // 2147483655
  src.layers[0].data[0] = flagged;

  const { map } = resizeMap(src, { left: 2, right: 0, top: 1, bottom: 0 });

  assert.equal(at(map, 0, 2, 1), flagged);
  assert.ok(at(map, 0, 2, 1) > 0, 'значение не должно уехать в минус');
});

test('карта в ноль и меньше — ошибка, а не пустая карта', () => {
  assert.throws(() => resizeMap(makeMap(), { left: -3, right: 0, top: 0, bottom: 0 }), /3x2|0x2/);
});

test('пустые клетки не считаются потерянными', () => {
  const src = makeMap();
  src.layers[0].data = [0, 0, 0, 4, 5, 6];
  const { dropped } = resizeMap(src, { left: 0, right: 0, top: -1, bottom: 0 });
  assert.equal(dropped, 0);
});
