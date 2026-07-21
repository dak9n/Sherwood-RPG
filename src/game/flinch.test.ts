import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFlinch, type FlinchStats } from './flinch.ts';
import { BOSSES, MONSTERS } from './creatures.ts';

const MOB: FlinchStats = {}; // гриб: без брони на замахе и без отката

test('обычный монстр вздрагивает от каждого удара', () => {
  // Это прежнее поведение, и трогать его незачем: прерывание боя уроном —
  // награда игроку за то, что ударил первым. Ломается оно только на боссах.
  assert.equal(decideFlinch({ attacking: false, now: 0, nextFlinchAt: 0 }, MOB), 'flinch');
  assert.equal(decideFlinch({ attacking: true, now: 0, nextFlinchAt: 0 }, MOB), 'flinch');
  assert.equal(decideFlinch({ attacking: false, now: 10, nextFlinchAt: 9999 }, MOB), 'flinch');
});

test('замах босса не сбить ударом', () => {
  const boss: FlinchStats = { steadyAttack: true };
  assert.equal(decideFlinch({ attacking: true, now: 0, nextFlinchAt: 0 }, boss), 'steady');
});

test('вне замаха босс вздрагивает — но не чаще отката', () => {
  const boss: FlinchStats = { steadyAttack: true, flinchMs: 1200 };

  assert.equal(decideFlinch({ attacking: false, now: 0, nextFlinchAt: 0 }, boss), 'flinch');
  assert.equal(decideFlinch({ attacking: false, now: 500, nextFlinchAt: 1200 }, boss), 'steady');
  assert.equal(decideFlinch({ attacking: false, now: 1199, nextFlinchAt: 1200 }, boss), 'steady');
  assert.equal(decideFlinch({ attacking: false, now: 1200, nextFlinchAt: 1200 }, boss), 'flinch');
});

test('замах главнее отката: вздрогнуть уже можно, но удар доводим', () => {
  const boss: FlinchStats = { steadyAttack: true, flinchMs: 1200 };
  assert.equal(decideFlinch({ attacking: true, now: 9999, nextFlinchAt: 0 }, boss), 'steady');
});

// --- воспроизведение самого бага ---

/** Длины анимаций в мс — те же, что задают Monster и Player. */
const HURT_MS = (4 / 12) * 1000; // 333: 4 кадра при 12 к/с
const PLAYER_SWING_MS = (8 / 16) * 1000; // 500: 8 кадров при 16 к/с
const TICK = 1000 / 60;

/**
 * Прогон боя: игрок долбит без остановки, монстр пытается ударить в ответ.
 *
 * Повторяет расстановку сил из Monster.update(): в состояниях 'hurt' и 'attack'
 * монстр не делает НИЧЕГО (там стоит ранний return), а новый замах начинает,
 * только когда вышел откат. Возвращает, сколько раз он успел ударить.
 */
function fight(stats: FlinchStats & { cooldown: number; attackMs: number }, seconds: number): number {
  let doing: 'ready' | 'attack' | 'hurt' = 'ready';
  let until = 0;
  let nextAttackAt = 0;
  let nextFlinchAt = 0;
  let nextPlayerHitAt = 0;
  let landed = 0;

  for (let now = 0; now <= seconds * 1000; now += TICK) {
    if (doing !== 'ready' && now >= until) {
      // Замах доведён до конца — это и есть удар по игроку.
      if (doing === 'attack') {
        landed++;
        nextAttackAt = now + stats.cooldown;
      }
      doing = 'ready';
    }

    if (now >= nextPlayerHitAt) {
      nextPlayerHitAt = now + PLAYER_SWING_MS;
      const reaction = decideFlinch({ attacking: doing === 'attack', now, nextFlinchAt }, stats);
      if (reaction === 'flinch') {
        nextFlinchAt = now + (stats.flinchMs ?? 0);
        doing = 'hurt';
        until = now + HURT_MS;
      }
    }

    if (doing === 'ready' && now >= nextAttackAt) {
      doing = 'attack';
      until = now + stats.attackMs;
    }
  }

  return landed;
}

test('БАГ ЗАКАЗЧИКА: без брони на замахе босс не бьёт вообще', () => {
  // Ровно то, что было в игре: «когда я быстро бью босса, он не успевает меня
  // ударить». Замах 562 мс, удар прилетает каждые 500 — он не успевает никогда.
  // Тест держит саму причину: если однажды steadyAttack потеряется, здесь станет 0.
  const golem = BOSSES.golem1;
  const attackMs = ((golem.cols?.attack ?? 8) / 16) * 1000;
  const broken = fight({ cooldown: golem.cooldown, attackMs }, 30);

  assert.equal(broken, 0, 'без починки босс обязан быть беспомощным — иначе тест ничего не сторожит');
});

test('с починкой босс бьёт в ответ, как бы быстро его ни били', () => {
  for (const [name, b] of Object.entries(BOSSES)) {
    const attackMs = ((b.cols?.attack ?? 8) / 16) * 1000;
    const hits = fight(
      { steadyAttack: b.steadyAttack, flinchMs: b.flinchMs, cooldown: b.cooldown, attackMs },
      30,
    );

    // За полминуты непрерывной долбёжки босс обязан достать игрока много раз.
    // Нижняя граница с запасом: откат 1.7–1.9 с даёт теоретический потолок ~12.
    assert.ok(hits >= 8, `${name}: за 30 с ударил ${hits} раз — его всё ещё лочат`);
  }
});

test('игрок не может залочить босса даже дождём стрел', () => {
  // Дождь стрел бьёт очередью, а не раз в полсекунды. Проверяем крайний случай:
  // урон каждый кадр. Откат вздрагивания обязан удержать босса на ногах.
  const golem = BOSSES.golem3;
  const attackMs = ((golem.cols?.attack ?? 8) / 16) * 1000;

  let doing: 'ready' | 'attack' | 'hurt' = 'ready';
  let until = 0;
  let nextAttackAt = 0;
  let nextFlinchAt = 0;
  let landed = 0;

  for (let now = 0; now <= 30000; now += TICK) {
    if (doing !== 'ready' && now >= until) {
      if (doing === 'attack') {
        landed++;
        nextAttackAt = now + golem.cooldown;
      }
      doing = 'ready';
    }
    // урон КАЖДЫЙ кадр
    const reaction = decideFlinch({ attacking: doing === 'attack', now, nextFlinchAt }, golem);
    if (reaction === 'flinch') {
      nextFlinchAt = now + (golem.flinchMs ?? 0);
      doing = 'hurt';
      until = now + HURT_MS;
    }
    if (doing === 'ready' && now >= nextAttackAt) {
      doing = 'attack';
      until = now + attackMs;
    }
  }

  assert.ok(landed >= 8, `под непрерывным уроном босс ударил ${landed} раз — этого мало`);
});

test('у каждого босса броня на замахе и откат вздрагивания заданы', () => {
  // Забыть их у нового босса — значит вернуть баг молча, поэтому проверяем
  // таблицу, а не только поведение.
  for (const [name, b] of Object.entries(BOSSES)) {
    assert.ok(b.steadyAttack, `${name}: замах можно сбить — босса залочат ударами`);
    const attackMs = ((b.cols?.attack ?? 8) / 16) * 1000;
    assert.ok(
      b.flinchMs && b.flinchMs > attackMs,
      `${name}: откат вздрагивания ${b.flinchMs} не длиннее замаха ${attackMs} — окна на удар не останется`,
    );
  }
});

test('грибов починка не касается', () => {
  for (const [name, m] of Object.entries(MONSTERS)) {
    assert.ok(!m.steadyAttack, `${name}: гриб не должен держать удар — это награда игроку`);
    assert.ok(!m.flinchMs, `${name}: у гриба не должно быть отката вздрагивания`);
  }
});
