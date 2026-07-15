#!/usr/bin/env node
/**
 * Режет куски рам из листов интерфейса в отдельные картинки.
 *
 * Запуск:
 *   node tools/cut-ui.mjs
 *
 * Зачем это нужно. Окно инвентаря должно тянуться под любой размер, а рамки в
 * наборе нарисованы вручную: скруглённые углы, фаски в несколько слоёв. Такое
 * растягивается только девятислайсом (CSS border-image), а border-image умеет
 * работать лишь с ЦЕЛОЙ картинкой — вырезать кусок из общего листа он не может.
 * Отсюда и этот шаг: один раз нарезать, дальше CSS растянет сам.
 *
 * Координаты не угаданы: каждый кусок найден по листу и проверен вырезкой.
 * Менять их руками не надо — если графика в наборе обновится, перезапусти скрипт.
 *
 * Зависимостей нет намеренно: листы — 8-битный RGBA PNG без чересстрочности,
 * это самый простой случай, а zlib в node уже есть.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'public/assets/interface/PNG');
const OUT = resolve(root, 'public/assets/interface/ui');

/**
 * Что режем. Поле slice — ширины рамки девятислайса (верх/право/низ/лево) в
 * пикселях исходника; их же надо указать в CSS border-image-slice.
 */
const PIECES = [
  {
    out: 'window.png', from: 'Main_tiles.png', x: 299, y: 0, w: 26, h: 37,
    slice: [16, 5, 5, 5],
    note: 'Окно целиком: зелёная шапка сверху + коричневое тело. Верх рамки 16 — это вся шапка.',
  },
  {
    out: 'panel_dark.png', from: 'Equipment.png', x: 7, y: 347, w: 34, h: 26,
    slice: [2, 3, 4, 3],
    note: 'Тёмно-коричневая панель. Низ рамки толще верха — так нарисовано.',
  },
  {
    out: 'panel_beige.png', from: 'Equipment.png', x: 39, y: 302, w: 34, h: 23,
    slice: [2, 5, 5, 5],
    note: 'Светло-бежевая панель. Верх всего 2px: в наборе его прикрывает шапка.',
  },
  {
    out: 'tab_on.png', from: 'Main_tiles.png', x: 6, y: 240, w: 20, h: 11,
    slice: [4, 5, 1, 5],
    note: 'Вкладка выбранная (зелёная).',
  },
  {
    out: 'tab_off.png', from: 'Main_tiles.png', x: 70, y: 240, w: 20, h: 11,
    slice: [4, 5, 1, 5],
    note: 'Вкладка невыбранная (коричневая). Тот же силуэт, другой цвет.',
  },
  {
    out: 'button.png', from: 'Craft.png', x: 210, y: 436, w: 43, h: 13,
    slice: [4, 3, 3, 3],
    note: 'Зелёная кнопка без надписи. Нижний ряд листа (тень) срезан: он непрозрачный и рассчитан только на кремовый фон.',
  },
  {
    out: 'close.png', from: 'Equipment.png', x: 143, y: 2, w: 9, h: 9,
    slice: null,
    note: 'Крестик закрытия. Не тянется — кладётся как есть.',
  },
];

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};

/** Возвращает { w, h, px } — px это RGBA по 4 байта на пиксель. */
function decodePng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: это не PNG`);

  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const depth = buf[24];
  const color = buf[25];
  const interlace = buf[28];
  if (depth !== 8 || color !== 6 || interlace !== 0) {
    throw new Error(`${path}: поддерживается только 8-битный RGBA без чересстрочности (тут depth=${depth} color=${color} interlace=${interlace})`);
  }

  const idat = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  const bpp = 4;
  const stride = w * bpp;

  // Снимаем построчные фильтры PNG. Каждая строка начинается с байта фильтра.
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${path}: неизвестный фильтр ${filter}`);
      out[x] = v & 0xff;
    }
  }

  return { w, h, px };
}

function encodePng(w, h, px) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // фильтр «нет»: куски крошечные, экономить нечего
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crop(img, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > img.w || y + h > img.h) {
    throw new Error(`вырезка (${x},${y},${w},${h}) не помещается в лист ${img.w}x${img.h}`);
  }
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    img.px.copy(out, row * w * 4, ((y + row) * img.w + x) * 4, ((y + row) * img.w + x + w) * 4);
  }
  return out;
}

mkdirSync(OUT, { recursive: true });

const sheets = new Map();
for (const p of PIECES) {
  if (!sheets.has(p.from)) sheets.set(p.from, decodePng(resolve(SRC, p.from)));
  const img = sheets.get(p.from);
  const px = crop(img, p.x, p.y, p.w, p.h);
  writeFileSync(resolve(OUT, p.out), encodePng(p.w, p.h, px));
  const slice = p.slice ? `девятислайс ${p.slice.join(' ')}` : 'целиком';
  console.log(`${p.out.padEnd(16)} ${p.w}x${p.h}  <- ${p.from} (${p.x},${p.y})  ${slice}`);
}
console.log(`\nГотово: ${PIECES.length} шт. в public/assets/interface/ui/`);
