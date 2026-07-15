#!/usr/bin/env node
/**
 * Добавляет картинку в общий каталог тайлсетов — после этого она появляется в
 * палитре редактора СРАЗУ ВО ВСЕХ картах, и ею можно рисовать.
 *
 * Запуск:
 *   node tools/add-tileset.mjs <файл.png> [ещё.png ...]
 *
 * Что делает:
 *   - копирует картинку в public/assets/tilesets/ (оттуда её отдаёт сервер);
 *   - считает сетку по размеру картинки (тайл 16x16);
 *   - дописывает тайлсет в каталог, продолжая нумерацию.
 *
 * Руками в json это делать нельзя: номер первого тайла (firstId) должен
 * продолжать нумерацию без дыр и пересечений, иначе номера тайлов на картах
 * начнут указывать не туда, и уже нарисованное поедет.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TILESET_DIR = resolve(root, 'public/assets/tilesets');
const CATALOG = resolve(root, 'public/assets/tilesets.json');
const TILE = 16;

/** Размер PNG из заголовка: ширина и высота лежат в IHDR сразу за подписью. */
function pngSize(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${basename(path)}: это не png`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function serializeCatalog(catalog) {
  const tilesets = catalog.tilesets.map((t) => '    ' + JSON.stringify(t)).join(',\n');
  return '{\n  "version": 1,\n  "tilesets": [\n' + tilesets + '\n  ]\n}\n';
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('нужен хотя бы один png: node tools/add-tileset.mjs <файл.png> ...');
  process.exit(1);
}

if (!existsSync(CATALOG)) {
  console.error(`нет каталога ${CATALOG} — сначала node tools/extract-tilesets.mjs`);
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
let added = 0;

for (const file of files) {
  const src = resolve(root, file);
  if (!existsSync(src)) {
    console.error(`  пропущен ${file}: файла нет`);
    continue;
  }

  const image = basename(src);
  const name = image.replace(/\.png$/i, '');

  if (catalog.tilesets.some((t) => t.name === name)) {
    console.error(`  пропущен ${name}: уже в каталоге`);
    continue;
  }
  // Разные картинки под одним именем затёрли бы друг друга в общей папке.
  const dest = resolve(TILESET_DIR, image);
  if (existsSync(dest)) {
    const a = pngSize(src);
    const b = pngSize(dest);
    if (a.width !== b.width || a.height !== b.height) {
      console.error(`  ПРОПУЩЕН ${image}: в tilesets/ уже лежит другая картинка с таким именем`);
      continue;
    }
  }

  const { width, height } = pngSize(src);
  const columns = Math.floor(width / TILE);
  const rows = Math.floor(height / TILE);
  const tileCount = columns * rows;

  // Нумерация продолжается за последним тайлом каталога.
  const firstId = catalog.tilesets.reduce((max, t) => Math.max(max, t.firstId + t.tileCount), 1);

  copyFileSync(src, dest);
  catalog.tilesets.push({ firstId, name, image, imageWidth: width, imageHeight: height, columns, tileCount, animations: {} });

  console.log(`  + ${name}: ${width}x${height} -> ${columns}x${rows} = ${tileCount} тайлов, номера ${firstId}..${firstId + tileCount - 1}`);
  added++;
}

if (!added) {
  console.log('ничего не добавлено');
  process.exit(0);
}

writeFileSync(CATALOG, serializeCatalog(catalog));
console.log();
console.log(`каталог: ${catalog.tilesets.length} тайлсетов, ${catalog.tilesets.reduce((n, t) => n + t.tileCount, 0)} тайлов`);
console.log('доступны во всех картах сразу');
