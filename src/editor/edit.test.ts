import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToDoc, reverse, type CellEdit } from './edit.ts';
import { MapDoc, UNSET, WALK, BLOCK } from '../map/doc.ts';
import type { GameMap } from '../map/types.ts';

const makeDoc = (): MapDoc =>
  new MapDoc({
    version: 3,
    width: 3,
    height: 2,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [{ firstId: 1, name: 'ts', image: 'ts.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 9, animations: {} }],
    layers: [{ name: 'земля', visible: true, data: new Array(6).fill(0) }],
    collision: new Array(6).fill(UNSET),
  } as GameMap);

test('правка проходимости пишет в collision и НЕ трогает слои', () => {
  // Главная ловушка: 1 и 2 — настоящие номера тайлов. Уйди правка в setRaw —
  // в клетку молча нарисовалась бы вода, и заметили бы это не сразу.
  const doc = makeDoc();
  applyToDoc(doc, { kind: 'pass', x: 1, y: 0, before: UNSET, after: BLOCK });

  assert.equal(doc.getPass(1, 0), BLOCK, 'проходимость записана');
  assert.equal(doc.getRaw(0, 1, 0), 0, 'слой не тронут');
  assert.deepEqual(doc.map.layers[0].data, new Array(6).fill(0), 'ни одна клетка слоя не изменилась');
});

test('правка тайла пишет в слой и НЕ трогает проходимость', () => {
  const doc = makeDoc();
  applyToDoc(doc, { kind: 'tile', layerIndex: 0, x: 2, y: 1, before: 0, after: 5 });

  assert.equal(doc.getRaw(0, 2, 1), 5, 'тайл записан');
  assert.equal(doc.getPass(2, 1), UNSET, 'проходимость не тронута');
  assert.ok(doc.map.collision.every((v) => v === UNSET), 'вся проходимость осталась пустой');
});

test('отмена правки проходимости возвращает прежнее состояние', () => {
  const doc = makeDoc();
  const e: CellEdit = { kind: 'pass', x: 0, y: 0, before: WALK, after: BLOCK };

  applyToDoc(doc, e);
  assert.equal(doc.getPass(0, 0), BLOCK);

  applyToDoc(doc, reverse(e));
  assert.equal(doc.getPass(0, 0), WALK, 'вернулось то, что было');
});

test('отмена правки тайла возвращает прежний тайл', () => {
  const doc = makeDoc();
  const e: CellEdit = { kind: 'tile', layerIndex: 0, x: 1, y: 1, before: 3, after: 7 };

  applyToDoc(doc, e);
  assert.equal(doc.getRaw(0, 1, 1), 7);

  applyToDoc(doc, reverse(e));
  assert.equal(doc.getRaw(0, 1, 1), 3);
});

test('разворот сохраняет вид правки', () => {
  // Иначе отмена стены записала бы тайл — ровно та порча, от которой kind и завели.
  const p = reverse({ kind: 'pass', x: 0, y: 0, before: UNSET, after: BLOCK });
  assert.equal(p.kind, 'pass');

  const t = reverse({ kind: 'tile', layerIndex: 0, x: 0, y: 0, before: 0, after: 9 });
  assert.equal(t.kind, 'tile');
  assert.equal(t.kind === 'tile' && t.layerIndex, 0, 'номер слоя не потерялся');
});

test('разворот не портит исходную правку', () => {
  const e: CellEdit = { kind: 'pass', x: 0, y: 0, before: UNSET, after: BLOCK };
  reverse(e);
  assert.equal(e.before, UNSET, 'исходная правка цела');
  assert.equal(e.after, BLOCK);
});

// --- маркеры спавна ---

test('marker-правка пишет маркер в клетку и разворачивается для отмены', () => {
  const doc = makeDoc();
  const e: CellEdit = { kind: 'marker', x: 2, y: 1, before: null, after: { kind: 'player', x: 2, y: 1 } };

  applyToDoc(doc, e);
  assert.deepEqual(doc.markerAt(2, 1), { kind: 'player', x: 2, y: 1 }, 'маркер поставлен');
  assert.equal(doc.getRaw(0, 2, 1), 0, 'слой не тронут');
  assert.equal(doc.getPass(2, 1), UNSET, 'проходимость не тронута');

  applyToDoc(doc, reverse(e));
  assert.equal(doc.markerAt(2, 1), null, 'отмена сняла маркер');
});

test('marker-правка снимает существующий маркер (after=null)', () => {
  const doc = makeDoc();
  doc.setMarker(1, 0, { kind: 'spider1', x: 1, y: 0 });
  applyToDoc(doc, { kind: 'marker', x: 1, y: 0, before: { kind: 'spider1', x: 1, y: 0 }, after: null });
  assert.equal(doc.markerAt(1, 0), null);
});
