import Phaser from 'phaser';

/**
 * Огненный шар — активное умение героя (слот 1 хотбара, клавиша «1»).
 *
 * Летит по прямой в сторону курсора, пока не попадёт в монстра, стену или не
 * выдохнется по дальности — ровно как стрела (см. arrow.ts): двигаем и проверяем
 * столкновения вручную в сцене, физику Arcade не подключаем. Отличие от стрелы —
 * стоит ману и перезаряжается (это умение, а не бесконечный лук), и на попадании
 * сцена рисует вспышку-взрыв.
 *
 * Текстуру рисуем кодом: в наборе нет снаряда-огонька, а нарисованный шар с
 * ядром чисто светится в ADD-режиме и не зависит от листов.
 */

const TEX = 'fireball-proj';
/** Пикселей в секунду. Медленнее стрелы (320) — снаряд «тяжёлый», полёт видно. */
export const FIREBALL_SPEED = 250;
/** Дальше не летит: за экраном жечь вслепую незачем, а вечный снаряд — утечка. */
export const FIREBALL_RANGE = 220;
/** Сколько маны стоит каст. При базовом запасе 50 — примерно четыре подряд. */
export const FIREBALL_MP_COST = 12;
/** Перезарядка, мс: умение не спамится, между кастами — пауза. */
export const FIREBALL_COOLDOWN = 1200;
/** Время каста, мс: герой «читает» заклинание, и лишь потом шар вылетает. */
export const FIREBALL_CAST_TIME = 1000;

// Урон умения — в combat.ts (fireballDamage): чистую формулу проверяют тесты, а
// этот файл тянет Phaser и не грузится в node напрямую.

export class Fireball {
  readonly sprite: Phaser.GameObjects.Image;
  private vx: number;
  private vy: number;
  private ox: number;
  private oy: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    angle: number,
    readonly damage: number,
    readonly crit: boolean,
  ) {
    Fireball.ensureTexture(scene);
    this.ox = x;
    this.oy = y;
    this.vx = Math.cos(angle) * FIREBALL_SPEED;
    this.vy = Math.sin(angle) * FIREBALL_SPEED;

    this.sprite = scene.add.image(x, y, TEX);
    // Свечение: складываем цвет с фоном — шар «горит», а не лежит наклейкой.
    this.sprite.setBlendMode(Phaser.BlendModes.ADD);
    // Над травой и добычей, поверх монстров — снаряд должен быть виден в полёте.
    this.sprite.setDepth(320);
  }

  /** Сдвинуть за кадр. delta — миллисекунды. */
  update(delta: number): void {
    const dt = delta / 1000;
    this.sprite.x += this.vx * dt;
    this.sprite.y += this.vy * dt;
    this.sprite.rotation += dt * 12; // лёгкое вращение — «живой» огонёк
  }

  /** Сколько пролетел от места вылета — для проверки дальности. */
  get traveled(): number {
    return Phaser.Math.Distance.Between(this.ox, this.oy, this.sprite.x, this.sprite.y);
  }

  destroy(): void {
    this.sprite.destroy();
  }

  /** Рисуем текстуру огня один раз: тёмно-оранжевый ореол, оранжевое тело, жёлтое ядро. */
  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEX)) return;
    const size = 16;
    const c = size / 2;
    const g = scene.add.graphics();
    g.fillStyle(0x7a2a08, 0.55); // внешний ореол
    g.fillCircle(c, c, 8);
    g.fillStyle(0xe8641a, 0.9); // тело пламени
    g.fillCircle(c, c, 6);
    g.fillStyle(0xffb02e, 1); // горячая середина
    g.fillCircle(c, c, 4);
    g.fillStyle(0xfff2a8, 1); // ядро
    g.fillCircle(c, c, 2);
    g.generateTexture(TEX, size, size);
    g.destroy();
  }
}
