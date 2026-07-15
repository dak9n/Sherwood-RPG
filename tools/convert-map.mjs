// Конвертер Forest.tmj (формат Tiled) -> assets/maps/forest.json (наш формат).
// Запуск: node tools/convert-map.mjs
//
// Что делает:
//  - разворачивает чанки в плоские массивы слоёв
//  - встраивает внешний тайлсет .tsx в JSON (Phaser не умеет читать .tsx)
//  - переносит анимации тайлов
//  - обрезает карту по реальным границам нарисованного
//
// Номера тайлов (id) в data: 0 = пусто, иначе глобальный номер,
// в трёх старших битах — флаги отражения (как в Tiled):
//   0x80000000 flipX, 0x40000000 flipY, 0x20000000 flipDiagonal

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'Tiled_files/Forest.tmj');
const OUT = resolve(root, 'public/assets/maps/forest.json');
const TILESET_DIR = resolve(root, 'public/assets/tilesets');

// Это разовая миграция из Tiled. Источник правды теперь forest.json, и повторный
// запуск затрёт всё, что нарисовано в редакторе.
if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error(`Отмена: ${OUT} уже существует.`);
  console.error('Карта уже сконвертирована, и её могли править в редакторе.');
  console.error('Если правда нужно перезалить её из Tiled и потерять эти правки: --force');
  process.exit(1);
}

/** Парсит .tsx (XML) — нам нужны только image, размеры и анимации. */
function parseTsx(path) {
  const xml = readFileSync(path, 'utf8');
  const attr = (src, name) => src.match(new RegExp(`${name}="([^"]*)"`))?.[1];

  const head = xml.match(/<tileset[^>]*>/)[0];
  const img = xml.match(/<image[^>]*>/)[0];

  const animations = {};
  for (const tile of xml.matchAll(/<tile id="(\d+)">([\s\S]*?)<\/tile>/g)) {
    const frames = [...tile[2].matchAll(/<frame tileid="(\d+)" duration="(\d+)"\/>/g)]
      .map((f) => ({ tileId: +f[1], duration: +f[2] }));
    if (frames.length) animations[+tile[1]] = frames;
  }

  return {
    name: attr(head, 'name'),
    image: attr(img, 'source'),
    imageWidth: +attr(img, 'width'),
    imageHeight: +attr(img, 'height'),
    columns: +attr(head, 'columns'),
    tileCount: +attr(head, 'tilecount'),
    animations,
  };
}

const tiled = JSON.parse(readFileSync(SRC, 'utf8'));

// --- границы нарисованного, чтобы не тащить пустоту ---
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const layer of tiled.layers) {
  for (const c of layer.chunks ?? []) {
    minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.width); maxY = Math.max(maxY, c.y + c.height);
  }
}
const width = maxX - minX;
const height = maxY - minY;

// --- тайлсеты ---
const tilesets = tiled.tilesets.map((ts) => {
  const embedded = ts.source
    ? parseTsx(resolve(dirname(SRC), ts.source))
    : {
        name: ts.name,
        image: basename(ts.image),
        imageWidth: ts.imagewidth,
        imageHeight: ts.imageheight,
        columns: ts.columns,
        tileCount: ts.tilecount,
        animations: Object.fromEntries(
          (ts.tiles ?? [])
            .filter((t) => t.animation)
            .map((t) => [t.id, t.animation.map((f) => ({ tileId: f.tileid, duration: f.duration }))]),
        ),
      };
  return { firstId: ts.firstgid, ...embedded };
});

// --- слои: чанки -> плоский массив ---
const layers = tiled.layers
  .filter((l) => l.type === 'tilelayer')
  .map((layer) => {
    const data = new Array(width * height).fill(0);
    for (const c of layer.chunks ?? []) {
      for (let i = 0; i < c.data.length; i++) {
        const id = c.data[i];
        if (!id) continue;
        const x = c.x - minX + (i % c.width);
        const y = c.y - minY + Math.floor(i / c.width);
        if (x >= 0 && x < width && y >= 0 && y < height) data[y * width + x] = id;
      }
    }
    return { name: layer.name, visible: layer.visible !== false, data };
  });

const map = {
  version: 1,
  width,
  height,
  tileWidth: tiled.tilewidth,
  tileHeight: tiled.tileheight,
  tilesets,
  layers,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(map));

// --- картинки тайлсетов кладём туда, откуда их отдаёт дев-сервер ---
mkdirSync(TILESET_DIR, { recursive: true });
for (const ts of tilesets) {
  copyFileSync(resolve(dirname(SRC), ts.image), resolve(TILESET_DIR, ts.image));
}

// --- отчёт ---
const filled = layers.reduce((n, l) => n + l.data.filter(Boolean).length, 0);
const anims = tilesets.reduce((n, t) => n + Object.keys(t.animations).length, 0);
console.log(`Карта:     ${width}x${height} тайлов (${width * tiled.tilewidth}x${height * tiled.tileheight} px)`);
console.log(`Слоёв:     ${layers.length}`);
console.log(`Тайлсетов: ${tilesets.length}, анимаций: ${anims}`);
console.log(`Тайлов:    ${filled}`);
console.log(`Записано:  ${OUT}`);
console.log(`Картинки:  ${TILESET_DIR}`);
