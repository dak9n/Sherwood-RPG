#!/usr/bin/env node
/**
 * Добавляет картинку в карту как тайлсет — после этого она появляется в палитре
 * редактора, и ею можно рисовать.
 *
 * Запуск:
 *   node tools/add-tileset.mjs <файл.png> [ещё.png ...]
 *   node tools/add-tileset.mjs --map Жека public/assets/road/PNG_Tiled/Road1.png
 *
 * Что делает:
 *   - копирует картинку в public/assets/tilesets/ (оттуда её отдаёт сервер);
 *   - считает сетку по размеру картинки (тайл 16x16);
 *   - дописывает тайлсет в карту, продолжая нумерацию тайлов;
 *   - сохраняет карту в том же формате, что и редактор.
 *
 * Руками в json это делать нельзя: номер первого тайла (firstId) должен
 * продолжать нумерацию без дыр и пересечений, иначе номера тайлов на карте
 * начнут указывать не туда, и уже нарисованное поедет.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TILESET_DIR = resolve(root, 'public/assets/tilesets');
const MAPS_DIR = resolve(root, 'public/assets/maps');

/** Размер PNG из заголовка: ширина и высота лежат в IHDR сразу за подписью. */
function pngSize(path) {
  const buf = readFileSync(path);
  const isPng = buf.readUInt32BE(0) === 0x89504e47;
  if (!isPng) throw new Error(`${basename(path)}: это не png`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Тот же формат, что пишет редактор: по строке на слой, чтобы git видел правки. */
function serialize(map) {
  const tilesets = map.tilesets.map((t) => '    ' + JSON.stringify(t)).join(',\n');
  const layers = map.layers.map((l) => '    ' + JSON.stringify(l)).join(',\n');
  return (
    '{\n' +
    `  "version": ${map.version},\n` +
    `  "width": ${map.width},\n` +
    `  "height": ${map.height},\n` +
    `  "tileWidth": ${map.tileWidth},\n` +
    `  "tileHeight": ${map.tileHeight},\n` +
    '  "tilesets": [\n' + tilesets + '\n  ],\n' +
    '  "layers": [\n' + layers + '\n  ],\n' +
    `  "collision": ${JSON.stringify(map.collision)}\n` +
    '}\n'
  );
}

const args = process.argv.slice(2);
let mapName = 'forest';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--map') mapName = args[++i];
  else files.push(args[i]);
}

if (!files.length) {
  console.error('нужен хотя бы один png: node tools/add-tileset.mjs <файл.png> ...');
  process.exit(1);
}

const mapPath = resolve(MAPS_DIR, `${mapName}.json`);
if (!existsSync(mapPath)) {
  console.error(`нет карты ${mapPath}`);
  process.exit(1);
}

const map = JSON.parse(readFileSync(mapPath, 'utf8'));

// Старые карты не знали проходимости — дополняем, иначе формат не сойдётся.
if (!Array.isArray(map.collision) || map.collision.length !== map.width * map.height) {
  map.collision = new Array(map.width * map.height).fill(0);
}
map.version = 2;

let added = 0;
for (const file of files) {
  const src = resolve(root, file);
  if (!existsSync(src)) {
    console.error(`  пропущен ${file}: файла нет`);
    continue;
  }

  const image = basename(src);
  const name = image.replace(/\.png$/i, '');

  if (map.tilesets.some((t) => t.name === name)) {
    console.error(`  пропущен ${name}: тайлсет с таким именем уже в карте`);
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
  const columns = Math.floor(width / map.tileWidth);
  const rows = Math.floor(height / map.tileHeight);
  const tileCount = columns * rows;

  // Нумерация продолжается за последним тайлом: дыры и пересечения сдвинули бы
  // номера уже нарисованных тайлов.
  const firstId = map.tilesets.reduce((max, t) => Math.max(max, t.firstId + t.tileCount), 1);

  copyFileSync(src, dest);
  map.tilesets.push({
    firstId,
    name,
    image,
    imageWidth: width,
    imageHeight: height,
    columns,
    tileCount,
    animations: {},
  });

  console.log(`  + ${name}: ${width}x${height} -> ${columns}x${rows} = ${tileCount} тайлов, номера ${firstId}..${firstId + tileCount - 1}`);
  added++;
}

if (!added) {
  console.log('ничего не добавлено');
  process.exit(0);
}

writeFileSync(mapPath, serialize(map));
console.log();
console.log(`карта ${mapName}: тайлсетов ${map.tilesets.length}, тайлов ${map.tilesets.reduce((n, t) => n + t.tileCount, 0)}`);
console.log(`записано: ${mapPath}`);
