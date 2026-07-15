import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectObject, extractRect, rectBetween } from './region.ts';
import { MapDoc } from './doc.ts';
import type { GameMap } from './types.ts';

/**
 * Карта строится из картинки: '.' — пусто, любой другой символ — тайл.
 * Номер тайла берётся из позиции, чтобы можно было проверить, что взяли именно те клетки.
 */
function docFrom(rows: string[]): MapDoc {
  const width = rows[0].length;
  const height = rows.length;
  const data = rows.flatMap((row, y) => [...row].map((ch, x) => (ch === '.' ? 0 : 100 + y * width + x)));

  const map: GameMap = {
    version: 1,
    width,
    height,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      { name: 't', image: 't.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 10000, firstId: 1, animations: {} },
    ],
    layers: [{ name: 'objects', visible: true, data }],
  };
  return new MapDoc(map);
}

test('дерево берётся целиком, а не одной клеткой', () => {
  const doc = docFrom([
    '.....',
    '.###.',
    '.###.',
    '..#..',
    '.....',
  ]);
  const r = selectObject(doc, 0, 2, 1)!;

  assert.equal(r.count, 7);
  assert.equal(r.w, 3);
  assert.equal(r.h, 3);
  assert.deepEqual([r.x0, r.y0], [1, 1]);
  assert.equal(r.tooBig, false);
});

test('форма объекта сохраняется: дырки остаются нулями', () => {
  const doc = docFrom([
    '.....',
    '.###.',
    '.###.',
    '..#..',
    '.....',
  ]);
  const r = selectObject(doc, 0, 2, 1)!;

  // нижний ряд ствола: занята только середина
  assert.equal(r.raws[2 * 3 + 0], 0);
  assert.notEqual(r.raws[2 * 3 + 1], 0);
  assert.equal(r.raws[2 * 3 + 2], 0);
});

test('соседнее дерево не прилипает, если не касается', () => {
  const doc = docFrom([
    '##.##',
    '##.##',
    '.....',
  ]);
  const left = selectObject(doc, 0, 0, 0)!;
  const right = selectObject(doc, 0, 3, 0)!;

  assert.equal(left.count, 4);
  assert.equal(right.count, 4);
  assert.equal(left.x0, 0);
  assert.equal(right.x0, 3);
});

test('касание по диагонали не склеивает объекты', () => {
  const doc = docFrom([
    '##..',
    '##..',
    '..##',
    '..##',
  ]);
  const r = selectObject(doc, 0, 0, 0)!;
  // без этого Alt+клик по одному дереву забирал бы и соседнее
  assert.equal(r.count, 4);
  assert.equal(r.w, 2);
  assert.equal(r.h, 2);
});

test('в пустой клетке брать нечего', () => {
  const doc = docFrom(['.#.', '...']);
  assert.equal(selectObject(doc, 0, 0, 0), null);
});

test('одинокий тайл — это объект из одной клетки', () => {
  const doc = docFrom(['.#.', '...']);
  const r = selectObject(doc, 0, 1, 0)!;
  assert.equal(r.count, 1);
  assert.deepEqual([r.w, r.h], [1, 1]);
});

test('сплошная заливка не утаскивает пол-карты в кисть', () => {
  // слой травы: всё связано со всем
  const doc = docFrom(Array.from({ length: 30 }, () => '#'.repeat(30)));
  const r = selectObject(doc, 0, 15, 15)!;

  assert.equal(r.tooBig, true);
  // упёрлись в предел — отдаём одну клетку, а не половину карты
  assert.deepEqual([r.w, r.h], [1, 1]);
  assert.equal(r.raws.length, 1);
});

test('объект у края карты не выходит за границы', () => {
  const doc = docFrom([
    '##.',
    '##.',
  ]);
  const r = selectObject(doc, 0, 0, 0)!;
  assert.equal(r.count, 4);
  assert.deepEqual([r.x0, r.y0, r.w, r.h], [0, 0, 2, 2]);
});

test('флаги поворота едут вместе с объектом', () => {
  const doc = docFrom(['##', '..']);
  const flagged = (0x80000000 | 55) >>> 0;
  doc.setRaw(0, 1, 0, flagged);

  const r = selectObject(doc, 0, 0, 0)!;
  assert.equal(r.raws[1], flagged);
  assert.ok(r.raws[1] > 0, 'значение не должно уехать в минус');
});

// --- выделение рамкой (Alt+протяжка и режим «Выделить») ---

test('рамку можно тянуть в любую сторону', () => {
  const forward = rectBetween({ x: 2, y: 3 }, { x: 5, y: 7 });
  const backward = rectBetween({ x: 5, y: 7 }, { x: 2, y: 3 });

  assert.deepEqual(forward, { x: 2, y: 3, w: 4, h: 5 });
  // тянули справа налево и снизу вверх — рамка та же
  assert.deepEqual(backward, forward);
});

test('рамка в одну клетку — это клик, а не протяжка', () => {
  assert.deepEqual(rectBetween({ x: 4, y: 4 }, { x: 4, y: 4 }), { x: 4, y: 4, w: 1, h: 1 });
});

test('обведённая область берётся вместе с пустотой внутри рамки', () => {
  const doc = docFrom([
    '.....',
    '.#.#.',
    '..#..',
    '.....',
  ]);
  const { raws, count } = extractRect(doc, 0, { x: 1, y: 1, w: 3, h: 2 });

  assert.equal(raws.length, 6);
  assert.equal(count, 3);
  // пустые клетки внутри рамки — нули, ими кисть ничего не затрёт
  assert.equal(raws[1], 0);
  assert.notEqual(raws[0], 0);
  assert.notEqual(raws[2], 0);
});

test('рамка, вылезшая за карту, добирается нулями и не падает', () => {
  const doc = docFrom(['##', '##']);
  const { raws, count } = extractRect(doc, 0, { x: 1, y: 1, w: 3, h: 3 });

  assert.equal(raws.length, 9);
  assert.equal(count, 1); // из карты попала только клетка (1,1)
  assert.equal(raws[0], doc.getRaw(0, 1, 1));
  assert.equal(raws[8], 0);
});

test('обвели пустоту — брать нечего', () => {
  const doc = docFrom(['..', '..']);
  const { count } = extractRect(doc, 0, { x: 0, y: 0, w: 2, h: 2 });
  assert.equal(count, 0);
});

test('рамка берёт значения дословно, вместе с флагами', () => {
  const doc = docFrom(['##', '##']);
  const flagged = (0x80000000 | 7) >>> 0;
  doc.setRaw(0, 1, 1, flagged);

  const { raws } = extractRect(doc, 0, { x: 0, y: 0, w: 2, h: 2 });
  assert.equal(raws[3], flagged);
});
