/**
 * Характеристики всех существ. Единственное место, где правится баланс.
 *
 * Три паука — это три строки таблицы, а не три класса: чтобы добавить
 * четвёртого монстра, сюда дописывается строка, а код не трогается.
 *
 * Файл намеренно не знает про Phaser: так его покрывают тесты, которые гоняются
 * без браузера.
 */

export interface HeroStats {
  hp: number;
  mp: number;
  /** Урон обычного взмаха: разброс, чтобы удары не были под копирку. */
  dmgMin: number;
  dmgMax: number;
  speed: number;
  /** Как далеко достаёт меч, в пикселях. Столько же выносит его анимация. */
  reach: number;
  /** Ширина зоны удара поперёк направления. */
  hitW: number;
  /** Кадр анимации атаки, на котором засчитывается попадание. */
  hitFrame: number;
  /** Сколько мана стоит тяжёлый удар. */
  heavyCost: number;
  /** Во сколько раз тяжёлый удар сильнее. */
  heavyMul: number;
  /** Неуязвимость после получения урона, мс. */
  iframes: number;
  /** Восстановление в секунду. */
  hpRegen: number;
  mpRegen: number;
  /** Сколько не получать урона, чтобы здоровье пошло вверх, мс. */
  regenDelay: number;
}

/** Что может упасть с монстра. Броски независимые: может упасть всё сразу. */
export interface DropEntry {
  id: string;
  /** Вероятность от 0 до 1. */
  chance: number;
  min?: number;
  max?: number;
}

export interface MonsterStats {
  /** Имя папки спрайтов: Mushroom1/2/3. */
  sheet: string;
  /**
   * Во сколько уменьшить спрайт при отрисовке (1 — как есть, по умолчанию). Арт
   * грибов заполняет кадр и смотрится крупнее героя, поэтому рисуем мельче. На
   * баланс не влияет: тело столкновений (`body`) и зоны удара (`reach`/`hitW`)
   * заданы в мировых пикселях отдельно — вслед за масштабом тело лишь ужимается
   * пропорционально, оставаясь у ног и уже клетки.
   */
  scale?: number;
  /** Короткий префикс ключей анимаций. */
  key: string;
  /** Как зовётся — показывается над монстром вместе с уровнем. */
  name: string;
  /** Уровень монстра. Над ним же; цвет метки — по разнице с уровнем игрока. */
  level: number;
  hp: number;
  dmg: number;
  speed: number;
  /** С какого расстояния бросается на игрока. */
  aggro: number;
  /** С какого расстояния теряет его. Всегда заметно больше aggro — см. тесты. */
  deaggro: number;
  /** С какого расстояния бьёт. */
  reach: number;
  hitW: number;
  hitFrame: number;
  /** Пауза между ударами, мс. Это окно, в которое игрок уворачивается. */
  cooldown: number;
  /**
   * Размер тела для столкновений: [ширина, высота] у ног.
   *
   * Ширина ОБЯЗАНА быть меньше тайла (16). Тело шириной ровно с клетку занимает
   * её целиком, впритык к соседям: даже стоя точно по центру, край оказывается
   * на клетке стены — а из-за погрешности дробных чисел ещё и на тысячные доли
   * ВНУТРИ неё. Физика видит перекрытие и не пускает. Так паук m3 намертво
   * вставал у любого камня: волна вела его вдоль стены, а тело не пролезало.
   * За этим следит тест.
   */
  body: [number, number];
  /** Дальше этого от места появления не уходит — иначе уйдёт в озеро. */
  /**
   * Как далеко от дома паук готов уйти. ОБЯЗАН быть не меньше deaggro, иначе
   * паук успевает уйти за поводок, не потеряв игрока, и начинает дрожать на
   * границе: шаг домой — снова вижу — снова за поводок. За этим следит тест.
   */
  leash: number;
  xp: number;
  /** Сколько золота даёт за убийство: [минимум, максимум]. На него закупаются в магазине. */
  gold: [number, number];
  /** Что с него падает. */
  drop: DropEntry[];
}

export const HERO: HeroStats = {
  hp: 100,
  mp: 50,
  dmgMin: 8,
  dmgMax: 12,
  speed: 70,
  reach: 22,
  hitW: 18,
  hitFrame: 4,
  heavyCost: 20,
  heavyMul: 2.5,
  iframes: 500,
  hpRegen: 2,
  mpRegen: 4,
  regenDelay: 5000,
};

/**
 * Пауки. Здоровье растёт вместе с размером спрайта — разницу видно глазом,
 * а не только в цифрах.
 *
 * Скорость у всех ниже, чем у игрока (70): от любого паука можно убежать.
 * Монстр быстрее игрока — это смерть без выхода.
 *
 * Сколько взмахов на паука при среднем уроне 10: слабый — 3, средний — 5,
 * сильный — 9 (или 4 тяжёлых).
 */
export const MONSTERS: Record<string, MonsterStats> = {
  spider1: {
    sheet: 'Mushroom1', key: 'm1', name: 'Грибок', level: 1, scale: 0.7,
    hp: 30, dmg: 3, speed: 50,
    aggro: 80, deaggro: 136, reach: 16, hitW: 18, hitFrame: 4,
    cooldown: 1200, body: [12, 8], leash: 150, xp: 6, gold: [2, 5],
    // Со слабого падает часто: первую добычу игрок должен увидеть за полминуты,
    // а не гадать, работает ли она вообще.
    drop: [
      { id: 'mush_brown', chance: 0.6, min: 1, max: 2 },
      { id: 'mush_red', chance: 0.15 },
      { id: 'boots', chance: 0.03 },
      { id: 'ring', chance: 0.02 },
    ],
  },
  spider2: {
    sheet: 'Mushroom2', key: 'm2', name: 'Гриб-воин', level: 3, scale: 0.7,
    hp: 50, dmg: 6, speed: 45,
    aggro: 90, deaggro: 153, reach: 16, hitW: 18, hitFrame: 4,
    cooldown: 1300, body: [12, 8], leash: 170, xp: 12, gold: [5, 11],
    drop: [
      { id: 'mush_red', chance: 0.45, min: 1, max: 2 },
      { id: 'mush_brown', chance: 0.3 },
      { id: 'ore_copper', chance: 0.2 },
      { id: 'apple', chance: 0.1 },
      { id: 'potion_hp', chance: 0.08 },
      { id: 'shield', chance: 0.05 },
      { id: 'helm', chance: 0.04 },
      { id: 'amulet', chance: 0.03 },
    ],
  },
  spider3: {
    sheet: 'Mushroom3', key: 'm3', name: 'Гриб-вожак', level: 6, scale: 0.7,
    hp: 90, dmg: 10, speed: 38,
    aggro: 100, deaggro: 170, reach: 18, hitW: 22, hitFrame: 4,
    cooldown: 1500, body: [12, 8], leash: 190, xp: 25, gold: [14, 26],
    // Меч с сильного — примерно с четвёртого убийства. Это несколько минут,
    // а не вечер: экипировка должна начать работать, пока игроку интересно.
    drop: [
      { id: 'mush_red', chance: 0.6, min: 2, max: 3 },
      { id: 'crystal', chance: 0.25 },
      { id: 'ore_copper', chance: 0.25 },
      { id: 'sword', chance: 0.18 },
      { id: 'potion_hp', chance: 0.15 },
      { id: 'potion_mp', chance: 0.12 },
      { id: 'armor', chance: 0.06 },
      { id: 'sword_blue', chance: 0.03 },
    ],
  },
};

/**
 * Что упало с монстра. Броски независимые — с одного паука может упасть
 * и гриб, и меч.
 *
 * rng параметром, чтобы тесты были воспроизводимы.
 */
export function rollDrop(table: DropEntry[], rng: () => number = Math.random): { id: string; qty: number }[] {
  const out: { id: string; qty: number }[] = [];

  for (const entry of table) {
    if (rng() >= entry.chance) continue;
    const min = entry.min ?? 1;
    const max = entry.max ?? min;
    out.push({ id: entry.id, qty: min + Math.floor(rng() * (max - min + 1)) });
  }

  return out;
}

/**
 * Сколько золота упало с монстра. Ровный разброс от min до max включительно.
 * rng параметром — ради воспроизводимых тестов, как и у rollDrop.
 */
export function rollGold([min, max]: [number, number], rng: () => number = Math.random): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Сколько кого расселить по лесу. */
export const SPAWNS: { kind: string; count: number }[] = [
  { kind: 'spider1', count: 8 },
  { kind: 'spider2', count: 5 },
  { kind: 'spider3', count: 3 },
];

/** Опыт до следующего уровня. Первый уровень — с трёх-четырёх пауков. */
export function xpToNext(level: number): number {
  return 20 + (level - 1) * 30;
}
