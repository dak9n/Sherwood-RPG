import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLayer,
  suggestLayerName,
  layerNameError,
  withLayerAdded,
  withLayerRemoved,
  withLayerMoved,
  reorderTarget,
  layerRuns,
  groupNames,
  groupNameError,
  withLayerGrouped,
  withGroupRenamed,
  withGroupDisbanded,
  withGroupLabelAt,
  suggestGroupName,
} from './layers.ts';
import type { GameMap } from './types.ts';

/** Карта 2x2 с двумя слоями: a (снизу, с тайлами), b (сверху, пустой). */
function makeMap(): GameMap {
  return {
    version: 2,
    width: 2,
    height: 2,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [
      { name: 't', image: 't.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 1, animations: {} },
    ],
    layers: [
      { name: 'a', visible: true, data: [1, 2, 3, 4] },
      { name: 'b', visible: true, data: [0, 0, 0, 0] },
    ],
    collision: [1, 1, 1, 1],
  };
}

test('пустой слой ровно по размеру карты и весь из нулей', () => {
  const layer = emptyLayer(makeMap(), 'новый');
  assert.equal(layer.name, 'новый');
  assert.equal(layer.visible, true);
  assert.equal(layer.data.length, 4);
  assert.ok(layer.data.every((v) => v === 0));
});

test('добавление кладёт слой на нужную позицию и не трогает исходную карту', () => {
  const src = makeMap();
  const map = withLayerAdded(src, 'между', 1); // между a и b

  assert.equal(map.layers.length, 3);
  assert.deepEqual(map.layers.map((l) => l.name), ['a', 'между', 'b']);
  assert.equal(map.layers[1].data.length, 4);

  // исходник цел
  assert.equal(src.layers.length, 2);
  assert.deepEqual(src.layers.map((l) => l.name), ['a', 'b']);
});

test('insertAt = length кладёт слой поверх всех', () => {
  const map = withLayerAdded(makeMap(), 'верх', 2);
  assert.deepEqual(map.layers.map((l) => l.name), ['a', 'b', 'верх']);
});

test('удаление убирает нужный слой и не трогает исходник', () => {
  const src = makeMap();
  const map = withLayerRemoved(src, 0); // убрали a

  assert.equal(map.layers.length, 1);
  assert.equal(map.layers[0].name, 'b');
  assert.equal(src.layers.length, 2);
});

test('последний слой удалить нельзя', () => {
  const one = makeMap();
  one.layers = [one.layers[0]];
  assert.throws(() => withLayerRemoved(one, 0), /last layer/);
});

test('имя нового слоя не совпадает с существующими', () => {
  const map = makeMap();
  const name = suggestLayerName(map);
  assert.ok(!map.layers.some((l) => l.name === name));
});

test('suggestLayerName обходит занятого кандидата', () => {
  const map = makeMap();
  map.layers[1].name = 'Layer 3'; // при length=2 кандидат — «Слой 3», занимаем его
  assert.equal(suggestLayerName(map), 'Layer 4');
});

test('пустое имя и одни пробелы — ошибка', () => {
  const map = makeMap();
  assert.ok(layerNameError(map, -1, ''));
  assert.ok(layerNameError(map, -1, '   '));
});

test('занятое имя — ошибка, но своё же имя при переименовании — нет', () => {
  const map = makeMap();
  assert.ok(layerNameError(map, -1, 'a')); // новый слой с именем существующего
  assert.ok(layerNameError(map, 1, 'a')); // слой b хотят назвать как a
  assert.equal(layerNameError(map, 0, 'a'), null); // слой a «переименовывают» в 'a' — ок
  assert.equal(layerNameError(map, 0, 'c'), null); // свободное имя
});

test('имя обрезается по краям при проверке', () => {
  assert.ok(layerNameError(makeMap(), -1, '  a  ')); // '  a  ' → 'a', занято
});

/** Карта из слоёв с указанными именами (данные для перестановки не важны). */
function mapWithLayers(names: string[]): GameMap {
  const m = makeMap();
  m.width = 1;
  m.height = 1;
  m.layers = names.map((name) => ({ name, visible: true, data: [0] }));
  return m;
}

test('withLayerMoved двигает слой на нужный индекс и не трогает исходник', () => {
  const src = mapWithLayers(['a', 'b', 'c', 'd']);
  const moved = withLayerMoved(src, 0, 2); // a → индекс 2
  assert.deepEqual(moved.layers.map((l) => l.name), ['b', 'c', 'a', 'd']);
  assert.deepEqual(src.layers.map((l) => l.name), ['a', 'b', 'c', 'd']); // исходник цел
});

test('withLayerMoved: верхний слой в самый низ', () => {
  const moved = withLayerMoved(mapWithLayers(['a', 'b', 'c', 'd']), 3, 0);
  assert.deepEqual(moved.layers.map((l) => l.name), ['d', 'a', 'b', 'c']);
});

test('reorderTarget учитывает обратный порядок панели (n=4, визуально d,c,b,a)', () => {
  // Берём b (индекс 1). Визуально сверху вниз: d c b a.
  assert.equal(reorderTarget(1, 3, false, 4), 3); // на d сверху → b становится верхним (индекс 3)
  assert.equal(reorderTarget(1, 3, true, 4), 2); // на d снизу → b сразу под d (индекс 2)
  assert.equal(reorderTarget(1, 0, true, 4), 0); // на a снизу → b в самый низ (индекс 0)
  assert.equal(reorderTarget(1, 0, false, 4), 1); // на a сверху → b остаётся на месте (индекс 1)
});

test('reorderTarget: бросок на самого себя — без перестановки', () => {
  assert.equal(reorderTarget(2, 2, false, 4), 2);
  assert.equal(reorderTarget(2, 2, true, 4), 2);
});

// --- Группы слоёв ---

/** Карта с пятью слоями: a, b(G), c(G), d, e — G лежит подряд, как положено. */
function makeGrouped(): GameMap {
  const m = makeMap();
  m.layers = [
    { name: 'a', visible: true, data: [0, 0, 0, 0] },
    { name: 'b', visible: true, data: [0, 0, 0, 0], group: 'G' },
    { name: 'c', visible: true, data: [0, 0, 0, 0], group: 'G' },
    { name: 'd', visible: true, data: [0, 0, 0, 0] },
    { name: 'e', visible: true, data: [0, 0, 0, 0] },
  ];
  return m;
}

test('layerRuns: слои группы подряд — один отрезок, без группы — по одному', () => {
  const runs = layerRuns(makeGrouped().layers);
  assert.deepEqual(
    runs.map((r) => [r.group, ...r.indices]),
    [[null, 0], ['G', 1, 2], [null, 3], [null, 4]],
  );
});

test('layerRuns: разорванная группа честно даёт два отрезка', () => {
  const m = makeGrouped();
  m.layers[4] = { ...m.layers[4], group: 'G' }; // e тоже G, но d между ними
  const runs = layerRuns(m.layers);
  assert.deepEqual(
    runs.map((r) => [r.group, ...r.indices]),
    [[null, 0], ['G', 1, 2], [null, 3], ['G', 4]],
  );
});

test('groupNames: в порядке появления, без повторов', () => {
  const m = makeGrouped();
  m.layers[0] = { ...m.layers[0], group: 'X' };
  assert.deepEqual(groupNames(m), ['X', 'G']);
});

test('withLayerGrouped: слой переезжает вплотную к группе (поверх верхнего члена)', () => {
  const m = makeGrouped();
  const r = withLayerGrouped(m, 4, 'G'); // e из-под потолка — в G
  assert.deepEqual(r.map.layers.map((l) => l.name), ['a', 'b', 'c', 'e', 'd']);
  assert.equal(r.map.layers[3].group, 'G');
  assert.equal(r.index, 3);
});

test('withLayerGrouped: слой ниже группы поднимается к ней', () => {
  const m = makeGrouped();
  const r = withLayerGrouped(m, 0, 'G'); // a снизу — в G
  assert.deepEqual(r.map.layers.map((l) => l.name), ['b', 'c', 'a', 'd', 'e']);
  assert.equal(r.map.layers[2].group, 'G');
  assert.equal(r.index, 2);
});

test('withLayerGrouped: первая метка группы не двигает слой', () => {
  const m = makeMap();
  const r = withLayerGrouped(m, 0, 'New');
  assert.deepEqual(r.map.layers.map((l) => l.name), ['a', 'b']);
  assert.equal(r.map.layers[0].group, 'New');
  assert.equal(r.index, 0);
});

test('withLayerGrouped(null): снимает метку, не двигая слой', () => {
  const m = makeGrouped();
  const r = withLayerGrouped(m, 1, null);
  assert.deepEqual(r.map.layers.map((l) => l.name), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(r.map.layers[1].group, undefined);
  assert.ok(!('group' in r.map.layers[1]), 'поле убрано совсем, а не undefined — иначе попадёт в json');
});

test('withGroupRenamed: переименовывает у всех членов', () => {
  const m = withGroupRenamed(makeGrouped(), 'G', 'Дом');
  assert.deepEqual(m.layers.map((l) => l.group ?? '-'), ['-', 'Дом', 'Дом', '-', '-']);
});

test('withGroupDisbanded: метки сняты, слои на местах', () => {
  const m = withGroupDisbanded(makeGrouped(), 'G');
  assert.deepEqual(m.layers.map((l) => l.name), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(m.layers.every((l) => !('group' in l)));
});

// Перетаскивание = withLayerMoved + withGroupLabelAt с членством ПО МЕСТУ БРОСКА:
// панель передаёт группу строки-цели явно, догадок по соседям нет (иначе слой,
// брошенный вплотную к своей папке, прилипал бы к ней и не мог выйти).

test('перетаскивание в папку: бросок между членами группы даёт её метку', () => {
  const m = makeGrouped();
  // перетащим e (4) между b и c и пометим группой цели: порядок a, b, e, c, d
  const out = withGroupLabelAt(withLayerMoved(m, 4, 2), 2, 'G');
  assert.equal(out.layers[2].name, 'e');
  assert.equal(out.layers[2].group, 'G');
});

test('перетаскивание из папки: бросок на строку вне папок снимает метку совсем', () => {
  const m = makeGrouped();
  // утащим c (2) на самый верх, цель вне группы: a, b, d, e, c
  const out = withGroupLabelAt(withLayerMoved(m, 2, 4), 4, null);
  assert.equal(out.layers[4].name, 'c');
  assert.ok(!('group' in out.layers[4]), 'поле убрано совсем, а не undefined — иначе попадёт в json');
});

test('вытащить слой ПРЯМО НАД свою группу можно: явный null побеждает соседство', () => {
  const m = makeGrouped();
  // c (2) кладём сразу над группой (после b..c это позиция 2 же — возьмём верх группы):
  // бросок на верхнюю половину заголовка = позиция над верхним членом, без группы
  const out = withGroupLabelAt(withLayerMoved(m, 1, 2), 2, null);
  assert.equal(out.layers[2].name, 'b');
  assert.ok(!('group' in out.layers[2]), 'слой вышел из папки, хотя касается её края');
});

test('groupNameError: пустое имя — ошибка, непустое — нет', () => {
  assert.ok(groupNameError('  '));
  assert.equal(groupNameError('Дом'), null);
});

test('suggestGroupName: свободный номер, занятые пропускает', () => {
  const m = makeMap();
  assert.equal(suggestGroupName(m), 'Group 1');
  m.layers[0] = { ...m.layers[0], group: 'Group 1' };
  assert.equal(suggestGroupName(m), 'Group 2');
  m.layers[1] = { ...m.layers[1], group: 'Group 2' };
  assert.equal(suggestGroupName(m), 'Group 3');
});
