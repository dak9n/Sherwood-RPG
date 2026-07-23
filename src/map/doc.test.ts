import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapDoc, ensureCollision, drawnBounds } from './doc.ts';
import type { GameMap } from './types.ts';

/** Карта 2x2 с тремя слоями — как в настоящей, где тайл может лежать под другими. */
function makeDoc(): MapDoc {
  const layer = (name: string, data: number[]) => ({ name, visible: true, data });
  const map: GameMap = {
    version: 2,
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
    // проходимо, стена, не задано, проходимо
    collision: [1, 2, 0, 1],
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

// --- проходимость ---

test('ходить можно только там, где явно разрешено', () => {
  const doc = makeDoc();
  assert.equal(doc.canWalk(0, 0), true, 'помечено проходимым');
  assert.equal(doc.canWalk(1, 0), false, 'помечено стеной');
  assert.equal(doc.canWalk(0, 1), false, 'не задано — значит стена');
});

test('за границами карты стена, а не падение', () => {
  const doc = makeDoc();
  assert.equal(doc.canWalk(-1, 0), false);
  assert.equal(doc.canWalk(0, 99), false);
});

test('проходимость правится по клеткам', () => {
  const doc = makeDoc();
  doc.setPass(0, 1, 1);
  assert.equal(doc.canWalk(0, 1), true);
  doc.setPass(0, 1, 2);
  assert.equal(doc.canWalk(0, 1), false);
});

test('старая карта без проходимости дополняется нулями и версией 2', () => {
  const old = { ...makeDoc().map, version: 1 } as unknown as GameMap;
  delete (old as Partial<GameMap>).collision;

  const migrated = ensureCollision(old);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.collision.length, 4);
  // всё в нулях: пока не разметили — стена
  assert.deepEqual(migrated.collision, [0, 0, 0, 0]);
});

test('проходимость неправильной длины пересоздаётся, а не едет дальше', () => {
  const broken = { ...makeDoc().map, collision: [1, 1] } as GameMap;
  const fixed = ensureCollision(broken);
  assert.equal(fixed.collision.length, 4);
});

test('карта версии 3 не откатывается до 2', () => {
  // У версии 3 тайлсеты лежат в общем каталоге. Понизить версию — значит сказать
  // остальному коду, что список тайлсетов у карты свой, а его там нет.
  const v3 = { ...makeDoc().map, version: 3 } as GameMap;
  assert.equal(ensureCollision(v3).version, 3);
});

/** Карта 5x4, где нарисован только прямоугольник (1,1)..(3,2). */
function sparseMap(): GameMap {
  const empty = () => new Array(20).fill(0);
  const at = (x: number, y: number) => y * 5 + x;

  const low = empty();
  low[at(1, 1)] = 7;
  low[at(3, 2)] = 9;

  const high = empty();
  high[at(2, 1)] = 5; // внутри уже известных границ — их не расширяет

  return {
    version: 3, width: 5, height: 4, tileWidth: 16, tileHeight: 16,
    tilesets: [],
    layers: [
      { name: 'низ', visible: true, data: low },
      { name: 'верх', visible: true, data: high },
    ],
    collision: new Array(20).fill(0),
  } as GameMap;
}

test('границы нарисованного считаются по всем слоям', () => {
  assert.deepEqual(drawnBounds(sparseMap()), { minX: 1, minY: 1, maxX: 3, maxY: 2 });
});

test('границы растут от тайла на любом слое', () => {
  // Холст карты почти всегда больше нарисованного, и знать надо про ЛЮБОЙ слой:
  // одинокий куст на верхнем слое — тоже часть карты.
  const m = sparseMap();
  m.layers[1].data[0] = 3; // тайл в углу (0,0) на верхнем слое
  assert.deepEqual(drawnBounds(m), { minX: 0, minY: 0, maxX: 3, maxY: 2 });
});

test('у пустой карты границ нет', () => {
  // Возвращать нули значило бы соврать: у пустоты нет ни центра, ни углов.
  const m = sparseMap();
  for (const l of m.layers) l.data.fill(0);
  assert.equal(drawnBounds(m), null);
});

test('карта, нарисованная целиком, даёт границы по краям холста', () => {
  const m = sparseMap();
  m.layers[0].data.fill(1);
  assert.deepEqual(drawnBounds(m), { minX: 0, minY: 0, maxX: 4, maxY: 3 });
});

// --- маркеры спавна ---

test('setMarker кладёт один маркер в клетку, markerAt его находит', () => {
  const doc = makeDoc();
  assert.equal(doc.markerAt(1, 1), null, 'пусто до постановки');

  doc.setMarker(1, 1, { kind: 'golem2', x: 1, y: 1 });
  assert.deepEqual(doc.markerAt(1, 1), { kind: 'golem2', x: 1, y: 1 });
  assert.deepEqual(doc.spawns, [{ kind: 'golem2', x: 1, y: 1 }]);
});

test('в клетке маркер один: повторный setMarker заменяет прежний', () => {
  const doc = makeDoc();
  doc.setMarker(0, 0, { kind: 'spider1', x: 0, y: 0 });
  doc.setMarker(0, 0, { kind: 'spider2', x: 0, y: 0 });
  assert.equal(doc.spawns.length, 1, 'не два маркера в одной клетке');
  assert.equal(doc.markerAt(0, 0)?.kind, 'spider2');
});

test('setMarker(null) снимает маркер, пустое поле spawns не держим', () => {
  const doc = makeDoc();
  doc.setMarker(0, 0, { kind: 'spider1', x: 0, y: 0 });
  doc.setMarker(0, 0, null);
  assert.equal(doc.markerAt(0, 0), null);
  assert.equal(doc.map.spawns, undefined, 'опустевшее поле убрано, а не оставлено []');
});

test('setMarker не трогает соседние маркеры', () => {
  const doc = makeDoc();
  doc.setMarker(0, 0, { kind: 'player', x: 0, y: 0 });
  doc.setMarker(1, 1, { kind: 'golem1', x: 1, y: 1 });
  doc.setMarker(0, 0, null);
  assert.deepEqual(doc.spawns, [{ kind: 'golem1', x: 1, y: 1 }], 'снятие одного не задело другой');
});

test('setMarker за границами карты ничего не делает', () => {
  const doc = makeDoc();
  doc.setMarker(5, 5, { kind: 'player', x: 5, y: 5 });
  assert.equal(doc.spawns.length, 0);
});
