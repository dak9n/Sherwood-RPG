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

export interface MonsterStats {
  /** Имя папки спрайтов: Mushroom1/2/3. */
  sheet: string;
  /** Короткий префикс ключей анимаций. */
  key: string;
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
  /** Размер тела для столкновений: [ширина, высота] у ног. */
  body: [number, number];
  /** Дальше этого от места появления не уходит — иначе уйдёт в озеро. */
  leash: number;
  xp: number;
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
    sheet: 'Mushroom1', key: 'm1',
    hp: 30, dmg: 3, speed: 50,
    aggro: 80, deaggro: 136, reach: 16, hitW: 18, hitFrame: 4,
    cooldown: 1200, body: [12, 8], leash: 140, xp: 6,
  },
  spider2: {
    sheet: 'Mushroom2', key: 'm2',
    hp: 50, dmg: 6, speed: 45,
    aggro: 90, deaggro: 153, reach: 16, hitW: 18, hitFrame: 4,
    cooldown: 1300, body: [12, 8], leash: 140, xp: 12,
  },
  spider3: {
    sheet: 'Mushroom3', key: 'm3',
    hp: 90, dmg: 10, speed: 38,
    aggro: 100, deaggro: 170, reach: 18, hitW: 22, hitFrame: 4,
    cooldown: 1500, body: [16, 8], leash: 140, xp: 25,
  },
};

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
