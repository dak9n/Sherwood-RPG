import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_TREE,
  earnedSkill,
  spentSkill,
  unspentSkill,
  unlocked,
  canAllocate,
  allocate,
  skillBonuses,
  cleanSkills,
  rankOf,
  type SkillRanks,
} from './skilltree.ts';

const fresh = (): SkillRanks => ({});
const node = (id: string) => SKILL_TREE.find((n) => n.id === id)!;

test('каждый узел цел: max>=1, есть эффект, требование — на существующий узел', () => {
  const ids = new Set(SKILL_TREE.map((n) => n.id));
  for (const n of SKILL_TREE) {
    assert.ok(n.maxRank >= 1, `${n.id}: кривой maxRank`);
    assert.ok(Object.values(n.per).some((v) => v !== 0), `${n.id}: ранг ничего не даёт`);
    assert.ok(n.name && n.desc, `${n.id}: нет имени/описания`);
    if (n.requires) {
      assert.ok(ids.has(n.requires.node), `${n.id}: требует несуществующий ${n.requires.node}`);
      assert.ok(n.requires.rank >= 1 && n.requires.rank <= node(n.requires.node).maxRank, `${n.id}: кривое требование`);
    }
  }
});

test('очки навыков: по одному за уровень', () => {
  assert.equal(earnedSkill(1), 0, 'на первом уровне очков нет');
  assert.equal(earnedSkill(2), 1);
  assert.equal(earnedSkill(10), 9);
});

test('требование открывает узел', () => {
  const s = fresh();
  assert.equal(unlocked(node('crit'), s), false, 'крит закрыт без «Острого лезвия»');
  s.blade = 1;
  assert.equal(unlocked(node('crit'), s), true, 'ранг 1 «Лезвия» открыл крит');
  assert.equal(unlocked(node('execute'), s), false, '«Добивание» требует крит 2');
  s.crit = 2;
  assert.equal(unlocked(node('execute'), s), true);
});

test('нельзя вложить в закрытый узел, даже с очками', () => {
  const s = fresh();
  assert.equal(canAllocate('crit', s, 10), false, 'крит закрыт: нет «Лезвия»');
  assert.equal(allocate('crit', s, 10), false);
  assert.equal(rankOf(s, 'crit'), 0);
});

test('нельзя вложить без очков', () => {
  const s = fresh();
  // Уровень 1 -> 0 очков.
  assert.equal(canAllocate('blade', s, 1), false);
  assert.equal(allocate('blade', s, 1), false);
});

test('нельзя вложить сверх предела ранга', () => {
  const s: SkillRanks = { blade: node('blade').maxRank };
  // Уровень с запасом очков, но узел уже макс.
  assert.equal(canAllocate('blade', s, 99), false);
});

test('вложение тратит очко и растит ранг', () => {
  const s = fresh();
  assert.equal(allocate('vigor', s, 3), true); // ур.3 -> 2 очка
  assert.equal(rankOf(s, 'vigor'), 1);
  assert.equal(spentSkill(s), 1);
  assert.equal(unspentSkill(3, s), 1, 'осталось одно очко');
});

test('нельзя вложить больше, чем выдано за уровень', () => {
  const s = fresh();
  // Ур.3 -> 2 очка. Два раза можно, третий — нет.
  assert.equal(allocate('vigor', s, 3), true);
  assert.equal(allocate('vigor', s, 3), true);
  assert.equal(allocate('vigor', s, 3), false, 'очки кончились');
  assert.equal(spentSkill(s), 2);
});

test('бонусы складываются по рангам и узлам', () => {
  const s: SkillRanks = { blade: 3, swift: 2, crit: 4, execute: 2, vampire: 5, vigor: 1 };
  const b = skillBonuses(s);
  assert.equal(b.dmg, 3 * 2, '«Лезвие» 3 ранга -> +6 урона');
  assert.equal(b.speed, 2 * 5, '«Скороход» 2 ранга -> +10 скорости');
  assert.equal(b.critChance, 4 * 0.05, 'крит 4 ранга -> 20%');
  assert.equal(b.critMul, 2 * 0.3, '«Добивание» 2 ранга -> +0.6');
  assert.equal(b.lifesteal, 5 * 0.04, 'вампиризм 5 рангов -> 20%');
  assert.equal(b.hp, 1 * 18);
});

test('урон лука («Меткость») — отдельный канал, не в общем dmg', () => {
  const b = skillBonuses({ aim: 2 });
  assert.equal(b.rangedDmg, 2 * 3);
  assert.equal(b.dmg, 0, 'в общий урон меткость не течёт — только лук');
});

test('санация: чужие узлы и ранг сверх предела режутся', () => {
  const s = cleanSkills({ blade: 99, НЕТ_ТАКОГО: 5, swift: -3 }, 999);
  assert.equal(s.blade, node('blade').maxRank, 'ранг обрезан до предела');
  assert.equal(rankOf(s, 'НЕТ_ТАКОГО'), 0, 'чужого узла нет');
  assert.equal(rankOf(s, 'swift'), 0, 'отрицательный ранг выброшен');
});

test('санация: суммарно не больше выданного за уровень', () => {
  const s = cleanSkills({ blade: 5, vigor: 5, swift: 5 }, 3); // ур.3 -> 2 очка
  const total = spentSkill(s);
  assert.ok(total <= earnedSkill(3), `вложено ${total}, выдано ${earnedSkill(3)}`);
});

test('id-ключ прототипа в дереве не проходит', () => {
  // JSON.parse делает СВОЙ ключ __proto__ (литерал задел бы прототип).
  const evil = JSON.parse('{"__proto__": 5, "constructor": 3, "blade": 2}');
  const s = cleanSkills(evil, 999);
  assert.equal(rankOf(s, 'blade'), 2, 'честный узел цел');
  assert.equal(rankOf(s, '__proto__'), 0, 'фантомные ключи выброшены');
  assert.equal(rankOf(s, 'constructor'), 0);
});
