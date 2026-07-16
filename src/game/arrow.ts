import Phaser from 'phaser';

/**
 * Стрела из лука. Летит по прямой в сторону, куда игрок выстрелил (на курсор),
 * пока не воткнётся в монстра, стену или не выдохнется по дальности.
 *
 * Двигаем и проверяем столкновения вручную в сцене — как у взмаха меча
 * (playerStrike): та же проверка попадания, тот же список монстров. Физику Arcade
 * не подключаем: тело ей тут не нужно, а лишний коллайдер — только путаница.
 *
 * Текстуру рисуем кодом, а не берём из листа: в наборе нет узкой стрелы-снаряда
 * (в Icons.png стрелки — толстые указатели интерфейса), а нарисованная под угол
 * поворачивается чисто.
 */

const TEX = 'arrow-proj';
/** Пикселей в секунду. Заметно быстрее игрока и пауков — стрелу не догнать. */
export const ARROW_SPEED = 320;
/** Дальше не летит: за экраном стрелять вслепую незачем, а вечный снаряд — утечка. */
export const ARROW_RANGE = 240;

export class Arrow {
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
    readonly heavy: boolean,
  ) {
    Arrow.ensureTexture(scene);
    this.ox = x;
    this.oy = y;
    this.vx = Math.cos(angle) * ARROW_SPEED;
    this.vy = Math.sin(angle) * ARROW_SPEED;

    this.sprite = scene.add.image(x, y, TEX);
    this.sprite.setRotation(angle);
    // Над травой и добычей, поверх монстров — снаряд должен быть виден в полёте.
    this.sprite.setDepth(320);
  }

  /** Сдвинуть за кадр. delta — миллисекунды. */
  update(delta: number): void {
    const dt = delta / 1000;
    this.sprite.x += this.vx * dt;
    this.sprite.y += this.vy * dt;
  }

  /** Сколько пролетела от места выстрела — для проверки дальности. */
  get traveled(): number {
    return Phaser.Math.Distance.Between(this.ox, this.oy, this.sprite.x, this.sprite.y);
  }

  destroy(): void {
    this.sprite.destroy();
  }

  /** Рисуем текстуру стрелы один раз: древко, светлый наконечник, тёмное оперение. */
  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEX)) return;
    const w = 18;
    const h = 6;
    const g = scene.add.graphics();
    // Наконечник смотрит в +X: сцена поворачивает стрелу на угол полёта.
    g.fillStyle(0x5a3d22); // древко
    g.fillRect(2, h / 2 - 1, 11, 2);
    g.fillStyle(0xd8d2c4); // наконечник
    g.fillTriangle(12, 0, 18, h / 2, 12, h);
    g.fillStyle(0x9a6b3a); // оперение у хвоста
    g.fillTriangle(0, 0, 4, h / 2, 0, h);
    g.generateTexture(TEX, w, h);
    g.destroy();
  }
}
