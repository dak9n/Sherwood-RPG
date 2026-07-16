import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMinimap, insideCircle, fitScale } from './minimap.ts';
import { unpackGid, packGid, tileTransform } from '../map/gid.ts';

const SIZE = 110;
const SCALE = 0.3;

test('игрок всегда ровно в середине окошка', () => {
  // На этом держится вся мини-карта: кружок показывает мир вокруг игрока.
  for (const [px, py] of [[0, 0], [700, 560], [1439, 1119]]) {
    const p = toMinimap(px, py, px, py, SIZE, SCALE);
    assert.deepEqual(p, { x: SIZE / 2, y: SIZE / 2 }, `игрок в (${px},${py})`);
  }
});

test('смещение в мире даёт смещение на мини-карте с масштабом', () => {
  const p = toMinimap(700 + 100, 560 - 50, 700, 560, SIZE, SCALE);
  assert.equal(p.x, SIZE / 2 + 100 * SCALE);
  assert.equal(p.y, SIZE / 2 - 50 * SCALE);
});

test('круглое окошко отсекает углы', () => {
  const c = SIZE / 2;
  assert.equal(insideCircle(c, c, SIZE), true, 'центр');
  assert.equal(insideCircle(c + 54, c, SIZE), true, 'у самого края');
  assert.equal(insideCircle(0, 0, SIZE), false, 'угол квадрата — вне круга');
  assert.equal(insideCircle(SIZE, SIZE, SIZE), false, 'противоположный угол');
});

test('отступ поджимает круг', () => {
  const c = SIZE / 2;
  assert.equal(insideCircle(c + 54, c, SIZE), true);
  assert.equal(insideCircle(c + 54, c, SIZE, 10), false, 'с отступом 10 точка уже за кругом');
});

test('карта целиком влезает в окно по меньшей стороне', () => {
  // Лес 1440x1120 в окно 800x600: по ширине влезло бы 0.55, по высоте 0.53 —
  // берём меньшее, иначе карта вылезет за край.
  const s = fitScale(1440, 1120, 800, 600);
  assert.equal(s, 600 / 1120);
  assert.ok(1440 * s <= 800 + 1e-9, 'по ширине помещается');
  assert.ok(1120 * s <= 600 + 1e-9, 'по высоте помещается');
});

test('вырожденная карта не роняет масштаб', () => {
  assert.equal(fitScale(0, 0, 800, 600), 1);
});

test('схлопнутое окно не даёт отрицательный масштаб', () => {
  // Поймано на живой игре: у свёрнутой панели окно 0x0, и окно_минус_поля дало
  // -120. Масштаб уходил в минус — карта отражалась задом наперёд, а ширина в
  // стилях становилась невалидной и молча игнорировалась.
  for (const [w, h] of [[0, 0], [-120, -120], [800, 0], [0, 600]]) {
    const s = fitScale(1232, 672, w, h);
    assert.ok(s > 0, `окно ${w}x${h} дало масштаб ${s}`);
  }
});

test('флаги отражения переживают упаковку', () => {
  for (const h of [false, true]) {
    for (const v of [false, true]) {
      for (const d of [false, true]) {
        const raw = packGid(1234, { h, v, d });
        const back = unpackGid(raw);
        assert.equal(back.gid, 1234);
        assert.deepEqual(back.flips, { h, v, d }, `${h}/${v}/${d}`);
      }
    }
  }
});

test('преобразование тайла совпадает с таблицей Phaser', () => {
  // Мини-карта обязана рисовать тайл так же, как игра под ногами. Числа взяты
  // из Phaser (ParseGID) — если он поменяет трактовку, тест это поймает.
  const Q = Math.PI / 2;
  const cases: [boolean, boolean, boolean, number, boolean][] = [
    [false, false, false, 0, false],
    [true, false, false, 0, true],
    [false, true, false, Math.PI, true],
    [true, true, false, Math.PI, false],
    [false, false, true, 3 * Q, true],
    [true, false, true, Q, false],
    [false, true, true, 3 * Q, false],
    [true, true, true, Q, true],
  ];
  for (const [h, v, d, rotation, flipX] of cases) {
    assert.deepEqual(tileTransform({ h, v, d }), { rotation, flipX }, `h=${h} v=${v} d=${d}`);
  }
});

test('без флагов тайл не поворачивается и не отражается', () => {
  // Это 96% тайлов леса — быстрый путь в bakeMap рассчитан именно на них.
  assert.deepEqual(tileTransform({ h: false, v: false, d: false }), { rotation: 0, flipX: false });
});
