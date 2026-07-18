import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitRect, distSq, rollDamage, fireballDamage } from './combat.ts';

const X = 100;
const Y = 100;
const REACH = 22;
const W = 18;

/** Попадает ли точка в прямоугольник. */
function hits(r: { x: number; y: number; w: number; h: number }, px: number, py: number): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

test('удар вправо бьёт вперёд, а не назад', () => {
  const r = hitRect(X, Y, 'right', REACH, W);
  assert.ok(hits(r, X + 10, Y - 5), 'враг перед носом должен получить');
  assert.ok(!hits(r, X - 10, Y - 5), 'враг за спиной получать не должен');
});

test('удар влево бьёт влево', () => {
  const r = hitRect(X, Y, 'left', REACH, W);
  assert.ok(hits(r, X - 10, Y - 5));
  assert.ok(!hits(r, X + 10, Y - 5));
});

test('удар вниз бьёт вниз', () => {
  const r = hitRect(X, Y, 'down', REACH, W);
  assert.ok(hits(r, X, Y + 8));
  assert.ok(!hits(r, X, Y - 20));
});

test('удар вверх бьёт вверх', () => {
  const r = hitRect(X, Y, 'up', REACH, W);
  assert.ok(hits(r, X, Y - 12));
  assert.ok(!hits(r, X, Y + 8));
});

test('дальше вытянутой руки не достаёт', () => {
  const r = hitRect(X, Y, 'right', REACH, W);
  assert.ok(!hits(r, X + REACH + 5, Y - 5), 'враг за пределом досягаемости цел');
});

test('тяжёлый удар достаёт дальше обычного', () => {
  const light = hitRect(X, Y, 'right', REACH, W);
  const heavy = hitRect(X, Y, 'right', REACH + 8, W + 8);
  const far = X + REACH + 4;

  assert.ok(!hits(light, far, Y - 5), 'обычный не достаёт');
  assert.ok(hits(heavy, far, Y - 5), 'тяжёлый достаёт');
});

test('зона удара вбок держится на уровне корпуса, а не под ногами', () => {
  const r = hitRect(X, Y, 'right', REACH, W);
  // ноги существа на Y; корпус выше — туда и бьём
  assert.ok(r.y < Y, 'зона должна захватывать корпус');
  assert.ok(r.y + r.h >= Y, 'и доставать до ног');
});

test('квадрат расстояния считается верно', () => {
  assert.equal(distSq(0, 0, 3, 4), 25);
  assert.equal(distSq(10, 10, 10, 10), 0);
  // сравнение с радиусом работает без корня
  assert.ok(distSq(0, 0, 50, 0) < 80 * 80, 'в радиусе агро');
  assert.ok(distSq(0, 0, 90, 0) > 80 * 80, 'вне радиуса');
});

test('урон всегда в заданных пределах', () => {
  for (const roll of [0, 0.5, 0.999]) {
    const d = rollDamage(8, 12, () => roll);
    assert.ok(d >= 8 && d <= 12, `выпало ${d}`);
  }
});

test('урон огненного шара растёт с уровнем и не уходит в минус', () => {
  assert.equal(fireballDamage(1), 16, 'на первом уровне — база');
  assert.equal(fireballDamage(2), 19, '+3 за уровень');
  assert.equal(fireballDamage(5), 28);
  assert.equal(fireballDamage(0), 16, 'уровень ниже 1 — как первый');
  assert.equal(fireballDamage(-3), 16);
  assert.equal(fireballDamage(3.9), 22, 'дробный уровень — вниз до целого');
});
