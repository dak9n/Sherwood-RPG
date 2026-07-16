import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftCollision, mergeCollision } from './collision-draft.ts';
import { MapDoc, UNSET, WALK, BLOCK } from './doc.ts';
import type { GameMap } from './types.ts';

const WATER_ID = 1; // Water_detilazation
const LAND_ID = 500; // Water_coasts — вопреки имени земля

function docFrom(layers: { name: string; rows: string[] }[], legend: Record<string, number>): MapDoc {
  const width = layers[0].rows[0].length;
  const height = layers[0].rows.length;

  const map: GameMap = {
    version: 2,
    width,
    height,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      { name: 'Water_detilazation', image: 'w.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 400, firstId: 1, animations: {} },
      { name: 'Water_coasts', image: 'c.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 500, animations: {} },
      { name: 'Objects', image: 'o.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 1100, animations: {} },
    ],
    layers: layers.map((l) => ({
      name: l.name,
      visible: true,
      data: l.rows.flatMap((row) => [...row].map((ch) => legend[ch] ?? 0)),
    })),
    collision: new Array(width * height).fill(0),
  };
  return new MapDoc(map);
}

test('по земле ходим, в воду не заходим', () => {
  const doc = docFrom(
    [
      { name: 'water', rows: ['wwww', 'wwww'] },
      { name: 'ground', rows: ['LL..', 'LL..'] },
    ],
    { w: WATER_ID, L: LAND_ID, '.': 0 },
  );
  const { collision } = draftCollision(doc, new Map(), 16);

  assert.equal(collision[0], 1, 'земля поверх воды — проходима');
  assert.equal(collision[2], 2, 'чистая вода — стена');
});

test('под кроной можно пройти, в ствол упираемся', () => {
  // дерево 4 тайла высотой в колонке 1, вокруг земля
  const doc = docFrom([{ name: 'g', rows: ['LLL', 'LLL', 'LLL', 'LLL'] }], { L: LAND_ID });

  // findTallObjects вернул бы: все клетки дерева -> низ дерева в пикселях
  const trees = new Map<number, number>();
  const baseY = 4 * 16; // низ на y=64
  for (let y = 0; y < 4; y++) trees.set(y * 3 + 1, baseY);

  const { collision } = draftCollision(doc, trees, 16);

  assert.equal(collision[0 * 3 + 1], 1, 'верх кроны — проходим');
  assert.equal(collision[1 * 3 + 1], 1, 'середина кроны — проходима');
  assert.equal(collision[2 * 3 + 1], 2, 'ствол — стена');
  assert.equal(collision[3 * 3 + 1], 2, 'низ ствола — стена');
});

test('нехоженый островок за водой отрезается', () => {
  //  LL.L   <- правая клетка отдельно
  const doc = docFrom(
    [
      { name: 'water', rows: ['wwww', 'wwww'] },
      { name: 'ground', rows: ['LL.L', 'LL..'] },
    ],
    { w: WATER_ID, L: LAND_ID, '.': 0 },
  );
  const { collision } = draftCollision(doc, new Map(), 16);

  assert.equal(collision[0], 1, 'большой кусок проходим');
  assert.equal(collision[3], 2, 'островок отрезан: попасть туда всё равно нельзя');
});

test('пустая карта — сплошная стена, а не дыра в никуда', () => {
  const doc = docFrom([{ name: 'g', rows: ['..', '..'] }], { '.': 0 });
  const { collision, walkable } = draftCollision(doc, new Map(), 16);

  assert.equal(walkable, 0);
  assert.ok(collision.every((v) => v === 2), 'за краем нарисованного ходить негде');
});

test('считает, сколько получилось проходимого', () => {
  const doc = docFrom(
    [
      { name: 'water', rows: ['wwww', 'wwww'] },
      { name: 'ground', rows: ['LL..', 'LL..'] },
    ],
    { w: WATER_ID, L: LAND_ID, '.': 0 },
  );
  const { walkable, blocked } = draftCollision(doc, new Map(), 16);

  assert.equal(walkable, 4);
  assert.equal(blocked, 4);
});

test('пустая разметка — берём черновик целиком', () => {
  const draft = [WALK, BLOCK, WALK, BLOCK];
  const manual = [UNSET, UNSET, UNSET, UNSET];
  assert.deepEqual(mergeCollision(manual, draft), draft);
});

test('нарисованная стена сильнее черновика', () => {
  // Ради этого всё и затевалось: обвести речку или дом, которых черновик не видит.
  const draft = [WALK, WALK, WALK, WALK];
  const manual = [UNSET, BLOCK, UNSET, UNSET];
  assert.deepEqual(mergeCollision(manual, draft), [WALK, BLOCK, WALK, WALK]);
});

test('нарисованный проход сильнее черновика', () => {
  // Обратный случай: черновик считает клетку стеной, а человек знает, что тут мост.
  const draft = [BLOCK, BLOCK, BLOCK];
  const manual = [UNSET, WALK, UNSET];
  assert.deepEqual(mergeCollision(manual, draft), [BLOCK, WALK, BLOCK]);
});

test('одна стена НЕ обнуляет проходимость всей карты', () => {
  // Тот самый баг. Раньше: marked = collision.some(v => v !== 0) -> черновик
  // выбрасывался целиком -> остальные клетки UNSET -> canWalk(UNSET) = false ->
  // на forest получалось 0 проходимых клеток из 6300, игрок не мог сдвинуться.
  const size = 6300;
  const draft = new Array(size).fill(WALK);
  const manual = new Array(size).fill(UNSET);
  manual[100] = BLOCK;

  const out = mergeCollision(manual, draft);
  const walkable = out.filter((v) => v === WALK).length;

  assert.equal(walkable, size - 1, `проходимых ${walkable}, а должно быть ${size - 1}`);
  assert.equal(out[100], BLOCK, 'нарисованная стена на месте');
});

test('разметка от чужой карты не применяется', () => {
  // Длина разъехалась — значит массив не от этой карты. Лучше черновик, чем
  // разметка, сдвинутая на полкарты.
  const draft = [WALK, BLOCK, WALK];
  assert.deepEqual(mergeCollision([BLOCK, BLOCK], draft), draft);
  assert.deepEqual(mergeCollision([], draft), draft);
});

test('слияние не портит исходные массивы', () => {
  const draft = [WALK, WALK];
  const manual = [BLOCK, UNSET];
  mergeCollision(manual, draft);
  assert.deepEqual(draft, [WALK, WALK], 'черновик не тронут');
  assert.deepEqual(manual, [BLOCK, UNSET], 'разметка не тронута');
});
