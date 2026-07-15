import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapDoc } from './doc.ts';
import type { GameMap } from './types.ts';

/** Карта 2x2 с тремя слоями — как в настоящей, где тайл может лежать под другими. */
function makeDoc(): MapDoc {
  const layer = (name: string, data: number[]) => ({ name, visible: true, data });
  const map: GameMap = {
    version: 1,
    width: 2,
    height: 2,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      { name: 't', image: 't.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 1, animations: {} },
    ],
    layers: [
      layer('низ', [10, 0, 0, 0]),
      layer('середина', [20, 21, 0, 0]),
      layer('верх', [30, 0, 0, 0]),
    ],
  };
  return new MapDoc(map);
}

test('пипетка берёт тайл из верхнего непустого слоя', () => {
  const doc = makeDoc();
  // в клетке (0,0) лежат тайлы на всех трёх слоях — брать надо верхний
  assert.equal(doc.topLayerAt(0, 0), 2);
  assert.equal(doc.getRaw(doc.topLayerAt(0, 0), 0, 0), 30);
});

test('пипетка пропускает пустые слои сверху', () => {
  const doc = makeDoc();
  // в (1,0) есть тайл только на среднем слое, верхний там пуст
  assert.equal(doc.topLayerAt(1, 0), 1);
  assert.equal(doc.getRaw(1, 1, 0), 21);
});

test('в пустой клетке пипетке брать нечего', () => {
  const doc = makeDoc();
  assert.equal(doc.topLayerAt(1, 1), -1);
});

test('пипетка берёт значение вместе с флагами поворота', () => {
  const doc = makeDoc();
  const flagged = (0x80000000 | 42) >>> 0;
  doc.setRaw(2, 1, 1, flagged);

  assert.equal(doc.topLayerAt(1, 1), 2);
  // именно raw, а не очищенный номер: иначе поворот потеряется при рисовании
  assert.equal(doc.getRaw(2, 1, 1), flagged);
});

test('за границами карты пипетка ничего не берёт и не падает', () => {
  const doc = makeDoc();
  assert.equal(doc.topLayerAt(-1, 0), -1);
  assert.equal(doc.topLayerAt(0, 99), -1);
  assert.equal(doc.getRaw(0, -5, -5), 0);
});

test('запись за границы игнорируется, а не портит соседнюю строку', () => {
  const doc = makeDoc();
  doc.setRaw(0, 5, 0, 99); // x за пределами ширины 2
  assert.deepEqual(doc.map.layers[0].data, [10, 0, 0, 0]);
});
