#!/usr/bin/env node
/**
 * Разовая миграция: выносит тайлсеты из карт в общий каталог.
 *
 * Запуск: node tools/extract-tilesets.mjs
 *
 * Раньше каждая карта носила свой список тайлсетов внутри. С одной картой это
 * было нормально, с несколькими — нет: новый тайлсет приходилось добавлять в
 * каждую, а при добавлении в разном порядке номера тайлов разъезжались, и один
 * номер начинал значить разное в разных картах.
 *
 * Скрипт отказывается работать, если списки в картах различаются: слить их
 * автоматически нельзя — номера уже нарисованных тайлов поедут.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_DIR = resolve(root, 'public/assets/maps');
const CATALOG = resolve(root, 'public/assets/tilesets.json');

/** Тот же формат, что пишет редактор: по строке на слой, чтобы git видел правки. */
function serializeMap(map) {
  const layers = map.layers.map((l) => '    ' + JSON.stringify(l)).join(',\n');
  return (
    '{\n' +
    `  "version": ${map.version},\n` +
    `  "width": ${map.width},\n` +
    `  "height": ${map.height},\n` +
    `  "tileWidth": ${map.tileWidth},\n` +
    `  "tileHeight": ${map.tileHeight},\n` +
    '  "layers": [\n' + layers + '\n  ],\n' +
    `  "collision": ${JSON.stringify(map.collision)}\n` +
    '}\n'
  );
}

function serializeCatalog(catalog) {
  const tilesets = catalog.tilesets.map((t) => '    ' + JSON.stringify(t)).join(',\n');
  return '{\n  "version": 1,\n  "tilesets": [\n' + tilesets + '\n  ]\n}\n';
}

const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'));
if (!files.length) {
  console.error('карт не найдено');
  process.exit(1);
}

const maps = files.map((f) => ({ file: f, path: join(MAPS_DIR, f), data: JSON.parse(readFileSync(join(MAPS_DIR, f), 'utf8')) }));
const withOwn = maps.filter((m) => Array.isArray(m.data.tilesets) && m.data.tilesets.length);

if (!withOwn.length) {
  console.log('во всех картах тайлсетов уже нет — миграция не нужна');
  process.exit(0);
}

// Списки обязаны совпадать: иначе номера тайлов в картах значат разное, и общий
// каталог их молча перепутает.
const reference = JSON.stringify(withOwn[0].data.tilesets);
const different = withOwn.filter((m) => JSON.stringify(m.data.tilesets) !== reference);
if (different.length) {
  console.error('ОТМЕНА: списки тайлсетов в картах различаются:');
  for (const m of different) console.error(`  ${m.file}: ${m.data.tilesets.length} тайлсетов`);
  console.error(`  ${withOwn[0].file}: ${withOwn[0].data.tilesets.length} тайлсетов (взят за образец)`);
  console.error('Слить автоматически нельзя — номера уже нарисованных тайлов поедут.');
  process.exit(1);
}

const catalog = { version: 1, tilesets: withOwn[0].data.tilesets };

if (existsSync(CATALOG)) {
  const old = JSON.parse(readFileSync(CATALOG, 'utf8'));
  if (JSON.stringify(old.tilesets) !== JSON.stringify(catalog.tilesets)) {
    console.error('ОТМЕНА: каталог уже есть и отличается от того, что в картах');
    process.exit(1);
  }
}

writeFileSync(CATALOG, serializeCatalog(catalog));
console.log(`каталог: ${catalog.tilesets.length} тайлсетов, ${catalog.tilesets.reduce((n, t) => n + t.tileCount, 0)} тайлов`);
console.log(`  -> ${CATALOG}`);
console.log();

for (const m of maps) {
  copyFileSync(m.path, m.path + '.bak');
  delete m.data.tilesets;
  m.data.version = 3;
  writeFileSync(m.path, serializeMap(m.data));

  const tiles = m.data.layers.reduce((n, l) => n + l.data.filter(Boolean).length, 0);
  console.log(`  ${m.file}: тайлсеты вынесены, нарисованное цело (${tiles} тайлов), копия в ${m.file}.bak`);
}

console.log();
console.log('Карты стали версии 3: тайлсеты берутся из общего каталога.');
