#!/usr/bin/env node
/**
 * Считает, ГДЕ и ПОД КАКИМ УГЛОМ герой держит оружие в каждом кадре анимации.
 *
 * Набор персонажа разложен на слои (Parts/): тело отдельно, меч отдельно. Слой
 * меча уже анимирован художником покадрово — значит в нём записано всё, что нам
 * нужно: положение рукояти и наклон клинка. Мы это просто вычитываем.
 *
 * Как считаем на кадре:
 *   - берём непрозрачные пиксели слоя меча;
 *   - главная ось облака (PCA) даёт НАКЛОН клинка;
 *   - из двух концов оси рукоятью считаем тот, что БЛИЖЕ К ТЕЛУ (его центр берём
 *     из слоя body): рука — на теле, а клинок торчит наружу. Брать «нижний конец»
 *     нельзя: меч у героя свисает вниз, и низом оказывается остриё.
 * Пустой кадр (меча не видно) отмечаем null — там оружие не рисуем.
 *
 * Запуск:  node tools/weapon-anchors.mjs
 * Результат: src/game/weapon-anchors.json — таблица {анимация: [кадр, ...]},
 * её читает игра, чтобы посадить ЛЮБУЮ иконку оружия в руку по кадрам.
 *
 * Зачем офлайн-инструмент, а не расчёт в игре: разбирать пиксели восьми листов
 * на старте — лишняя работа на каждом запуске, а картинки не меняются.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = resolve(root, 'public/assets/characters/PNG/Swordsman_lvl1/Parts');
const OUT = resolve(root, 'src/game/weapon-anchors.json');
const FRAME = 64;

/**
 * Анимации героя: имя в игре -> файл слоя меча и сетка кадров.
 * Ряды — направления (вниз, влево, вправо, вверх), как во всех листах набора.
 */
const ANIMS = [
  { key: 'idle', file: 'Swordsman_lvl1_Idle_sword.png', back: 'Swordsman_lvl1_Idle_sword_back.png', body: 'Swordsman_lvl1_Idle_body.png' },
  { key: 'walk', file: 'Swordsman_lvl1_Walk_sword.png', back: 'Swordsman_lvl1_Walk_sword_back.png', body: 'Swordsman_lvl1_Walk_body.png' },
  { key: 'attack', file: 'Swordsman_lvl1_attack_sword.png', back: 'Swordsman_lvl1_attack_sword_back.png', body: 'Swordsman_lvl1_attack_body.png' },
  { key: 'death', file: 'Swordsman_lvl1_Death_sword.png', back: 'Swordsman_lvl1_Death_sword_back.png', body: 'Swordsman_lvl1_Death_body.png' },
];

/** Минимальный разбор PNG через zlib: набор — обычные 8-битные RGBA без чересстрочности. */
function readPng(path) {
  const zlib = require('node:zlib');
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: не png`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const color = buf[25];
  const interlace = buf[28];
  if (depth !== 8 || color !== 6 || interlace !== 0) {
    throw new Error(`${path}: ожидался 8-битный RGBA без чересстрочности (depth=${depth} color=${color})`);
  }

  // Склеиваем все IDAT: они могут быть разбиты на несколько кусков.
  const chunks = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') chunks.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));

  // Снимаем построчные фильтры PNG (спецификация, раздел Filtering).
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

/**
 * Якорь оружия на кадре: {x, y, angle} в пикселях кадра, angle в градусах.
 * null — на кадре оружия нет (пустой слой).
 */
function anchorOf(img, fx, fy, bodyCenter) {
  const pts = [];
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const i = ((fy + y) * img.width + (fx + x)) * 4;
      if (img.data[i + 3] > 24) pts.push([x, y]);
    }
  }
  if (pts.length < 6) return null; // пары пикселей мало: считать наклон не по чему

  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;

  // Главная ось облака точек — направление клинка (PCA на 2x2 ковариации).
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx, dy = y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta), uy = Math.sin(theta);

  // Проекции на ось дают два конца клинка. Рукоять — тот, что ближе к телу
  // (рука на теле), остриё — дальний. Без тела ориентира нет, поэтому запасной
  // вариант — ближе к центру кадра, где герой и стоит.
  let tMin = Infinity, tMax = -Infinity;
  for (const [x, y] of pts) {
    const t = (x - mx) * ux + (y - my) * uy;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const endA = [mx + ux * tMin, my + uy * tMin];
  const endB = [mx + ux * tMax, my + uy * tMax];
  const ref = bodyCenter ?? [FRAME / 2, FRAME / 2];
  const dA = Math.hypot(endA[0] - ref[0], endA[1] - ref[1]);
  const dB = Math.hypot(endB[0] - ref[0], endB[1] - ref[1]);
  const grip = dA <= dB ? endA : endB;
  const tip = grip === endA ? endB : endA;

  // Угол от рукояти к острию — под него поворачиваем иконку оружия.
  const angle = (Math.atan2(tip[1] - grip[1], tip[0] - grip[0]) * 180) / Math.PI;
  return {
    x: Math.round(grip[0] * 10) / 10,
    y: Math.round(grip[1] * 10) / 10,
    angle: Math.round(angle * 10) / 10,
    len: Math.round(Math.hypot(tip[0] - grip[0], tip[1] - grip[1]) * 10) / 10,
  };
}

/** Центр непрозрачных пикселей кадра — им пользуемся как «где тело». */
function centroidOf(img, fx, fy) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const i = ((fy + y) * img.width + (fx + x)) * 4;
      if (img.data[i + 3] > 24) { sx += x; sy += y; n++; }
    }
  }
  return n ? [sx / n, sy / n] : null;
}

const out = {};
for (const anim of ANIMS) {
  const front = resolve(PARTS, anim.file);
  const back = resolve(PARTS, anim.back);
  const bodyPath = resolve(PARTS, anim.body);
  if (!existsSync(front)) {
    console.error(`  пропущен ${anim.key}: нет ${anim.file}`);
    continue;
  }
  const imgF = readPng(front);
  const imgB = existsSync(back) ? readPng(back) : null;
  const imgBody = existsSync(bodyPath) ? readPng(bodyPath) : null;
  const cols = imgF.width / FRAME;
  const rows = imgF.height / FRAME;

  const frames = [];
  let found = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const body = imgBody ? centroidOf(imgBody, c * FRAME, r * FRAME) : null;
      // Сначала меч спереди; пусто — пробуем «из-за спины» (герой смотрит вверх).
      const f = anchorOf(imgF, c * FRAME, r * FRAME, body);
      const b = imgB && !f ? anchorOf(imgB, c * FRAME, r * FRAME, body) : null;
      const a = f ?? b;
      frames.push(a ? { ...a, behind: !f && !!b } : null);
      if (a) found++;
    }
  }
  out[anim.key] = { cols, rows, frames };
  console.log(`  ${anim.key}: ${cols}x${rows} = ${frames.length} кадров, с оружием ${found}`);
}

/**
 * Эталонная длина клинка — медиана по СПОКОЙНЫМ анимациям (покой и ходьба).
 *
 * Кадры замаха для этого не годятся: там художник рисует смазанный след, и
 * длина облака пикселей взлетает втрое (до 24 против обычных 8). Если тянуть
 * оружие по ней, на долю секунды посреди удара меч раздувается — что и было
 * видно в игре. Меч — предмет жёсткий: длина у него одна, меняются лишь
 * положение и наклон.
 */
const calm = ['idle', 'walk'].flatMap((k) => (out[k]?.frames ?? []).filter(Boolean).map((f) => f.len));
calm.sort((a, b) => a - b);
const bladeLen = calm.length ? calm[Math.floor(calm.length / 2)] : 8;

writeFileSync(OUT, JSON.stringify({ bladeLen, anims: out }, null, 1) + '\n');
console.log(`\nэталонная длина клинка: ${bladeLen} px (медиана покоя и ходьбы)`);
console.log(`записано: ${OUT}`);
