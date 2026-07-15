import Phaser from 'phaser';
import { usedFrames } from './sprite-frames';

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

/**
 * Ширина сетки листа. Сколько кадров в ряду НАРИСОВАНО — считается по картинке:
 * у idle ряд «вверх» заполнен только на 4 кадра из 12.
 */
const SHEET_COLS = { idle: 12, walk: 6 } as const;

const SPEED = 70;

/**
 * Глубина слоёв карты — индекс*10 (см. buildTilemap). Слои объектов идут
 * последними, поэтому:
 *
 * DEPTH_ABOVE — поверх всей карты: так игрок ходит по траве, камням, пням,
 * кустам и тростнику, не ныряя за них.
 * DEPTH_BEHIND — под слоями объектов: включается, только когда игрок зашёл
 * за большое дерево.
 *
 * Числа привязаны к текущему порядку слоёв: переставят слои — пересчитать.
 */
const DEPTH_ABOVE = 300;
const DEPTH_BEHIND = 215;

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private dir: Dir = 'down';
  /** Клетка -> низ большого дерева в пикселях. Пусто, пока не задано. */
  private tallObjects: Map<number, number> = new Map();
  private mapWidth = 0;
  private tileW = 16;
  private tileH = 16;

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

    this.sprite.setDepth(DEPTH_ABOVE);
    this.play('idle');

    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
  }

  private static createAnims(scene: Phaser.Scene): void {
    if (scene.anims.exists('idle-down')) return;

    for (const [row, dir] of DIRS.entries()) {
      for (const [kind, cols] of Object.entries(SHEET_COLS) as [keyof typeof SHEET_COLS, number][]) {
        const key = kind === 'idle' ? 'sw-idle' : 'sw-walk';
        const frames = usedFrames(scene, key, row, cols);

        scene.anims.create({
          key: `${kind}-${dir}`,
          frames: frames.map((frame) => ({ key, frame })),
          frameRate: kind === 'walk' ? 10 : 8,
          repeat: -1,
        });
      }
    }
  }

  private play(kind: 'idle' | 'walk'): void {
    this.sprite.anims.play(`${kind}-${this.dir}`, true);
  }

  /** Сказать игроку, где большие деревья, чтобы он умел за ними прятаться. */
  setTallObjects(tall: Map<number, number>, mapWidth: number, tileW: number, tileH: number): void {
    this.tallObjects = tall;
    this.mapWidth = mapWidth;
    this.tileW = tileW;
    this.tileH = tileH;
  }

  /**
   * За большим деревом прячемся, всё остальное обходим поверху.
   *
   * Прячемся только когда ноги выше низа дерева: иначе, стоя перед стволом,
   * игрок оказался бы за кроной, хотя визуально он ближе к зрителю.
   */
  private updateDepth(): void {
    const x = Math.floor(this.sprite.x / this.tileW);
    const y = Math.floor(this.sprite.y / this.tileH);
    const baseY = this.tallObjects.get(y * this.mapWidth + x);

    const behind = baseY !== undefined && this.sprite.y < baseY;
    this.sprite.setDepth(behind ? DEPTH_BEHIND : DEPTH_ABOVE);
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

    this.updateDepth();

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
