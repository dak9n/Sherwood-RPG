import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTallObjects } from './tall-objects.ts';
import { MapDoc } from '../map/doc.ts';
import type { GameMap } from '../map/types.ts';

const OBJ = 100; // номер тайла внутри тайлсета Objects (firstId = 50)
const GRASS = 10; // тайл из другого тайлсета

/**
 * Карта из картинок слоёв: '#' — тайл объектов, 'g' — трава, '.' — пусто.
 */
function docFrom(layers: string[][]): MapDoc {
  const width = layers[0][0].length;
  const height = layers[0].length;

  const map: GameMap = {
    version: 2,
    width,
    height,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      { name: 'Ground_grass', image: 'g.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 40, firstId: 1, animations: {} },
      { name: 'Objects', image: 'o.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 50, animations: {} },
    ],
    layers: layers.map((rows, i) => ({
      name: `layer${i}`,
      visible: true,
      data: rows.flatMap((row) => [...row].map((ch) => (ch === '#' ? OBJ : ch === 'g' ? GRASS : 0))),
    })),
    collision: new Array(width * height).fill(1),
  };
  return new MapDoc(map);
}

test('дерево в 4 тайла высотой — большое, за ним прячемся', () => {
  const doc = docFrom([[
    '.##.',
    '.##.',
    '.##.',
    '.##.',
  ]]);
  const tall = findTallObjects(doc);

  assert.equal(tall.size, 8, 'все 8 клеток дерева попали в карту');
  // низ дерева — нижний край четвёртого ряда
  assert.equal(tall.get(0 * 4 + 1), 64);
});

test('камень в 3 тайла — не большой, игрок идёт поверху', () => {
  const doc = docFrom([[
    '.##.',
    '.##.',
    '.##.',
    '....',
  ]]);
  assert.equal(findTallObjects(doc).size, 0);
});

test('трава и прочие тайлсеты за деревья не считаются', () => {
  const doc = docFrom([[
    'gggg',
    'gggg',
    'gggg',
    'gggg',
  ]]);
  assert.equal(findTallObjects(doc).size, 0);
});

test('два дерева рядом, но не касаются — каждое со своим низом', () => {
  const doc = docFrom([[
    '#.#.',
    '#.#.',
    '#.#.',
    '#...',
    '#...',
  ]]);
  const tall = findTallObjects(doc);

  // левое дерево 5 клеток высотой -> низ 80; правое 3 -> не большое
  assert.equal(tall.get(0), 80);
  assert.equal(tall.get(2), undefined, 'дерево в 3 тайла не большое');
});

test('низ берётся нижний, если клетку накрывают деревья с разных слоёв', () => {
  const doc = docFrom([
    ['.#..', '.#..', '.#..', '.#..'], // дерево пониже: низ 64
    ['.#..', '.#..', '.#..', '.#..'], // и ещё одно там же
  ]);
  const tall = findTallObjects(doc);
  assert.equal(tall.get(1), 64);
});

test('пустая карта не ломает поиск', () => {
  const doc = docFrom([['....', '....']]);
  assert.equal(findTallObjects(doc).size, 0);
});
