import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO, MONSTERS, SPAWNS, xpToNext, rollDrop } from './creatures.ts';
import { ITEMS } from './items.ts';

test('от любого паука можно убежать', () => {
  // Монстр быстрее игрока — это смерть без выхода. Числа держим строго ниже.
  for (const [name, m] of Object.entries(MONSTERS)) {
    assert.ok(m.speed < HERO.speed, `${name}: скорость ${m.speed} не ниже ${HERO.speed}`);
  }
});

test('паук бросается ближе, чем теряет — иначе задёргается на границе', () => {
  for (const [name, m] of Object.entries(MONSTERS)) {
    assert.ok(m.reach < m.aggro, `${name}: бьёт с ${m.reach}, а агрится с ${m.aggro}`);
    assert.ok(m.aggro < m.deaggro, `${name}: агро ${m.aggro} не меньше деагро ${m.deaggro}`);
    // запас нужен, чтобы на границе радиуса состояние не переключалось каждый кадр
    assert.ok(m.deaggro >= m.aggro * 1.5, `${name}: деагро слишком близко к агро`);
  }
});

test('пауза между ударами длиннее самого удара', () => {
  // 8 кадров при 16 к/с — это 500 мс. Если пауза короче, паук бьёт без остановки.
  const attackMs = (8 / 16) * 1000;
  for (const [name, m] of Object.entries(MONSTERS)) {
    assert.ok(m.cooldown > attackMs, `${name}: пауза ${m.cooldown} мс не больше удара ${attackMs} мс`);
  }
});

test('кадр удара существует в анимации', () => {
  // В листах атаки 8 кадров: 0..7.
  assert.ok(HERO.hitFrame >= 0 && HERO.hitFrame < 8);
  for (const [name, m] of Object.entries(MONSTERS)) {
    assert.ok(m.hitFrame >= 0 && m.hitFrame < 8, `${name}: кадр удара ${m.hitFrame} вне анимации`);
  }
});

test('у всех есть здоровье и урон', () => {
  assert.ok(HERO.hp > 0 && HERO.dmgMin > 0 && HERO.dmgMax >= HERO.dmgMin);
  for (const [name, m] of Object.entries(MONSTERS)) {
    assert.ok(m.hp > 0, `${name}: нет здоровья`);
    assert.ok(m.dmg > 0, `${name}: нет урона`);
  }
});

test('расселяем только существующих монстров', () => {
  for (const s of SPAWNS) {
    assert.ok(MONSTERS[s.kind], `в расселении ${s.kind}, а в таблице такого нет`);
    assert.ok(s.count > 0);
  }
});

test('паука можно убить за разумное число взмахов', () => {
  const avg = (HERO.dmgMin + HERO.dmgMax) / 2;
  for (const [name, m] of Object.entries(MONSTERS)) {
    const hits = Math.ceil(m.hp / avg);
    // 3 взмаха на слабого — бодро, 9 на сильного — уже почти пила по дереву
    assert.ok(hits >= 2 && hits <= 10, `${name}: ${hits} взмахов — это не бой`);
  }
});

test('здоровье растёт вместе с размером паука', () => {
  // spider1 27x32, spider2 27x33, spider3 37x40 — глазом видно, кто главнее
  assert.ok(MONSTERS.spider1.hp < MONSTERS.spider2.hp);
  assert.ok(MONSTERS.spider2.hp < MONSTERS.spider3.hp);
  assert.ok(MONSTERS.spider1.xp < MONSTERS.spider3.xp, 'за сильного и опыта больше');
});

test('тяжёлый удар по карману, но не бесконечен', () => {
  const swings = Math.floor(HERO.mp / HERO.heavyCost);
  assert.ok(swings >= 2 && swings <= 4, `${swings} тяжёлых подряд — это перебор или бессмыслица`);
  assert.ok(HERO.heavyMul > 1);
});

test('опыт до уровня растёт', () => {
  assert.equal(xpToNext(1), 20);
  assert.ok(xpToNext(2) > xpToNext(1));
  assert.ok(xpToNext(3) > xpToNext(2));

  // первый уровень — с трёх-четырёх слабых пауков
  assert.ok(xpToNext(1) / MONSTERS.spider1.xp <= 4);
});

// --- добыча ---

test('падает только то, что есть в таблице предметов', () => {
  for (const [name, m] of Object.entries(MONSTERS)) {
    for (const d of m.drop) {
      assert.ok(ITEMS[d.id], `${name} роняет ${d.id}, а такого предмета нет`);
    }
  }
});

test('вероятности осмысленные', () => {
  for (const [name, m] of Object.entries(MONSTERS)) {
    for (const d of m.drop) {
      assert.ok(d.chance > 0 && d.chance <= 1, `${name}/${d.id}: шанс ${d.chance}`);
      if (d.max !== undefined) assert.ok(d.max >= (d.min ?? 1), `${name}/${d.id}: max меньше min`);
    }
  }
});

test('с каждого паука что-то падает достаточно часто, чтобы это заметить', () => {
  for (const [name, m] of Object.entries(MONSTERS)) {
    // вероятность, что не упадёт ничего
    const nothing = m.drop.reduce((p, d) => p * (1 - d.chance), 1);
    assert.ok(nothing < 0.5, `${name}: с вероятностью ${(nothing * 100) | 0}% не падает ничего`);
  }
});

test('каждый надеваемый предмет с кого-то падает', () => {
  // Недостижимый предмет хуже отсутствующего: слот в экипировке обещает то,
  // чего игра не даёт.
  const dropped = new Set(Object.values(MONSTERS).flatMap((m) => m.drop.map((d) => d.id)));
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.slot) assert.ok(dropped.has(id), `${id} надевается, но его неоткуда взять`);
  }
});

test('бросок: всё выпадает при удачном броске и ничего — при неудачном', () => {
  const table = MONSTERS.spider1.drop;
  assert.equal(rollDrop(table, () => 0).length, table.length, 'ноль — выпадает всё');
  assert.equal(rollDrop(table, () => 0.99).length, 0, 'почти единица — не выпадает ничего');
});

test('бросок уважает количество', () => {
  const [drop] = rollDrop([{ id: 'mush_red', chance: 1, min: 2, max: 3 }], () => 0);
  assert.equal(drop.qty, 2, 'при нижнем броске — минимум');

  const [max] = rollDrop([{ id: 'mush_red', chance: 1, min: 2, max: 3 }], () => 0.99);
  assert.equal(max.qty, 3, 'при верхнем — максимум');
});

test('меч с сильного паука выпадает за разумное число боёв', () => {
  const sword = MONSTERS.spider3.drop.find((d) => d.id === 'sword')!;
  const kills = 1 / sword.chance;
  assert.ok(kills <= 8, `меч раз в ${kills.toFixed(1)} убийств — слишком долго`);
});
