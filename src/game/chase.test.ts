import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideChase, type Chase, type ChaseStats } from './chase.ts';
import { MONSTERS } from './creatures.ts';

/** Настоящий паук из таблицы: агро 100, деагро 170, поводок 140. */
const STATS: ChaseStats = { aggro: 100, deaggro: 170, leash: 140 };
const TOL2 = 16 * 16;

const decide = (mode: Chase, toPlayer: number, toHome: number): Chase =>
  decideChase({ mode, toPlayer2: toPlayer * toPlayer, toHome2: toHome * toHome, homeTol2: TOL2 }, STATS);

test('заметил игрока — погнался', () => {
  assert.equal(decide('idle', 90, 0), 'chase');
});

test('игрок далеко — стоим', () => {
  assert.equal(decide('idle', 120, 0), 'idle', 'дальше агро');
});

test('в погоне держимся до деагро, а не до агро', () => {
  // Иначе паук отпускал бы игрока ровно там, где заметил, — и дёргался бы на границе.
  assert.equal(decide('chase', 150, 0), 'chase', 'ещё в пределах деагро');
  assert.equal(decide('chase', 180, 0), 'idle', 'за деагро — отпустил');
});

test('ушёл за поводок — идёт домой', () => {
  assert.equal(decide('chase', 50, 150), 'leash', 'игрок рядом, но дом далеко');
});

test('ВОЗВРАЩЕНИЕ НЕ ПРЕРЫВАЕТСЯ игроком — то самое дрожание', () => {
  // Главный тест. Паук ушёл за поводок, шагнул домой и оказался внутри 140.
  // Раньше он тут же снова кидался на игрока, опять вылетал за поводок, и так
  // без конца — тряска на месте, которую видно как «упёрся и не обходит».
  assert.equal(decide('leash', 30, 139), 'leash', 'почти у поводка, игрок вплотную — всё равно домой');
  assert.equal(decide('leash', 30, 100), 'leash', 'на полпути домой — не отвлекаемся');
  assert.equal(decide('leash', 30, 50), 'leash', 'почти дома — не отвлекаемся');
});

test('дошёл домой — снова живёт обычной жизнью', () => {
  assert.equal(decide('leash', 300, 10), 'idle', 'пришёл, игрока рядом нет');
  assert.equal(decide('leash', 300, 16), 'idle', 'ровно на границе допуска');
});

test('пришёл домой, а игрок рядом — снова погонится, но со следующего шага', () => {
  // Сначала честно «пришёл» (idle), и уже потом обычное правило агро. Так у
  // паука нет состояния, в котором он одновременно возвращается и гонится.
  assert.equal(decide('leash', 50, 5), 'idle');
  assert.equal(decide('idle', 50, 5), 'chase');
});

test('поводок сильнее погони', () => {
  // Порядок проверок важен: сначала дом, потом игрок. Иначе паука утащат в озеро.
  assert.equal(decide('chase', 10, 200), 'leash', 'игрок вплотную, но поводок кончился');
  assert.equal(decide('idle', 10, 200), 'leash');
});

test('у всех пауков в таблице поводок не короче деагро', () => {
  // Именно из-за этого расхождения и родилось дрожание: паук успевал уйти за
  // поводок, всё ещё видя игрока. Состояние 'leash' чинит симптом, а этот тест
  // держит саму таблицу честной — иначе поводок будет срываться в каждой погоне.
  for (const m of Object.values(MONSTERS)) {
    assert.ok(
      m.leash >= m.deaggro,
      `${m.key}: поводок ${m.leash} короче деагро ${m.deaggro} — паук уйдёт за поводок, не потеряв игрока`,
    );
  }
});
