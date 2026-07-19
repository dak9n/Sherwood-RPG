import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankMap } from './blank.ts';
import { applyCatalog, type TilesetCatalog } from './catalog.ts';
import { validateMap } from './validate.ts';

function fakeCatalog(): TilesetCatalog {
  return {
    version: 1,
    tilesets: [
      { name: 't', image: 't.png', imageWidth: 16, imageHeight: 16, columns: 1, tileCount: 100, firstId: 1, animations: {} },
    ],
  };
}

test('createBlankMap: версия 3, пустые тайлсеты (их даёт каталог), размеры и collision по карте', () => {
  const map = createBlankMap({ width: 20, height: 15 });
  assert.equal(map.version, 3);
  assert.equal(map.width, 20);
  assert.equal(map.height, 15);
  assert.equal(map.tileWidth, 16);
  assert.deepEqual(map.tilesets, []);
  assert.equal(map.collision.length, 300);
  assert.ok(map.collision.every((c) => c === 0));
});

test('пустая карта + каталог проходит validateMap', () => {
  const map = applyCatalog(createBlankMap({ width: 20, height: 15 }), fakeCatalog());
  assert.deepEqual(validateMap(map), []);
});

test('createBlankMap: ровно один пустой слой «Слой 1»', () => {
  const map = createBlankMap({ width: 4, height: 3 });
  assert.equal(map.layers.length, 1);
  assert.equal(map.layers[0].name, 'Layer 1');
  assert.equal(map.layers[0].visible, true);
  assert.equal(map.layers[0].data.length, 12);
  assert.ok(map.layers[0].data.every((v) => v === 0));
});

test('createBlankMap уважает имя слоя и размер тайла', () => {
  const map = createBlankMap({ width: 2, height: 2, tileWidth: 32, tileHeight: 32, layerName: 'фон' });
  assert.equal(map.layers[0].name, 'фон');
  assert.equal(map.tileWidth, 32);
  assert.equal(map.tileHeight, 32);
});

test('createBlankMap 1x1 + каталог валидна', () => {
  assert.deepEqual(validateMap(applyCatalog(createBlankMap({ width: 1, height: 1 }), fakeCatalog())), []);
});
