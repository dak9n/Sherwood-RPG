import Phaser from 'phaser';
import { createDirAnims } from './anims';
import { creatureDepth } from './depth';
import { dirFromVelocity, DIRS_MOB, type Dir } from './dir';
import { distSq, hitRect } from './combat';
import { nextStep, UNREACHABLE } from './flow';
import { decideChase } from './chase';
import type { MonsterStats } from './creatures';
import type { Player } from './player';

const FRAME = 64;
const sheetPath = (sheet: string, anim: string) =>
  `assets/monster/PNG/${sheet}/With_shadow/${sheet}_${anim}_with_shadow.png`;

type State = 'idle' | 'chase' | 'leash' | 'attack' | 'hurt' | 'dead';

/** Труп лежит столько, потом тает. */
const CORPSE_MS = 3000;
/** Через сколько паук возвращается на своё место. */
const RESPAWN_MS = 30000;
/** Разрешение текста метки: мелкий шрифт под зумом 3 без этого превратился бы в мыло. */
const LABEL_RES = 5;
/** Полоска здоровья — на сколько над ногами монстра (в его масштабе). */
const BAR_DY = 34;
/** Метка «имя ур.N» — на сколько над ногами (чуть выше полоски). */
const NAME_DY = 37;

/**
 * Цвет метки по разнице «уровень монстра − уровень игрока», как в MMORPG:
 * серый — добыча пустяковая, зелёный — легко, жёлтый — ровня, оранжевый —
 * опасно, красный — сильно выше. По цвету сразу видно, лезть или обойти.
 */
function threatColor(diff: number): string {
  if (diff >= 4) return '#e05c4a';
  if (diff >= 2) return '#e0a34a';
  if (diff >= -1) return '#e6d36a';
  if (diff >= -3) return '#8ad46a';
  return '#a7a7a7';
}

export class Monster {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  hp: number;
  private state: State = 'idle';
  private dir: Dir = 'down';
  private didHit = false;
  /** Задели ударом — гонится за игроком даже издалека, пока поводок не уведёт домой. */
  private provoked = false;
  private nextAttackAt = 0;
  private deadAt = 0;
  private bar: Phaser.GameObjects.Rectangle;
  private barBg: Phaser.GameObjects.Rectangle;
  /** Метка «имя ур.N» над монстром. */
  private nameTag: Phaser.GameObjects.Text;
  /** Во сколько уменьшён спрайт (1 — как есть). Метку и полоску сдвигаем в тот же масштаб, чтобы не висели над мелким грибом. */
  private readonly scale: number;
  /** Последний выставленный цвет метки — чтобы не дёргать setColor каждый кадр. */
  private tagColor = '';

  /** Большие деревья: чтобы паук прятался за ними так же, как игрок. */
  private tallObjects: Map<number, number> = new Map();
  private mapWidth = 0;
  private mapHeight = 0;
  private tileW = 16;
  private tileH = 16;

  /**
   * Волна от игрока: в каждой клетке — сколько шагов до него. Одна на всех
   * пауков, считает и обновляет сцена. null — пока не посчитана.
   */
  private flow: Int32Array | null = null;

  setFlow(flow: Int32Array | null): void {
    this.flow = flow;
  }

  /** Сказать пауку, где большие деревья. Зовётся сценой один раз, как у игрока. */
  setTallObjects(tall: Map<number, number>, mapWidth: number, mapHeight: number, tileW: number, tileH: number): void {
    this.tallObjects = tall;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.tileW = tileW;
    this.tileH = tileH;
  }

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
    this.scale = stats.scale ?? 1;
    this.sprite = scene.physics.add.sprite(homeX, homeY, `${k}-idle`);
    this.sprite.setOrigin(0.5, 0.75);
    // Масштаб ДО setSize: тело считается от масштаба спрайта. Смещения (центр по
    // ширине и низ у ног) от масштаба не зависят — множитель в них сокращается,
    // так что тело просто ужимается пропорционально, оставаясь у ног.
    this.sprite.setScale(this.scale);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(stats.body[0], stats.body[1]);
    body.setOffset(FRAME / 2 - stats.body[0] / 2, 40);
    // Пауки толкают друг друга (в сцене есть коллайдер группы) — трение гасит
    // толчок, чтобы толкнутый докатился и встал, а не скользил без конца.
    body.setDrag(600, 600);

    this.barBg = scene.add.rectangle(homeX, homeY - BAR_DY * this.scale, 22, 3, 0x000000).setOrigin(0.5).setVisible(false);
    this.bar = scene.add.rectangle(homeX - 10, homeY - BAR_DY * this.scale, 20, 2, 0x8ad46a).setOrigin(0, 0.5).setVisible(false);

    // Метка с именем и уровнем — видна всегда, пока монстр жив (как в MMORPG).
    // Мелкая: камера увеличивает втрое, крупный текст закрыл бы полкарты.
    this.nameTag = scene.add
      .text(homeX, homeY - NAME_DY * this.scale, `${stats.name} Lv.${stats.level}`, {
        fontFamily: 'monospace',
        fontSize: '4px',
        color: threatColor(0),
        stroke: '#000000',
        strokeThickness: 1,
      })
      .setOrigin(0.5, 1)
      .setResolution(LABEL_RES);

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

  takeDamage(amount: number): void {
    if (this.state === 'dead') return;

    this.hp -= amount;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.sprite.clearTint());
    this.showBar();

    if (this.hp <= 0) {
      this.die();
      return;
    }

    // Ударили — теперь гонится, откуда бы ни прилетело. Без этого выстрел из лука
    // с дальнего расстояния наносил урон, но паук оставался стоять: агрессия
    // включалась только по близости, а стрела бьёт дальше, чем паук замечает.
    this.provoked = true;

    // Отброса нет (так просил заказчик): монстр не отлетает от удара, а
    // останавливается на месте и вздрагивает. Скорость гасим, чтобы он не
    // проскальзывал по инерции от прежнего шага погони.
    (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);

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
    this.nameTag.setVisible(false);
    this.play('death');
  }

  private showBar(): void {
    this.bar.setVisible(true);
    this.barBg.setVisible(true);
  }

  /** Метка идёт за монстром, сортируется вместе с ним и красится по угрозе. */
  private updateNameTag(playerLevel: number): void {
    const t = this.nameTag;
    t.setPosition(this.sprite.x, this.sprite.y - NAME_DY * this.scale);
    // Та же глубина, что у монстра (+чуть), чтобы уходила за крону вместе с ним.
    t.setDepth(this.sprite.depth + 0.03);
    const color = threatColor(this.stats.level - playerLevel);
    if (color !== this.tagColor) {
      this.tagColor = color;
      t.setColor(color);
    }
  }

  private updateBar(): void {
    if (!this.bar.visible) return;
    const frac = Math.max(0, this.hp / this.stats.hp);
    this.bar.width = 20 * frac;
    this.bar.setFillStyle(frac > 0.5 ? 0x8ad46a : frac > 0.25 ? 0xd8c05a : 0xe05c4a);

    const y = this.sprite.y - BAR_DY * this.scale;
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
    this.provoked = false;
    this.dir = 'down';
    this.sprite.setPosition(this.homeX, this.homeY);
    this.sprite.setAlpha(1);
    this.sprite.clearTint();
    this.scene.physics.world.enableBody(this.sprite);
    this.nameTag.setVisible(true);
    this.play('idle');
  }

  update(player: Player): void {
    const now = this.scene.time.now;
    // Та же шкала, что у игрока. Раньше тут стоял sprite.y — мировые пиксели, —
    // и паук с севера (y=408) рисовался поверх героя (300), а южнее 16-го ряда
    // тайлов лез ещё и на кроны деревьев.
    this.sprite.setDepth(
      creatureDepth(this.sprite.x, this.sprite.y, this.tallObjects, this.mapWidth, this.tileW, this.tileH),
    );
    this.updateBar();

    if (this.state === 'dead') {
      // Труп полежал — растворяем.
      const age = now - this.deadAt;
      if (age > CORPSE_MS) this.sprite.setAlpha(Math.max(0, 1 - (age - CORPSE_MS) / 1000));
      return;
    }

    this.updateNameTag(player.level);

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

    // Гнаться, стоять или возвращаться — решает чистая функция, у неё же тесты.
    const home2 = distSq(this.sprite.x, this.sprite.y, this.homeX, this.homeY);
    const was = this.state;
    const mode = decideChase(
      {
        mode: was === 'chase' || was === 'leash' ? was : 'idle',
        toPlayer2: d2,
        toHome2: home2,
        homeTol2: this.tileW * this.tileW,
        provoked: this.provoked,
      },
      this.stats,
    );

    if (mode === 'leash') {
      // Возвращаемся домой ДО КОНЦА, не отвлекаясь на игрока. Раньше проверка
      // стояла в лоб («дальше поводка — шаг домой»), и паук дрожал на границе:
      // шаг домой — снова внутри — снова в погоню — снова за поводок.
      // Поводок утянул домой — обида забыта: провокацию снимаем, иначе паук,
      // едва долечившись, снова кинулся бы через всю карту.
      this.provoked = false;
      this.state = 'leash';
      this.moveTo(this.homeX, this.homeY);
      this.bar.setVisible(false);
      this.barBg.setVisible(false);
      return;
    }

    // Дошёл домой — только теперь лечимся, один раз. Раньше здоровье
    // восстанавливалось каждый кадр за поводком, и паука нельзя было добить.
    if (was === 'leash' && mode === 'idle') this.hp = this.stats.hp;
    this.state = mode;

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

    this.chaseTo(px, py);
    this.showBar();
  }

  /**
   * Идти к игроку в обход препятствий.
   *
   * Раньше паук просто разворачивался носом к цели и шёл напролом: дерево или
   * пруд между ними — и он упирался, толкая препятствие до бесконечности.
   * Теперь спрашиваем у волны, в какую соседнюю клетку шагнуть, и идём туда.
   *
   * Вплотную волной не пользуемся: на последнем метре шаги по клеткам заметны
   * глазом как дёрганье, а обходить там уже нечего.
   */
  private chaseTo(tx: number, ty: number): void {
    const near = this.stats.reach + this.tileW;
    if (!this.flow || distSq(this.sprite.x, this.sprite.y, tx, ty) < near * near) {
      this.moveTo(tx, ty);
      return;
    }

    const from = this.cellIndex();
    const step = nextStep(this.flow, this.mapWidth, this.mapHeight, from);
    if (step === UNREACHABLE) {
      // Пути нет (паука вытолкнули в стену) или мы уже в клетке игрока — идём
      // как раньше. Хуже, чем было, от этого не станет.
      this.moveTo(tx, ty);
      return;
    }

    // В центр следующей клетки: к её краю паук подходил бы по касательной и
    // цеплялся углом за стену.
    this.moveTo((step % this.mapWidth) * this.tileW + this.tileW / 2, Math.floor(step / this.mapWidth) * this.tileH + this.tileH / 2);
  }

  private cellIndex(): number {
    const x = Math.floor(this.sprite.x / this.tileW);
    const y = Math.floor(this.sprite.y / this.tileH);
    return y * this.mapWidth + x;
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
    this.nameTag.destroy();
  }
}
