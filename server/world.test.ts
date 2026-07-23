import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapWorld, type WorldPlayer } from './world.ts';

/** Мир на открытом поле: одна клетка непроходима только там, где скажет тест. */
const world = (spawns: { kind: string; x: number; y: number }[], wall?: { cx: number; cy: number }) =>
  new MapWorld(spawns, (cx, cy) => !(wall && wall.cx === cx && wall.cy === cy), 16, 16);

const player = (over: Partial<WorldPlayer> = {}): WorldPlayer => ({
  key: 'p1',
  x: 400,
  y: 400,
  dead: false,
  ...over,
});

test('спавн: мобы стоят по точкам, неизвестный вид пропускается', () => {
  const w = world([
    { kind: 'spider1', x: 100, y: 100 },
    { kind: 'no_such_beast', x: 1, y: 1 },
  ]);
  assert.equal(w.size, 1);
  const [m] = w.snapshot();
  assert.equal(m.k, 'spider1');
  assert.equal(m.x, 100);
  assert.equal(m.m, 'idle');
});

test('далёкий игрок мобу безразличен, близкий — вызывает погоню', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  w.tick(0, 100, [player({ x: 900, y: 900 })]);
  assert.equal(w.snapshot()[0].m, 'idle');

  // Подошёл на дистанцию агрессии (у spider1 это 80).
  w.tick(100, 100, [player({ x: 160, y: 100 })]);
  const [m] = w.snapshot();
  assert.equal(m.m, 'chase');
  assert.equal(m.d, 'right'); // гонится в сторону игрока
  assert.ok(m.x > 100, 'шагнул к игроку');
});

test('догнал — замах, удар прилетает жертве в свой кадр', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  const p = player({ x: 110, y: 100 }); // ближе reach (16)
  w.tick(0, 100, [p]);
  assert.equal(w.snapshot()[0].m, 'attack');

  // Кадр удара у spider1 — hitFrame 4 из 8 при 16 к/с: 250 мс от начала замаха.
  assert.deepEqual(w.tick(200, 100, [p]), []);
  const events = w.tick(260, 100, [p]);
  assert.equal(events.length, 1);
  assert.equal(events[0].player, 'p1');
  assert.ok(events[0].dmg > 0);

  // Второго удара в этом же замахе нет.
  assert.deepEqual(w.tick(300, 100, [p]), []);
});

test('жертва отошла за время замаха — промах', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  w.tick(0, 100, [player({ x: 110, y: 100 })]);
  const events = w.tick(260, 100, [player({ x: 300, y: 100 })]);
  assert.deepEqual(events, []);
});

test('удары складываются, смертельный возвращает dead, труп бить нельзя', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  const hp = w.snapshot()[0].hp;
  assert.equal(w.hit(1, hp - 1, 'a', 0), 'ok');
  assert.equal(w.snapshot()[0].hp, 1);
  assert.equal(w.hit(1, 1, 'b', 0), 'dead');
  assert.equal(w.snapshot()[0].m, 'dead');
  assert.equal(w.hit(1, 5, 'a', 0), 'ignored');
});

test('кривой урон не принимается: отрицательный, дробный мусор, миллион', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  assert.equal(w.hit(1, -5, 'a', 0), 'ignored');
  assert.equal(w.hit(1, NaN, 'a', 0), 'ignored');
  assert.equal(w.hit(1, 1e9, 'a', 0), 'ignored');
  assert.equal(w.snapshot()[0].hp, 30); // hp spider1 не тронут
});

test('мёртвый воскресает дома с полным здоровьем после respawn-паузы', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  // Уводим моба с места погоней, потом убиваем.
  w.tick(0, 1000, [player({ x: 160, y: 100 })]);
  assert.ok(w.snapshot()[0].x > 100);
  w.hit(1, 999, 'a', 1000);
  w.tick(2000, 100, []);
  assert.equal(w.snapshot()[0].m, 'dead');

  w.tick(1000 + 30_000 + 1, 100, []);
  const [m] = w.snapshot();
  assert.equal(m.m, 'idle');
  assert.equal(m.x, 100);
  assert.equal(m.hp, 30);
});

test('стрела издалека провоцирует погоню, поводок уводит домой и лечит', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  const far = player({ x: 400, y: 100 }); // много дальше агрессии (80)
  w.hit(1, 3, 'p1', 0);
  w.tick(0, 100, [far]);
  assert.equal(w.snapshot()[0].m, 'chase');

  // Гонится, пока поводок (150 у spider1) не сработает, дальше — домой до конца.
  for (let t = 100; t < 60_000 && w.snapshot()[0].m !== 'idle'; t += 100) {
    w.tick(t, 100, [far]);
  }
  const [m] = w.snapshot();
  assert.equal(m.m, 'idle');
  assert.equal(m.hp, 30, 'дома здоровье восстановилось');
  assert.ok(Math.hypot(m.x - 100, m.y - 100) <= 16, 'вернулся к дому');
});

test('мёртвых игроков мобы не трогают', () => {
  const w = world([{ kind: 'spider1', x: 100, y: 100 }]);
  w.tick(0, 100, [player({ x: 120, y: 100, dead: true })]);
  assert.equal(w.snapshot()[0].m, 'idle');
});

test('стена съедает ось: моб соскальзывает, а не проходит насквозь', () => {
  // Стена в клетке (7,6) — прямо справа от моба в (6,6) ~ (104,104).
  const w = world([{ kind: 'spider1', x: 104, y: 104 }], { cx: 7, cy: 6 });
  w.hit(1, 1, 'p1', 0); // провокация — гонится даже издалека
  w.tick(0, 500, [player({ x: 220, y: 130 })]); // цель справа-снизу
  const [m] = w.snapshot();
  // Снапшот округляет: фактический 111.8 показывается как 112 — это ещё не
  // стена (её клетка начинается с 112 включительно, внутри было бы 120).
  assert.ok(m.x <= 112, 'в стену не вошёл');
  assert.ok(m.y > 104, 'по свободной оси сдвинулся');
});
