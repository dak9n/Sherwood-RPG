import Phaser from 'phaser';
import { createDirAnims } from './anims';
import { dirFromVelocity, DIRS_HERO, type Dir } from './dir';
import { hitRect, rollDamage, playerDamageTaken, type Rect } from './combat';
import { BARRIER_DURATION } from './barrier';
import anchorData from './weapon-anchors.json';
import { creatureDepth, DEPTH_ABOVE } from './depth';
import { HERO } from './creatures';

/** Слои персонажа: тело, голова, тень, меч — каждый своим листом. */
const PARTS = 'assets/characters/PNG/Swordsman_lvl1/Parts/';
const PREFIX = 'Swordsman_lvl1_';

/** Ключ анимации в игре -> как названа она в файлах набора. */
const ANIM_SHEETS: Record<string, string> = {
  idle: 'Idle',
  walk: 'Walk',
  attack: 'attack',
  death: 'Death',
};

/**
 * Из чего собираем безоружного героя, снизу вверх. Меча тут намеренно НЕТ:
 * его место занимает надетое оружие (см. weapon-anchors.json).
 */
const BODY_PARTS = ['shadow', 'body', 'head'] as const;

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

/**
 * Куда и под каким углом вложить оружие — ПОКАДРОВО.
 *
 * Таблицу считает tools/weapon-anchors.mjs из штатного слоя меча: художник уже
 * анимировал его по всем кадрам, значит там записано и положение рукояти, и
 * наклон клинка. Поэтому любое оружие следует ходьбе и взмаху само, без ручной
 * подгонки поз (раньше поза была одна на направление — оружие висело статично).
 */
type Anchor = { x: number; y: number; angle: number; len: number; behind?: boolean };
const ANCHORS = anchorData as {
  /** Длина клинка у штатного меча — одна на все кадры (см. ниже про замах). */
  bladeLen: number;
  anims: Record<string, { cols: number; rows: number; frames: (Anchor | null)[] }>;
};

/**
 * Клинок на иконке нарисован по диагонали вверх-вправо, то есть под -45°.
 * Чтобы он смотрел в нужную сторону, иконку доворачиваем на эту разницу.
 */
const ICON_BLADE_ANGLE = -45;
/** Длина клинка на иконке от рукояти (0.12,0.88) до острия, пикселей. */
const ICON_BLADE_LEN = 34;
/** Насколько оружие крупнее штатного меча. 1 — точно его длины. */
const HELD_SCALE = 1.15;

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
  /** Докуда держится барьер (умение «Барьер», слот 3). Ставит сцена на касте. */
  private shieldUntil = 0;
  /** Оружие в руке: спрайт надетого меча/лука (набор weapon-icons). Ставит сцена. */
  private held?: Phaser.GameObjects.Image;
  private heldKey: string | null = null;
  private tallObjects: Map<number, number> = new Map();
  private mapWidth = 0;
  private tileW = 16;
  private tileH = 16;

  /**
   * Грузим героя ПО СЛОЯМ, а не готовым листом.
   *
   * В готовом листе меч уже нарисован — надетое оружие ложилось бы вторым мечом
   * поверх штатного. Набор для того и разложен автором на части (Parts/): тело,
   * голова, тень, меч. Берём всё, кроме меча, и склеиваем в лист безоружного
   * героя (см. buildTextures) — тогда в руку можно вложить любое оружие.
   */
  static preload(scene: Phaser.Scene): void {
    for (const [key, name] of Object.entries(ANIM_SHEETS)) {
      for (const part of BODY_PARTS) {
        scene.load.image(`sw-${key}-${part}`, `${PARTS}${PREFIX}${name}_${part}.png`);
      }
    }
  }

  /**
   * Склеивает слои в лист безоружного героя под теми же ключами, что раньше
   * приходили из файла (`sw-idle` и прочие), — остальной код о подмене не знает.
   *
   * Зовётся сценой ПОСЛЕ загрузки и ДО создания анимаций: те нарезают кадры из
   * готовой текстуры. Рисуем на обычном canvas: Phaser принимает его как лист.
   */
  static buildTextures(scene: Phaser.Scene): void {
    for (const key of Object.keys(ANIM_SHEETS)) {
      const texKey = `sw-${key}`;
      if (scene.textures.exists(texKey)) continue;

      const first = scene.textures.get(`sw-${key}-body`).getSourceImage() as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = first.width;
      canvas.height = first.height;
      const ctx = canvas.getContext('2d')!;
      // Порядок важен: тень под всеми, голова поверх тела.
      for (const part of BODY_PARTS) {
        const img = scene.textures.get(`sw-${key}-${part}`).getSourceImage() as HTMLImageElement;
        ctx.drawImage(img, 0, 0);
      }
      scene.textures.addSpriteSheet(texKey, canvas as unknown as HTMLImageElement, {
        frameWidth: FRAME,
        frameHeight: FRAME,
      });
    }
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
    /** Можно ли сейчас бить: сцена запрещает удар, пока целятся градом стрел. */
    private canAct: () => boolean = () => true,
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
  /** Повесить барьер на BARRIER_DURATION от now (умение «Барьер»). */
  shieldFor(now: number): void {
    this.shieldUntil = now + BARRIER_DURATION;
  }

  /** Держится ли сейчас барьер — по этому сцена рисует пузырь щита. */
  isShielded(now: number): boolean {
    return now < this.shieldUntil;
  }

  /** Сколько барьеру ещё держаться, мс (0 — не активен): пузырь по этому тает. */
  shieldLeft(now: number): number {
    return Math.max(0, this.shieldUntil - now);
  }

  /**
   * Показать в руке героя надетое оружие (ключ текстуры held-<id>) или спрятать
   * (null — оружие снято). Зовёт сцена из applyGear: там единственное место, где
   * меняется экипировка. Именно ТОТ меч, что надет: у каждого своя картинка.
   */
  setHeldWeapon(texKey: string | null): void {
    this.heldKey = texKey;
    if (!texKey) {
      this.held?.setVisible(false);
      return;
    }
    if (!this.held) {
      this.held = this.scene.add.image(this.sprite.x, this.sprite.y, texKey);
      // Пивот — рукоять (низ-лево диагональной иконки, замерено по icon_02:
      // кончик в (2,30) из 32, кисть чуть выше по диагонали): вокруг неё оружие
      // и поворачивается при взмахе, как в кисти.
      this.held.setOrigin(0.12, 0.88);
      // Длина клинка постоянна: подгоняем иконку под штатный меч раз и навсегда.
      this.held.setScale((ANCHORS.bladeLen * HELD_SCALE) / ICON_BLADE_LEN);
    } else {
      this.held.setTexture(texKey);
    }
    this.held.setVisible(this.state !== 'dead');
  }

  /**
   * Оружие в руке: садим его в рукоять ТЕКУЩЕГО кадра анимации.
   *
   * Кадр берём у самого спрайта (anims.currentFrame) — так оружие не может
   * разъехаться с телом: какой кадр показан, для того и взяли якорь.
   */
  private updateHeld(): void {
    if (!this.held) return;
    if (!this.heldKey || this.state === 'dead') {
      this.held.setVisible(false);
      return;
    }

    // Берём позу ПО ТЕКУЩЕМУ КАДРУ, в том числе на ударе. Раньше взмах шёл по
    // таймеру и отставал от тела: тело живёт кадрами, а меч жил часами.
    const a = this.currentAnchor();
    if (!a) {
      this.held.setVisible(false); // на этом кадре оружия не видно (замах из-за спины)
      return;
    }

    // Якорь задан в пикселях кадра 64x64, а точка спрайта — ноги (origin 0.5/0.75).
    this.held.setVisible(true);
    this.held.setPosition(
      this.sprite.x + (a.x - FRAME / 2),
      this.sprite.y + (a.y - FRAME * 0.75),
    );
    // Оружие «из-за спины» рисуем под героем, иначе поверх.
    this.held.setDepth(this.sprite.depth + (a.behind ? -0.01 : 0.01));
    this.held.setAngle(a.angle - ICON_BLADE_ANGLE);
    // Размер НЕ трогаем покадрово. Раньше он брался из длины клинка на кадре, но
    // на замахе художник рисует смазанный след — длина там взлетает втрое, и меч
    // на долю секунды раздувался. Меч жёсткий: длина одна, меняются лишь место и
    // наклон. Масштаб ставится один раз в setHeldWeapon.
  }

  /** Якорь оружия для показанного сейчас кадра. null — кадра нет в таблице. */
  private currentAnchor(): Anchor | null {
    const frame = this.sprite.anims.currentFrame;
    if (!frame) return null;
    // Ключ анимации вида `sw-walk-left` — вытаскиваем из него имя анимации.
    const anim = this.sprite.anims.getName().split('-')[1];
    const table = ANCHORS.anims[anim];
    if (!table) return null;
    const index = Number(frame.textureFrame);
    return table.frames[index] ?? null;
  }

  /**
   * Урон по герою. Возвращает, СКОЛЬКО реально прошло (0 — не прошёл вовсе: герой
   * мёртв или ещё идут кадры неуязвимости). Раньше возвращался просто «попали», и
   * сцена показывала над головой сырой удар монстра — теперь всплывает честное
   * число, в котором уже учтены и броня, и барьер.
   */
  takeDamage(amount: number, now: number): number {
    if (this.state === 'dead' || now < this.invulnUntil) return 0;

    // Броня и барьер режут урон, но не в ноль (см. playerDamageTaken): неуязвимый
    // герой — не игра, монстры перестали бы существовать.
    const taken = playerDamageTaken(amount, this.gear.def + this.points.def, this.isShielded(now));
    this.hp -= taken;
    this.invulnUntil = now + HERO.iframes;
    this.lastHurtAt = now;

    // Вспышка — половина ощущения «попали». Ввод при этом НЕ блокируем:
    // три паука иначе дают вечный стан и смерть без права шевельнуться.
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.sprite.clearTint());

    if (this.hp <= 0) this.die();
    return taken;
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
    this.updateHeld(); // оружие в руке идёт за героем (и прячется у мёртвого)

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
    // Пока целятся умением (град стрел), удар мышью/пробелом не проходит: тот же
    // клик выбирает точку залпа, а не машет мечом.
    if (!this.canAct()) return;

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
