#!/usr/bin/env node
/**
 * Добавляет картинку в общий каталог тайлсетов — после этого она появляется в
 * палитре редактора СРАЗУ ВО ВСЕХ картах, и ею можно рисовать.
 *
 * Запуск:
 *   node tools/add-tileset.mjs <файл.png> [ещё.png ...]
 *   node tools/add-tileset.mjs --prefix Village_ --tmx путь/к/Карте.tmx <файл.png> ...
 *
 * Что делает:
 *   - копирует картинку в public/assets/tilesets/ (оттуда её отдаёт сервер);
 *   - считает сетку по размеру картинки (тайл 16x16);
 *   - дописывает тайлсет в каталог, продолжая нумерацию.
 *
 * Руками в json это делать нельзя: номер первого тайла (firstId) должен
 * продолжать нумерацию без дыр и пересечений, иначе номера тайлов на картах
 * начнут указывать не туда, и уже нарисованное поедет.
 *
 * --prefix <p>
 *   Приставка к имени тайлсета И к имени файла в tilesets/. Нужна, когда в новом
 *   наборе есть картинка с уже занятым именем: в деревне свой Objects.png, а
 *   лесной Objects.png — это весь наш лес. Без приставки один затёр бы другой.
 *
 * --tmx <файл>
 *   Взять анимации тайлов из карты Tiled, приложенной к набору. Без этого свечи
 *   и флаги легли бы в палитру статичными: какие кадры за какими идут, знает
 *   только автор набора, и выдумывать это нельзя.
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

/**
 * Анимации тайлов из карты Tiled: { имя картинки -> { локальный id -> кадры } }.
 *
 * В .tmx тайлсеты лежат прямо внутри карты, и у каждого свои <tile><animation>.
 * Номера кадров там локальные для тайлсета — ровно как надо нашему каталогу.
 *
 * Ключ — имя КАРТИНКИ, а не имя тайлсета: в наборах они расходятся. У деревни,
 * например, тайлсет "Lute_player_animation_full" лежит в файле
 * "Lute_player_animation_with_shadow.png". Картинка — то, что мы добавляем,
 * поэтому по ней и связываем.
 */
function animationsFromTmx(path) {
  const xml = readFileSync(path, 'utf8');
  const out = new Map();

  for (const ts of xml.matchAll(/<tileset\b[^>]*>([\s\S]*?)<\/tileset>/g)) {
    const image = ts[1].match(/<image[^>]*source="([^"]*)"/)?.[1];
    if (!image) continue;

    const animations = {};
    for (const tile of ts[1].matchAll(/<tile id="(\d+)">([\s\S]*?)<\/tile>/g)) {
      const frames = [...tile[2].matchAll(/<frame tileid="(\d+)" duration="(\d+)"\s*\/>/g)]
        .map((f) => ({ tileId: +f[1], duration: +f[2] }));
      if (frames.length) animations[+tile[1]] = frames;
    }
    if (Object.keys(animations).length) out.set(basename(image), animations);
  }

  return out;
}

const argv = process.argv.slice(2);
const takeFlag = (flag) => {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const value = argv[i + 1];
  if (value === undefined) {
    console.error(`${flag}: не указано значение`);
    process.exit(1);
  }
  argv.splice(i, 2);
  return value;
};

const prefix = takeFlag('--prefix') ?? '';
const tmxPath = takeFlag('--tmx');
const files = argv;

if (!files.length) {
  console.error('нужен хотя бы один png: node tools/add-tileset.mjs [--prefix P] [--tmx карта.tmx] <файл.png> ...');
  process.exit(1);
}

let tmxAnimations = new Map();
if (tmxPath) {
  const src = resolve(root, tmxPath);
  if (!existsSync(src)) {
    console.error(`--tmx: нет файла ${tmxPath}`);
    process.exit(1);
  }
  tmxAnimations = animationsFromTmx(src);
  console.log(`анимации из ${basename(src)}: ${[...tmxAnimations.keys()].join(', ') || 'нет'}`);
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

  // Приставка идёт и в имя тайлсета, и в имя файла: иначе разные картинки с
  // одинаковым именем затёрли бы друг друга в общей папке.
  const origName = basename(src).replace(/\.png$/i, '');
  const name = prefix + origName;
  const image = name + '.png';

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

  // Ищем по исходному имени файла — под ним картинка записана в карте Tiled.
  const animations = tmxAnimations.get(basename(src)) ?? {};

  copyFileSync(src, dest);
  catalog.tilesets.push({ firstId, name, image, imageWidth: width, imageHeight: height, columns, tileCount, animations });

  const anim = Object.keys(animations).length ? `, анимаций ${Object.keys(animations).length}` : '';
  console.log(`  + ${name}: ${width}x${height} -> ${columns}x${rows} = ${tileCount} тайлов, номера ${firstId}..${firstId + tileCount - 1}${anim}`);
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
