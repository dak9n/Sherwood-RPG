import Phaser from 'phaser';
import { createDirAnims } from './anims';
import { dirFromVelocity, DIRS_HERO, type Dir } from './dir';
import { hitRect, rollDamage, type Rect } from './combat';
import { creatureDepth, DEPTH_ABOVE } from './depth';
import { HERO } from './creatures';

const SHEETS = 'assets/characters/PNG/Swordsman_lvl1/With_shadow/';
const PREFIX = 'Swordsman_lvl1_';

/** Кадр в листе — 64x64, персонаж внутри примерно 20x30 и стоит на нижней трети. */
const FRAME = 64;

type State = 'idle' | 'walk' | 'attack' | 'dead';

export interface Strike {
  rect: Rect;
  damage: number;
  heavy: boolean;
  /** Крит (навык «Точный удар»): урон уже умножен, флаг — для цвета цифры. */
  crit: boolean;
  /** Сторона взмаха (одна из 4), радианы — по ней сцена рисует росчерк тяжёлого удара. */
  angle: number;
}

/** Выстрел из лука: откуда, под каким углом и с каким уроном полетит стрела. */
export interface Shot {
  x: number;
  y: number;
  angle: number;
  damage: number;
  heavy: boolean;
  crit: boolean;
}

/**
 * На сколько выше ног вылетает стрела — высота груди. Стрела и целится, и рождается
 * из этой точки: если целиться от ног, а пускать от груди, выстрел уходил бы на эти
 * же пиксели выше курсора и мазал по цели вровень с игроком.
 */
export const CHEST_OFFSET = 14;

/** Угол полёта для стрельбы «от направления» (пробелом, без курсора). */
const DIR_ANGLE: Record<Dir, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite;

  hp = HERO.hp;
  mp = HERO.mp;
  level = 1;
  xp = 0;

  /** Потолок от героя и уровней. Прибавка от вещей сюда не входит — см. hpMax. */
  private hpBase = HERO.hp;
  private mpBase = HERO.mp;

  /**
   * Что добавляют надетые вещи. Ставит сцена при каждой смене экипировки.
   *
   * Держим отдельно от базовых чисел: иначе, сняв меч, пришлось бы вычитать
   * его урон обратно — и любая ошибка в вычитании копилась бы навсегда.
   */
  gear = { dmg: 0, def: 0, speed: 0, hp: 0, mp: 0 };

  /**
   * Что добавили вложенные очки характеристик.
   *
   * Отдельно от gear по той же причине, по какой gear отдельно от базы: вещь
   * снимается, а очки — нет, и складывать их в одну кучу значило бы однажды
   * вычесть вложенное вместе со снятым мечом.
   */
  points = { dmg: 0, def: 0, hp: 0, mp: 0 };

  get hpMax(): number {
    return this.hpBase + this.gear.hp + this.points.hp;
  }

  get mpMax(): number {
    return this.mpBase + this.gear.mp + this.points.mp;
  }

  /** Уровень поднимает потолок навсегда. */
  growMax(hp: number, mp: number): void {
    this.hpBase += hp;
    this.mpBase += mp;
  }

  /**
   * Восстановить из сейва. Потолок ЗАДАЁТ УРОВЕНЬ: hpBase накапливается по +10 за
   * уровень (см. growMax в GameScene.gainXp), поэтому при загрузке его надо
   * пересобрать из уровня, а не оставить стартовым — иначе потолок был бы как у
   * первого уровня, и вся прокачка здоровья пропала бы.
   *
   * hp/mp поджимаем под потолок; здоровье не меньше 1 — грузиться трупом нельзя.
   * Прибавки вещей и очков к этому моменту уже применены сценой, поэтому hpMax
   * тут честный.
   */
  restore(level: number, xp: number, hp: number, mp: number): void {
    this.level = Math.max(1, Math.floor(level));
    this.xp = Math.max(0, xp);
    this.hpBase = HERO.hp + (this.level - 1) * 10;
    this.mpBase = HERO.mp + (this.level - 1) * 5;
    this.hp = Math.min(this.hpMax, Math.max(1, hp));
    this.mp = Math.min(this.mpMax, Math.max(0, mp));
  }

  /** Сменилась экипировка. */
  setGear(bonus: { dmg: number; def: number; speed: number; hp: number; mp: number }): void {
    this.gear = { ...bonus };
    // Сняли шлем — потолок упал, и текущее здоровье не должно висеть выше него.
    this.hp = Math.min(this.hp, this.hpMax);
    this.mp = Math.min(this.mp, this.mpMax);
  }

  /** Игрок вложил очки. Потолок вырос — в отличие от вещей, назад он не упадёт. */
  setPoints(bonus: { dmg: number; def: number; hp: number; mp: number }): void {
    this.points = { ...bonus };
  }

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private dir: Dir = 'down';
  private state: State = 'idle';
  /** Не бить дважды за один взмах. */
  private didHit = false;
  private heavySwing = false;
  /** Надет ли лук: тогда взмах превращается в выстрел стрелой. Ставит сцена. */
  private ranged = false;
  /** Куда полетит стрела текущего замаха. Считаем при старте, чтобы курсор не «уехал». */
  private shotAngle = 0;
  /** Шанс крита (навыки, дерево L), доля 0..1. Множитель — critMul. Ставит сцена. */
  private critChance = 0;
  private critMul = 1.5;
  private invulnUntil = 0;
  private lastHurtAt = -Infinity;

  private tallObjects: Map<number, number> = new Map();
  private mapWidth = 0;
  private tileW = 16;
  private tileH = 16;

  static preload(scene: Phaser.Scene): void {
    const sheet = (name: string) =>
      scene.load.spritesheet(`sw-${name.toLowerCase()}`, `${SHEETS}${PREFIX}${name}_with_shadow.png`, {
        frameWidth: FRAME,
        frameHeight: FRAME,
      });

    sheet('Idle');
    sheet('Walk');
    sheet('attack');
    sheet('Death');
  }

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    private onStrike: (strike: Strike) => void,
    /** Сказать игроку, что на тяжёлый удар не хватило маны. */
    private onNoMana: () => void = () => {},
    /** Выпустить стрелу — когда надет лук. Сцена рождает снаряд. */
    private onShoot: (shot: Shot) => void = () => {},
  ) {
    createDirAnims(scene, 'sw', DIRS_HERO, {
      idle: { texture: 'sw-idle', cols: 12, frameRate: 8, loop: true },
      walk: { texture: 'sw-walk', cols: 6, frameRate: 10, loop: true },
      // 8 кадров при 16 к/с = 500 мс на взмах. Удар — на 4-м, то есть через
      // четверть секунды: это и есть пауза между ударами, отдельного таймера нет.
      attack: { texture: 'sw-attack', cols: 8, frameRate: 16, loop: false },
      death: { texture: 'sw-death', cols: 7, frameRate: 10, loop: false },
    });

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
    // Пауки толкают друг друга, но не игрока.
    body.setImmovable(true);

    this.sprite.setDepth(DEPTH_ABOVE);
    this.play('idle');

    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,SHIFT', false) as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;

    // Мышью бить привычнее, чем пробелом: левая — взмах, правая — тяжёлый.
    // Удар идёт в сторону курсора, поэтому разворачиваться перед ударом не нужно.
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (this.state === 'attack' || this.state === 'dead') return;
      this.faceTo(p.worldX, p.worldY);
      // Стрела летит точно в курсор, а не по одной из четырёх сторон: угол берём
      // от ТОЧКИ ВЫЛЕТА (грудь, а не ноги) к точке клика, иначе выстрел уходит на
      // высоту груди выше цели. Разворот на 4 стороны — только для анимации.
      this.startAttack(
        p.rightButtonDown(),
        Math.atan2(p.worldY - (this.sprite.y - CHEST_OFFSET), p.worldX - this.sprite.x),
      );
    });

    // Подписываемся один раз, а не на каждый взмах.
    this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.onAnimFrame, this);
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.onAnimDone, this);
  }

  /**
   * Момент удара. Ловим по номеру кадра В ЛИСТЕ, а не по позиции в анимации:
   * пустые кадры из анимации выкидываются, и позиции сдвигаются — урон уехал бы
   * на замах, что незаметно глазом, но ощущается как «не попадает».
   */
  private onAnimFrame(anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame): void {
    if (this.state !== 'attack' || this.didHit) return;
    if (!anim.key.startsWith('sw-attack-')) return;

    const row = DIRS_HERO.indexOf(this.dir);
    if (frame.textureFrame !== row * 8 + HERO.hitFrame) return;

    this.didHit = true;
    // Урон = база + уровень + оружие + вложенные очки. Меч должен чувствоваться
    // в первом же ударе. Ту же формулу показывает окно персонажа — они обязаны
    // сходиться, иначе число на экране врёт. Лук считает так же: его прибавка —
    // это gear.dmg надетого лука (навык «Меткость» сцена тоже кладёт в gear.dmg).
    const bonus = this.level - 1 + this.gear.dmg + this.points.dmg;
    const base = rollDamage(HERO.dmgMin + bonus, HERO.dmgMax + bonus);
    let damage = Math.round(this.heavySwing ? base * HERO.heavyMul : base);

    // Крит от навыков дерева: с шансом множим урон. Флаг несём дальше — для цвета
    // цифры, урон уже учтён.
    const crit = this.critChance > 0 && Math.random() < this.critChance;
    if (crit) damage = Math.round(damage * this.critMul);

    if (this.ranged) {
      // Стрела вылетает от корпуса, а не от ног: иначе она стелется по земле.
      // Та же высота, из которой считался угол прицела, — иначе выстрел мажет.
      this.onShoot({ x: this.sprite.x, y: this.sprite.y - CHEST_OFFSET, angle: this.shotAngle, damage, heavy: this.heavySwing, crit });
      return;
    }

    const reach = this.heavySwing ? HERO.reach + 8 : HERO.reach;
    const width = this.heavySwing ? HERO.hitW + 8 : HERO.hitW;
    this.onStrike({
      rect: hitRect(this.sprite.x, this.sprite.y, this.dir, reach, width),
      damage,
      heavy: this.heavySwing,
      crit,
      angle: DIR_ANGLE[this.dir],
    });
  }

  private onAnimDone(anim: Phaser.Animations.Animation): void {
    if (anim.key.startsWith('sw-attack-') && this.state === 'attack') {
      this.state = 'idle';
    }
  }

  private play(kind: 'idle' | 'walk' | 'attack' | 'death'): void {
    this.sprite.anims.play(`sw-${kind}-${this.dir}`, kind !== 'attack');
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
    this.sprite.setDepth(
      creatureDepth(this.sprite.x, this.sprite.y, this.tallObjects, this.mapWidth, this.tileW, this.tileH),
    );
  }

  /** Урон по игроку. Возвращает false, если попадание съела неуязвимость. */
  takeDamage(amount: number, now: number): boolean {
    if (this.state === 'dead' || now < this.invulnUntil) return false;

    // Броня режет урон, но не в ноль: неуязвимый герой — не игра. Минимум
    // единица, иначе с полным набором пауки перестали бы существовать.
    // Единица проходит всегда: полная неуязвимость от защиты сломала бы бой.
    const taken = Math.max(1, amount - this.gear.def - this.points.def);
    this.hp -= taken;
    this.invulnUntil = now + HERO.iframes;
    this.lastHurtAt = now;

    // Вспышка — половина ощущения «попали». Ввод при этом НЕ блокируем:
    // три паука иначе дают вечный стан и смерть без права шевельнуться.
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.sprite.clearTint());

    if (this.hp <= 0) this.die();
    return true;
  }

  private die(): void {
    this.hp = 0;
    this.state = 'dead';
    (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.play('death');
  }

  get isDead(): boolean {
    return this.state === 'dead';
  }

  respawn(x: number, y: number, now: number): void {
    this.sprite.setPosition(x, y);
    this.hp = this.hpMax;
    this.mp = this.mpMax;
    this.state = 'idle';
    this.dir = 'down';
    // Пара секунд неуязвимости: иначе воскреснуть можно прямо в зубы пауку.
    this.invulnUntil = now + 2000;
    this.sprite.clearTint();
    this.sprite.setAlpha(1);
    this.play('idle');
  }

  addXp(amount: number): boolean {
    this.xp += amount;
    return false;
  }

  update(_time: number, delta: number): void {
    const now = this.scene.time.now;
    this.regen(delta, now);
    this.blinkWhileInvulnerable(now);

    if (this.state === 'dead') return;

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;

    if (this.state === 'attack') {
      // Во время взмаха стоим: иначе зона удара уедет из-под анимации.
      body.setVelocity(0, 0);
      this.updateDepth();
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      // Пробелом целимся по направлению взгляда: курсора у клавиатуры нет.
      this.startAttack(this.keys.SHIFT.isDown, DIR_ANGLE[this.dir]);
      return;
    }

    const k = this.keys;
    const vx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const vy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);

    // Сапоги ускоряют, латы замедляют. Ниже 30 не опускаем: в латах игрок должен
    // быть медленным, а не приклеенным к земле.
    const speed = Math.max(30, HERO.speed + this.gear.speed);
    body.setVelocity(vx * speed, vy * speed);
    // По диагонали иначе выходило бы в 1.41 раза быстрее, чем по прямой.
    body.velocity.normalize().scale(speed);

    this.updateDepth();

    if (!vx && !vy) {
      this.state = 'idle';
      this.play('idle');
      return;
    }

    this.dir = dirFromVelocity(vx, vy, this.dir);
    this.state = 'walk';
    this.play('walk');
  }

  /** Развернуться к точке — перед ударом мышью. */
  private faceTo(x: number, y: number): void {
    this.dir = dirFromVelocity(x - this.sprite.x, y - this.sprite.y, this.dir);
  }

  /**
   * Развернуть героя к точке для каста умения (огненный шар в сторону курсора).
   * В атаке или мёртвым не разворачиваем; стоящего — сразу перерисовываем в новую
   * сторону, идущего трогать незачем: его направление задаёт движение.
   */
  faceToward(x: number, y: number): void {
    if (this.state === 'attack' || this.state === 'dead') return;
    this.faceTo(x, y);
    if (this.state === 'idle') this.play('idle');
  }

  private startAttack(wantHeavy: boolean, angle: number): void {
    // Тяжёлый удар тратит ману. Обычный бесплатный: кончившаяся мана не должна
    // отнимать у игрока единственное действие.
    const heavy = wantHeavy && this.mp >= HERO.heavyCost;
    if (heavy) this.mp -= HERO.heavyCost;

    // Молчать нельзя: без маны правая кнопка даёт ТУ ЖЕ анимацию, но в 2.5 раза
    // слабее. Игрок видит взмах, не видит урона и решает, что игра сломалась.
    if (wantHeavy && !heavy) this.onNoMana();

    this.heavySwing = heavy;
    this.shotAngle = angle;
    this.didHit = false;
    this.state = 'attack';
    (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.play('attack');
  }

  /**
   * Сменилось оружие. Лук стреляет, меч бьёт вблизи. Анимация одна и та же
   * (у мечника нет отдельной для лука), но на кадре удара мы либо рождаем стрелу,
   * либо чертим зону взмаха.
   */
  setRanged(ranged: boolean): void {
    this.ranged = ranged;
  }

  /** Крит от дерева навыков (L): шанс 0..1 и множитель урона. Ставит сцена. */
  setCrit(chance: number, mul: number): void {
    this.critChance = chance;
    this.critMul = mul;
  }

  private regen(delta: number, now: number): void {
    const seconds = delta / 1000;
    this.mp = Math.min(this.mpMax, this.mp + HERO.mpRegen * seconds);

    // Здоровье возвращается, только если давно не били: иначе оно односторонний
    // ресурс на 100 единиц и смерть — вопрос арифметики.
    if (this.state !== 'dead' && now - this.lastHurtAt > HERO.regenDelay) {
      this.hp = Math.min(this.hpMax, this.hp + HERO.hpRegen * seconds);
    }
  }

  private blinkWhileInvulnerable(now: number): void {
    if (this.state === 'dead') return;
    const invuln = now < this.invulnUntil;
    this.sprite.setAlpha(invuln ? (Math.floor(now / 80) % 2 ? 0.45 : 1) : 1);
  }
}
