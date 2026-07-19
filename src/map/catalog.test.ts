import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalog, nextFirstId, validateCatalog, type TilesetCatalog } from './catalog.ts';
import type { GameMap, Tileset } from './types.ts';

function ts(name: string, firstId: number, tileCount: number): Tileset {
  return { name, image: `${name}.png`, imageWidth: 16, imageHeight: 16, columns: 1, tileCount, firstId, animations: {} };
}

function catalog(): TilesetCatalog {
  return { version: 1, tilesets: [ts('a', 1, 10), ts('b', 11, 5)] };
}

function map(tilesets: Tileset[] = []): GameMap {
  return {
    version: 2,
    width: 1,
    height: 1,
    tileWidth: 16,
    tileHeight: 16,
    tilesets,
    layers: [{ name: 'l', visible: true, data: [0] }],
    collision: [0],
  };
}

test('карта без своих тайлсетов берёт их из каталога', () => {
  const m = applyCatalog(map(), catalog());
  assert.equal(m.tilesets.length, 2);
  assert.equal(m.tilesets[0].name, 'a');
});

test('старая карта со своим списком его и оставляет', () => {
  // Иначе у карты, нарисованной до общего каталога, поехали бы номера тайлов.
  const own = [ts('старый', 1, 99)];
  const m = applyCatalog(map(own), catalog());

  assert.equal(m.tilesets.length, 1);
  assert.equal(m.tilesets[0].name, 'старый');
});

test('следующий номер продолжает нумерацию без дыр', () => {
  assert.equal(nextFirstId(catalog()), 16); // 11 + 5
  assert.equal(nextFirstId({ version: 1, tilesets: [] }), 1);
});

test('каталог с дырой в нумерации — ошибка', () => {
  const broken: TilesetCatalog = { version: 1, tilesets: [ts('a', 1, 10), ts('b', 50, 5)] };
  const errors = validateCatalog(broken);
  assert.ok(errors.some((e) => e.includes('in order it must be 11')));
});

test('каталог с нахлёстом номеров — ошибка', () => {
  // b начинается внутри a: номера тайлов a стали бы двусмысленными
  const broken: TilesetCatalog = { version: 1, tilesets: [ts('a', 1, 10), ts('b', 5, 5)] };
  assert.ok(validateCatalog(broken).length > 0);
});

test('повторяющееся имя тайлсета — ошибка', () => {
  const broken: TilesetCatalog = { version: 1, tilesets: [ts('a', 1, 10), ts('a', 11, 5)] };
  assert.ok(validateCatalog(broken).some((e) => e.includes('is duplicated')));
});

test('здоровый каталог проходит проверку', () => {
  assert.deepEqual(validateCatalog(catalog()), []);
});

test('пустой каталог — ошибка, а не тихая пустая палитра', () => {
  assert.ok(validateCatalog({ version: 1, tilesets: [] }).length > 0);
});
