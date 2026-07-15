import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankMap } from './blank.ts';
import { validateMap } from './validate.ts';
import type { Tileset } from './types.ts';

function fakeTilesets(): Tileset[] {
  return [
    { name: 't', image: 't.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 1, animations: {} },
  ];
}

test('createBlankMap даёт карту, проходящую validateMap', () => {
  const map = createBlankMap({ width: 20, height: 15, tileWidth: 16, tileHeight: 16, tilesets: fakeTilesets() });
  assert.deepEqual(validateMap(map), []);
});

test('createBlankMap: версия 2, размеры и collision по размеру карты', () => {
  const map = createBlankMap({ width: 20, height: 15, tileWidth: 16, tileHeight: 16, tilesets: fakeTilesets() });
  assert.equal(map.version, 2);
  assert.equal(map.width, 20);
  assert.equal(map.height, 15);
  assert.equal(map.tileWidth, 16);
  assert.equal(map.collision.length, 300);
  assert.ok(map.collision.every((c) => c === 0));
});

test('createBlankMap: ровно один пустой слой', () => {
  const map = createBlankMap({ width: 4, height: 3, tileWidth: 16, tileHeight: 16, tilesets: fakeTilesets() });
  assert.equal(map.layers.length, 1);
  assert.equal(map.layers[0].name, 'Слой 1');
  assert.equal(map.layers[0].visible, true);
  assert.equal(map.layers[0].data.length, 12);
  assert.ok(map.layers[0].data.every((v) => v === 0));
});

test('createBlankMap уважает имя слоя', () => {
  const map = createBlankMap({ width: 2, height: 2, tileWidth: 16, tileHeight: 16, tilesets: fakeTilesets(), layerName: 'фон' });
  assert.equal(map.layers[0].name, 'фон');
});

test('createBlankMap глубоко копирует тайлсеты — шаблон не алиасится', () => {
  const src = fakeTilesets();
  const map = createBlankMap({ width: 2, height: 2, tileWidth: 16, tileHeight: 16, tilesets: src });
  assert.notEqual(map.tilesets[0], src[0]); // разные объекты
  map.tilesets[0].firstId = 999;
  map.tilesets.push(src[0]);
  assert.equal(src[0].firstId, 1); // исходник цел
  assert.equal(src.length, 1);
});

test('createBlankMap 1x1 валидна', () => {
  const map = createBlankMap({ width: 1, height: 1, tileWidth: 16, tileHeight: 16, tilesets: fakeTilesets() });
  assert.deepEqual(validateMap(map), []);
});
