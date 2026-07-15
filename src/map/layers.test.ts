import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayer, suggestLayerName, layerNameError, withLayerAdded, withLayerRemoved } from './layers.ts';
import type { GameMap } from './types.ts';

/** Карта 2x2 с двумя слоями: a (снизу, с тайлами), b (сверху, пустой). */
function makeMap(): GameMap {
  return {
    version: 1,
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
  assert.throws(() => withLayerRemoved(one, 0), /последний слой/);
});

test('имя нового слоя не совпадает с существующими', () => {
  const map = makeMap();
  const name = suggestLayerName(map);
  assert.ok(!map.layers.some((l) => l.name === name));
});

test('suggestLayerName обходит занятого кандидата', () => {
  const map = makeMap();
  map.layers[1].name = 'Слой 3'; // при length=2 кандидат — «Слой 3», занимаем его
  assert.equal(suggestLayerName(map), 'Слой 4');
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
