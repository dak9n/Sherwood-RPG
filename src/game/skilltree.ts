/**
 * Дерево навыков героя (окно на клавише L).
 *
 * Отдельно от окна «Умения» (U): там простая раздача очков в четыре
 * характеристики, а здесь — ветвящееся дерево пассивных навыков с требованиями.
 * Очки навыков дают за уровень (по одному), и каждый вложенный ранг ЧЕСТНО
 * влияет на игру — крит, вампиризм, скорость, урон лука и так далее.
 *
 * Чистая логика: ни Phaser, ни DOM — поэтому под тестами. Окно только рисует
 * дерево и шлёт «вложить сюда»; можно/нельзя решает allocate.
 */

export type SkillBranch = 'power' | 'agility' | 'survival';

/** Что даёт ОДИН ранг узла. Всё складывается по рангам и по узлам. */
export interface SkillEffect {
  /** К урону (меч и лук). */
  dmg?: number;
  /** К скорости бега. */
  speed?: number;
  /** К запасу маны. */
  mp?: number;
  /** К максимуму здоровья. */
  hp?: number;
  /** К защите. */
  def?: number;
  /** К урону, но ТОЛЬКО когда надет лук. */
  rangedDmg?: number;
  /** К шансу крита, доля 0..1. */
  critChance?: number;
  /** К множителю крита (сверх базового). */
  critMul?: number;
  /** Вампиризм: доля урона возвращается здоровьем, 0..1. */
  lifesteal?: number;
}

export interface SkillNode {
  id: string;
  name: string;
  branch: SkillBranch;
  maxRank: number;
  /** Что даёт один ранг. */
  per: SkillEffect;
  /** Человеческое описание одного ранга — для окна. */
  desc: string;
  /** Требование: узел req нужен рангом не ниже rank. Пусто — открыт сразу. */
  requires?: { node: string; rank: number };
}

/** Очков навыков за уровень. */
export const SKILL_PER_LEVEL = 1;

/** Базовый множитель крита; навык «Добивание» добавляет к нему. */
export const BASE_CRIT_MUL = 1.5;

export const BRANCH_NAME: Record<SkillBranch, string> = {
  power: 'Power',
  agility: 'Agility',
  survival: 'Survival',
};

/**
 * Само дерево. Три ветви, в каждой узлы идут сверху вниз по зависимостям.
 * Числа подобраны так, чтобы ранг ощущался, но набирался за несколько уровней.
 */
export const SKILL_TREE: SkillNode[] = [
  // --- Сила: урон и крит ---
  { id: 'blade', branch: 'power', name: 'Sharp Blade', maxRank: 5, per: { dmg: 2 }, desc: '+2 damage' },
  {
    id: 'crit', branch: 'power', name: 'Precise Strike', maxRank: 4, per: { critChance: 0.05 },
    desc: '+5% crit chance', requires: { node: 'blade', rank: 1 },
  },
  {
    id: 'execute', branch: 'power', name: 'Execute', maxRank: 3, per: { critMul: 0.3 },
    desc: '+30% crit damage', requires: { node: 'crit', rank: 2 },
  },

  // --- Ловкость: скорость, лук, мана ---
  { id: 'swift', branch: 'agility', name: 'Swiftfoot', maxRank: 5, per: { speed: 5 }, desc: '+5 Speed' },
  {
    id: 'aim', branch: 'agility', name: 'Marksmanship', maxRank: 4, per: { rangedDmg: 3 },
    desc: '+3 bow damage', requires: { node: 'swift', rank: 1 },
  },
  {
    id: 'focus', branch: 'agility', name: 'Focus', maxRank: 4, per: { mp: 15 },
    desc: '+15 Mana', requires: { node: 'swift', rank: 1 },
  },

  // --- Выживание: здоровье, защита, вампиризм ---
  { id: 'vigor', branch: 'survival', name: 'Vigor', maxRank: 5, per: { hp: 18 }, desc: '+18 Health' },
  {
    id: 'armor', branch: 'survival', name: 'Toughness', maxRank: 5, per: { def: 1 },
    desc: '+1 Defense', requires: { node: 'vigor', rank: 1 },
  },
  {
    id: 'vampire', branch: 'survival', name: 'Lifesteal', maxRank: 5, per: { lifesteal: 0.04 },
    desc: '+4% damage returned as Health', requires: { node: 'vigor', rank: 2 },
  },
];

/** Вложенные ранги: id узла -> ранг. */
export type SkillRanks = Record<string, number>;

const NODE = new Map(SKILL_TREE.map((n) => [n.id, n]));

/** Сколько очков навыков выдано всего за путь до этого уровня. */
export function earnedSkill(level: number): number {
  return Math.max(0, Math.floor(level) - 1) * SKILL_PER_LEVEL;
}

/** Сколько очков навыков вложено. */
export function spentSkill(ranks: SkillRanks): number {
  return SKILL_TREE.reduce((n, node) => n + (ranks[node.id] ?? 0), 0);
}

/** Сколько очков навыков осталось. */
export function unspentSkill(level: number, ranks: SkillRanks): number {
  return earnedSkill(level) - spentSkill(ranks);
}

/** Ранг узла (0, если не вложен). */
export function rankOf(ranks: SkillRanks, id: string): number {
  return Object.hasOwn(ranks, id) ? ranks[id] : 0;
}

/** Открыт ли узел — выполнено ли требование по узлу-предку. */
export function unlocked(node: SkillNode, ranks: SkillRanks): boolean {
  if (!node.requires) return true;
  return rankOf(ranks, node.requires.node) >= node.requires.rank;
}

/** Можно ли вложить ещё ранг: есть очко, не предел, требование выполнено. */
export function canAllocate(nodeId: string, ranks: SkillRanks, level: number): boolean {
  const node = NODE.get(nodeId);
  if (!node) return false;
  if (rankOf(ranks, nodeId) >= node.maxRank) return false;
  if (unspentSkill(level, ranks) <= 0) return false;
  return unlocked(node, ranks);
}

/** Вложить ранг. Возвращает false, если нельзя. При успехе мутирует ranks. */
export function allocate(nodeId: string, ranks: SkillRanks, level: number): boolean {
  if (!canAllocate(nodeId, ranks, level)) return false;
  ranks[nodeId] = rankOf(ranks, nodeId) + 1;
  return true;
}

export interface SkillBonus {
  dmg: number;
  speed: number;
  mp: number;
  hp: number;
  def: number;
  rangedDmg: number;
  critChance: number;
  critMul: number;
  lifesteal: number;
}

/** Во что складываются все вложенные ранги. */
export function skillBonuses(ranks: SkillRanks): SkillBonus {
  const b: SkillBonus = { dmg: 0, speed: 0, mp: 0, hp: 0, def: 0, rangedDmg: 0, critChance: 0, critMul: 0, lifesteal: 0 };
  for (const node of SKILL_TREE) {
    const r = rankOf(ranks, node.id);
    if (r <= 0) continue;
    const p = node.per;
    b.dmg += (p.dmg ?? 0) * r;
    b.speed += (p.speed ?? 0) * r;
    b.mp += (p.mp ?? 0) * r;
    b.hp += (p.hp ?? 0) * r;
    b.def += (p.def ?? 0) * r;
    b.rangedDmg += (p.rangedDmg ?? 0) * r;
    b.critChance += (p.critChance ?? 0) * r;
    b.critMul += (p.critMul ?? 0) * r;
    b.lifesteal += (p.lifesteal ?? 0) * r;
  }
  return b;
}

/**
 * Санация рангов из сейва: только НАШИ узлы, ранг в 0..max, а суммарно вложено
 * не больше, чем выдано за уровень (иначе подделанный сейв дал бы дерево целиком
 * на первом уровне). Требования по узлам тут не проверяем: на бонус они не
 * влияют (критурон без шанса крита бесполезен), а ранг всё равно ограничен.
 */
export function cleanSkills(raw: unknown, level: number): SkillRanks {
  const out: SkillRanks = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;

  for (const node of SKILL_TREE) {
    const v = Object.hasOwn(src, node.id) ? src[node.id] : 0;
    const r = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
    if (r > 0) out[node.id] = Math.min(node.maxRank, r);
  }

  // Излишек сверх выданного за уровень срезаем — с более глубоких узлов первыми,
  // чтобы обрезка не оставила «висящих» рангов без основания.
  const cap = earnedSkill(level);
  let total = spentSkill(out);
  for (let i = SKILL_TREE.length - 1; i >= 0 && total > cap; i--) {
    const id = SKILL_TREE[i].id;
    const have = out[id] ?? 0;
    if (!have) continue;
    const cut = Math.min(have, total - cap);
    out[id] = have - cut;
    if (out[id] === 0) delete out[id];
    total -= cut;
  }
  return out;
}
