import Phaser from 'phaser';
import { createDirAnims } from './anims';
import { dirFromVelocity, DIRS_MOB, type Dir } from './dir';
import { distSq, hitRect } from './combat';
import type { MonsterStats } from './creatures';
import type { Player } from './player';

const FRAME = 64;
const sheetPath = (sheet: string, anim: string) =>
  `assets/monster/PNG/${sheet}/With_shadow/${sheet}_${anim}_with_shadow.png`;

type State = 'idle' | 'chase' | 'hold' | 'attack' | 'hurt' | 'dead';

/** Труп лежит столько, потом тает. */
const CORPSE_MS = 3000;
/** Через сколько паук возвращается на своё место. */
const RESPAWN_MS = 30000;

export class Monster {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  hp: number;
  private state: State = 'idle';
  private dir: Dir = 'down';
  private didHit = false;
  private nextAttackAt = 0;
  private deadAt = 0;
  private bar: Phaser.GameObjects.Rectangle;
  private barBg: Phaser.GameObjects.Rectangle;

  static preload(scene: Phaser.Scene, stats: MonsterStats): void {
    for (const anim of ['Idle', 'Walk', 'Run', 'Attack', 'Hurt', 'Death']) {
      scene.load.spritesheet(`${stats.key}-${anim.toLowerCase()}`, sheetPath(stats.sheet, anim), {
        frameWidth: FRAME,
        frameHeight: FRAME,
      });
    }
  }

  constructor(
    private scene: Phaser.Scene,
    readonly stats: MonsterStats,
    readonly homeX: number,
    readonly homeY: number,
  ) {
    const k = stats.key;
    createDirAnims(scene, k, DIRS_MOB, {
      idle: { texture: `${k}-idle`, cols: 4, frameRate: 6, loop: true },
      run: { texture: `${k}-run`, cols: 6, frameRate: 10, loop: true },
      attack: { texture: `${k}-attack`, cols: 8, frameRate: 16, loop: false },
      hurt: { texture: `${k}-hurt`, cols: 4, frameRate: 12, loop: false },
      death: { texture: `${k}-death`, cols: 9, frameRate: 12, loop: false },
    });

    this.hp = stats.hp;
    this.sprite = scene.physics.add.sprite(homeX, homeY, `${k}-idle`);
    this.sprite.setOrigin(0.5, 0.75);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(stats.body[0], stats.body[1]);
    body.setOffset(FRAME / 2 - stats.body[0] / 2, 40);
    // Чтобы паука можно было оттолкнуть ударом, и он сам докатился.
    body.setDrag(600, 600);

    this.barBg = scene.add.rectangle(homeX, homeY - 34, 22, 3, 0x000000).setOrigin(0.5).setVisible(false);
    this.bar = scene.add.rectangle(homeX - 10, homeY - 34, 20, 2, 0x8ad46a).setOrigin(0, 0.5).setVisible(false);

    this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.onAnimFrame, this);
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAnimDone, this);
    this.play('idle');
  }

  private play(kind: 'idle' | 'run' | 'attack' | 'hurt' | 'death'): void {
    this.sprite.anims.play(`${this.stats.key}-${kind}-${this.dir}`, kind === 'idle' || kind === 'run');
  }

  /** Момент удара — по номеру кадра в листе (позиции в анимации сдвигают пустые кадры). */
  private onAnimFrame(anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame): void {
    if (this.state !== 'attack' || this.didHit) return;
    if (!anim.key.startsWith(`${this.stats.key}-attack-`)) return;

    const row = DIRS_MOB.indexOf(this.dir);
    if (frame.textureFrame !== row * 8 + this.stats.hitFrame) return;

    this.didHit = true;
    this.pendingHit = hitRect(this.sprite.x, this.sprite.y, this.dir, this.stats.reach, this.stats.hitW);
  }

  /** Зона удара, если паук именно сейчас попал. Сцена заберёт и обнулит. */
  pendingHit: ReturnType<typeof hitRect> | null = null;

  private onAnimDone(anim: Phaser.Animations.Animation): void {
    const k = this.stats.key;
    if (anim.key.startsWith(`${k}-attack-`) && this.state === 'attack') {
      this.state = 'chase';
      this.nextAttackAt = this.scene.time.now + this.stats.cooldown;
    }
    if (anim.key.startsWith(`${k}-hurt-`) && this.state === 'hurt') {
      this.state = 'chase';
    }
  }

  get isDead(): boolean {
    return this.state === 'dead';
  }

  takeDamage(amount: number, fromX: number, fromY: number): void {
    if (this.state === 'dead') return;

    this.hp -= amount;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.sprite.clearTint());
    this.showBar();

    if (this.hp <= 0) {
      this.die();
      return;
    }

    // Отбрасывание: видно, что попал.
    const angle = Math.atan2(this.sprite.y - fromY, this.sprite.x - fromX);
    (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * 220, Math.sin(angle) * 220);

    // Урон прерывает паука — это награда за то, что ударил первым.
    this.state = 'hurt';
    this.play('hurt');
  }

  private die(): void {
    this.hp = 0;
    this.state = 'dead';
    this.deadAt = this.scene.time.now;

    // Тело убираем из физики немедленно и именно так: sprite.disableBody() НЕ
    // убирает тело из дерева поиска, и труп продолжал бы ловить удары.
    this.scene.physics.world.disableBody(this.sprite.body as Phaser.Physics.Arcade.Body);
    (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);

    this.bar.setVisible(false);
    this.barBg.setVisible(false);
    this.play('death');
  }

  private showBar(): void {
    this.bar.setVisible(true);
    this.barBg.setVisible(true);
  }

  private updateBar(): void {
    if (!this.bar.visible) return;
    const frac = Math.max(0, this.hp / this.stats.hp);
    this.bar.width = 20 * frac;
    this.bar.setFillStyle(frac > 0.5 ? 0x8ad46a : frac > 0.25 ? 0xd8c05a : 0xe05c4a);

    const y = this.sprite.y - 34;
    this.barBg.setPosition(this.sprite.x, y);
    this.bar.setPosition(this.sprite.x - 10, y);
    // Глубина каждый кадр: иначе паук уйдёт за крону, а полоска останется поверх дерева.
    this.barBg.setDepth(this.sprite.depth + 0.01);
    this.bar.setDepth(this.sprite.depth + 0.02);
  }

  /** Пора ли воскреснуть. Сцена спросит и позовёт reset. */
  shouldRespawn(now: number): boolean {
    return this.state === 'dead' && now - this.deadAt > RESPAWN_MS;
  }

  reset(): void {
    this.hp = this.stats.hp;
    this.state = 'idle';
    this.dir = 'down';
    this.sprite.setPosition(this.homeX, this.homeY);
    this.sprite.setAlpha(1);
    this.sprite.clearTint();
    this.scene.physics.world.enableBody(this.sprite);
    this.play('idle');
  }

  update(player: Player): void {
    const now = this.scene.time.now;
    this.sprite.setDepth(this.sprite.y);
    this.updateBar();

    if (this.state === 'dead') {
      // Труп полежал — растворяем.
      const age = now - this.deadAt;
      if (age > CORPSE_MS) this.sprite.setAlpha(Math.max(0, 1 - (age - CORPSE_MS) / 1000));
      return;
    }

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;

    if (this.state === 'hurt' || this.state === 'attack') return;

    if (player.isDead) {
      body.setVelocity(0, 0);
      this.state = 'idle';
      this.play('idle');
      return;
    }

    const px = player.sprite.x;
    const py = player.sprite.y;
    const d2 = distSq(this.sprite.x, this.sprite.y, px, py);

    // Далеко от дома — идём обратно: без проходимости погоня утащит паука в озеро.
    const home2 = distSq(this.sprite.x, this.sprite.y, this.homeX, this.homeY);
    if (home2 > this.stats.leash * this.stats.leash) {
      this.moveTo(this.homeX, this.homeY);
      this.hp = this.stats.hp;
      this.bar.setVisible(false);
      this.barBg.setVisible(false);
      return;
    }

    if (this.state === 'chase' && d2 > this.stats.deaggro * this.stats.deaggro) {
      this.state = 'idle';
    }
    if (this.state === 'idle' && d2 < this.stats.aggro * this.stats.aggro) {
      this.state = 'chase';
    }

    if (this.state === 'idle') {
      body.setVelocity(0, 0);
      this.play('idle');
      return;
    }

    // Дошёл — бьём или ждём отката.
    if (d2 < this.stats.reach * this.stats.reach) {
      body.setVelocity(0, 0);
      this.dir = dirFromVelocity(px - this.sprite.x, py - this.sprite.y, this.dir);

      if (now >= this.nextAttackAt) {
        this.state = 'attack';
        this.didHit = false;
        this.play('attack');
      } else {
        // Ждём молча, не наступая на игрока.
        this.play('idle');
      }
      return;
    }

    this.moveTo(px, py);
    this.showBar();
  }

  private moveTo(tx: number, ty: number): void {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const angle = Math.atan2(ty - this.sprite.y, tx - this.sprite.x);
    body.setVelocity(Math.cos(angle) * this.stats.speed, Math.sin(angle) * this.stats.speed);
    this.dir = dirFromVelocity(tx - this.sprite.x, ty - this.sprite.y, this.dir);
    this.play('run');
  }

  destroy(): void {
    this.sprite.destroy();
    this.bar.destroy();
    this.barBg.destroy();
  }
}
