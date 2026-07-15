import Phaser from 'phaser';

const SHEETS = 'assets/characters/PNG/Swordsman_lvl1/With_shadow/';
const PREFIX = 'Swordsman_lvl1_';

/** Кадр в листе — 64x64, персонаж внутри примерно 20x30 и стоит на нижней трети. */
const FRAME = 64;

/**
 * Ряды в спрайт-листах идут в этом порядке. Проверено глазами по кадрам:
 * 0 — анфас с двумя глазами, 1 и 2 — профили в разные стороны, 3 — спина.
 */
const DIRS = ['down', 'left', 'right', 'up'] as const;
export type Dir = (typeof DIRS)[number];

/** Сколько кадров в ряду у каждой анимации. */
const SHEET_COLS = { idle: 12, walk: 6 } as const;

const SPEED = 70;

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private dir: Dir = 'down';

  static preload(scene: Phaser.Scene): void {
    scene.load.spritesheet('sw-idle', `${SHEETS}${PREFIX}Idle_with_shadow.png`, {
      frameWidth: FRAME,
      frameHeight: FRAME,
    });
    scene.load.spritesheet('sw-walk', `${SHEETS}${PREFIX}Walk_with_shadow.png`, {
      frameWidth: FRAME,
      frameHeight: FRAME,
    });
  }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    Player.createAnims(scene);

    this.sprite = scene.physics.add.sprite(x, y, 'sw-idle');
    // Точка персонажа — его ноги: так он правильно заходит за деревья и
    // сортируется по глубине. Тень нарисована там же, на нижней трети кадра.
    this.sprite.setOrigin(0.5, 0.75);

    // Хитбокс — не весь кадр 64x64 и даже не весь спрайт, а пятачок под ногами
    // размером примерно с тайл: в виде сверху упираться должны ноги, а не голова,
    // иначе персонаж не пройдёт в проход между деревьями, куда визуально влезает.
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(12, 8);
    body.setOffset(FRAME / 2 - 6, 40);

    // Глубина слоёв карты — индекс*10 (см. buildTilemap). 215 ставит игрока под
    // деревья и тростник (objects2/1/3, reeds — это 220..250) и над травой.
    // Число привязано к текущему порядку слоёв: переставят слои — пересчитать.
    // Правильное решение — сортировка по Y, но она нужна только когда за деревом
    // надо будет прятаться по-настоящему.
    this.sprite.setDepth(215);
    this.play('idle');

    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
  }

  private static createAnims(scene: Phaser.Scene): void {
    if (scene.anims.exists('idle-down')) return;

    for (const [row, dir] of DIRS.entries()) {
      for (const [kind, cols] of Object.entries(SHEET_COLS) as [keyof typeof SHEET_COLS, number][]) {
        const key = kind === 'idle' ? 'sw-idle' : 'sw-walk';
        const start = row * cols;
        // У idle последний ряд короче остальных — берём столько кадров, сколько есть.
        const end = start + cols - 1;

        scene.anims.create({
          key: `${kind}-${dir}`,
          frames: scene.anims.generateFrameNumbers(key, { start, end }),
          frameRate: kind === 'walk' ? 10 : 8,
          repeat: -1,
        });
      }
    }
  }

  private play(kind: 'idle' | 'walk'): void {
    this.sprite.anims.play(`${kind}-${this.dir}`, true);
  }

  update(): void {
    const k = this.keys;
    const left = k.A.isDown || k.LEFT.isDown;
    const right = k.D.isDown || k.RIGHT.isDown;
    const up = k.W.isDown || k.UP.isDown;
    const down = k.S.isDown || k.DOWN.isDown;

    const vx = (right ? 1 : 0) - (left ? 1 : 0);
    const vy = (down ? 1 : 0) - (up ? 1 : 0);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(vx * SPEED, vy * SPEED);
    // По диагонали иначе выходило бы в 1.41 раза быстрее, чем по прямой.
    body.velocity.normalize().scale(SPEED);

    if (!vx && !vy) {
      this.play('idle');
      return;
    }

    // Горизонтальное направление важнее: при ходьбе по диагонали персонаж
    // смотрит вбок, а не назад — так читается лучше.
    if (vx) this.dir = vx > 0 ? 'right' : 'left';
    else this.dir = vy > 0 ? 'down' : 'up';

    this.play('walk');
  }
}
