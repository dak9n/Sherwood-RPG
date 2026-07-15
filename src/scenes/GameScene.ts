import Phaser from 'phaser';
import { MapScene } from './MapScene';
import { Player, type Strike } from '../game/player';
import { Monster } from '../game/monster';
import { findTallObjects } from '../game/tall-objects';
import { pickSpawns } from '../game/spawn';
import { MONSTERS, SPAWNS, xpToNext, rollDrop } from '../game/creatures';
import { Hud } from '../game/hud';
import { draftCollision } from '../map/collision-draft';
import { Loot, registerItemFrames } from '../game/loot';
import { addToBag, ITEMS, type Stack } from '../game/items';

/** Целый зум: при дробном пиксели карты не легли бы на пиксели экрана. */
const ZOOM = 3;

/**
 * Чем помечаем стену в невидимом слое физики. Годится любой существующий номер
 * тайла: слой не рисуется, важно лишь, что клетка не пуста.
 */
const WALL_TILE = 1;

/**
 * Сцена игры. Всё про геймплей — здесь и в src/game/.
 *
 * Редактор сюда не заглядывает: у него своя сцена. Общее у них — MapScene и
 * формат карты в src/map/.
 */
/** Ячеек в сумке: 7x5, как в задуманном окне инвентаря. */
const BAG_SIZE = 35;

export class GameScene extends MapScene {
  player!: Player;
  private monsters: Monster[] = [];
  private hud!: Hud;
  private loot: Loot[] = [];
  /** Сумка игрока. Пока без окна — но добыча уже копится. */
  bag: (Stack | null)[] = new Array(BAG_SIZE).fill(null);

  constructor() {
    super('world');
  }

  preload(): void {
    super.preload();
    Player.preload(this);
    for (const stats of Object.values(MONSTERS)) Monster.preload(this, stats);
    // Иконки предметов. Тайлсеты карты (грибы) грузит MapScene вторым проходом.
    this.load.image('icons', 'assets/interface/PNG/Icons.png');
  }

  protected onReady(): void {
    // Режем кадры под предметы: делать это в preload нельзя — тайлсет Objects
    // с грибами догружается вторым проходом и до create его текстуры ещё нет.
    registerItemFrames(this);

    // Ставим в середину нарисованного леса, а не карты: холст расширяли вправо
    // и вниз, поэтому центр карты — пустое поле.
    const { x, y } = this.drawnCenter();
    this.player = new Player(this, x, y, (strike) => this.playerStrike(strike));

    // Большие деревья ищем один раз: карта в игре не меняется.
    const tall = findTallObjects(this.doc);
    this.player.setTallObjects(tall, this.doc.width, this.doc.map.tileWidth, this.doc.map.tileHeight);

    const walls = this.buildCollision(tall);
    this.spawnMonsters(tall, x, y, walls);

    this.hud = new Hud();
    this.events.once('shutdown', () => this.hud.destroy());

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBounds(0, 0, this.doc.width * this.doc.map.tileWidth, this.doc.height * this.doc.map.tileHeight);

    // Своё округление камеры (см. followPlayer). Родное выключаем: оно живёт в
    // preRender и делает Math.floor до целого мирового пикселя — то есть до трёх
    // экранных при зуме 3 — независимо от того, следует камера за кем-то или нет.
    cam.setRoundPixels(false);
    this.followPlayer();
  }

  /**
   * Невидимый слой стен для физики.
   *
   * Проходимость берём из карты, а если её ещё не размечали — считаем по самой
   * картинке (вода, обрыв за краем нарисованного, стволы деревьев). Так игра
   * играется сразу, а редактор потом позволит уточнить руками.
   */
  private buildCollision(tall: Map<number, number>): Phaser.Tilemaps.TilemapLayer {
    const marked = this.doc.map.collision.some((v) => v !== 0);
    if (!marked) {
      const draft = draftCollision(this.doc, tall, this.doc.map.tileHeight);
      this.doc.map.collision = draft.collision;
      console.log(`Проходимость посчитана: ${draft.walkable} клеток из ${draft.walkable + draft.blocked}`);
    }

    const layer = this.view.map.createBlankLayer('__collision', this.view.map.tilesets)!;

    // Пишем индекс напрямую, минуя applyCell: тот занёс бы тайл в анимационную
    // группу, и стены замигали бы вместе с водой.
    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < this.doc.width; x++) {
        if (this.doc.canWalk(x, y)) continue;
        const tile = layer.getTileAt(x, y, true);
        if (tile) tile.index = WALL_TILE;
      }
    }

    // Сталкиваемся со всем, что не пусто. recalculateFaces обязателен: без него
    // физика не увидит грани и пропустит сквозь стену.
    layer.setCollisionByExclusion([-1], true, true);
    layer.setVisible(false);
    return layer;
  }

  private spawnMonsters(tall: Map<number, number>, px: number, py: number, walls: Phaser.Tilemaps.TilemapLayer): void {
    const blocked = new Set(tall.keys());
    // Не селим на стенах: паук, замурованный в воде, будет вечно биться о берег.
    for (let i = 0; i < this.doc.width * this.doc.height; i++) {
      if (!this.doc.canWalk(i % this.doc.width, Math.floor(i / this.doc.width))) blocked.add(i);
    }

    const points = pickSpawns(this.doc, blocked, SPAWNS, { x: px, y: py });
    for (const p of points) {
      this.monsters.push(new Monster(this, MONSTERS[p.kind], p.x, p.y));
    }

    // Пауки расталкивают друг друга: иначе агрившиеся сойдутся в одну точку и
    // будут бить как один, но за пятерых.
    const group = this.physics.add.group(this.monsters.map((m) => m.sprite));
    this.physics.add.collider(group, group);
    this.physics.add.collider(this.player.sprite, group);

    // В стены упираются и игрок, и пауки — иначе погоня пойдёт через пруд.
    this.physics.add.collider(this.player.sprite, walls);
    this.physics.add.collider(group, walls);
  }

  /** Игрок махнул мечом: кому досталось. */
  private playerStrike(strike: Strike): void {
    const { x, y, w, h } = strike.rect;
    const hitAny = this.monsters.filter(
      (m) =>
        !m.isDead &&
        m.sprite.x + 8 > x &&
        m.sprite.x - 8 < x + w &&
        m.sprite.y + 4 > y &&
        m.sprite.y - 20 < y + h,
    );

    for (const m of hitAny) {
      m.takeDamage(strike.damage, this.player.sprite.x, this.player.sprite.y);
      this.damageNumber(m.sprite.x, m.sprite.y - 30, strike.damage, strike.heavy ? '#ffd35c' : '#ffffff');
      if (m.isDead) {
        this.gainXp(m.stats.xp);
        this.dropLoot(m);
      }
    }

    if (hitAny.length) this.cameras.main.shake(strike.heavy ? 140 : 80, strike.heavy ? 0.006 : 0.003);
  }

  /** Что выпало из паука. Раскладываем вокруг тела, чтобы стопка не легла в одну точку. */
  private dropLoot(m: Monster): void {
    const drops = rollDrop(m.stats.drop);

    for (const [i, d] of drops.entries()) {
      const angle = (i / Math.max(1, drops.length)) * Math.PI * 2;
      const dist = drops.length > 1 ? 10 : 0;
      this.loot.push(
        new Loot(this, d.id, d.qty, m.sprite.x + Math.cos(angle) * dist, m.sprite.y + Math.sin(angle) * dist),
      );
    }
  }

  /** Подбираем то, до чего дошли. */
  private updateLoot(now: number): void {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;

    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.update(now);

      if (l.expired(now)) {
        l.destroy();
        this.loot.splice(i, 1);
        continue;
      }

      if (this.player.isDead || !l.inReach(px, py)) continue;

      const left = addToBag(this.bag, l.id, l.qty);
      if (left === l.qty) {
        // Сумка полна — предмет остаётся лежать. Молча его терять нельзя.
        continue;
      }

      this.loot.splice(i, 1);
      const name = ITEMS[l.id].name;
      const taken = l.qty - left;
      l.flyTo(px, py, () => {
        this.damageNumber(px, py - 44, 0, '#d8c07a', `${name}${taken > 1 ? ` ×${taken}` : ''}`);
      });
    }
  }

  private gainXp(amount: number): void {
    this.player.xp += amount;
    while (this.player.xp >= xpToNext(this.player.level)) {
      this.player.xp -= xpToNext(this.player.level);
      this.player.level++;
      this.player.hpMax += 10;
      this.player.mpMax += 5;
      this.player.hp = this.player.hpMax;
      this.player.mp = this.player.mpMax;
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 40, 0, '#8ad46a', `УРОВЕНЬ ${this.player.level}`);
    }
  }

  /**
   * Цифра урона. Разрешение втрое: под зумом 3 обычный текст превратился бы
   * в мыло.
   */
  private damageNumber(x: number, y: number, amount: number, color: string, text?: string): void {
    const label = this.add
      .text(x, y, text ?? String(amount), {
        fontFamily: 'monospace',
        fontSize: text ? '10px' : '8px',
        color,
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setResolution(ZOOM)
      .setDepth(2000);

    this.tweens.add({
      targets: label,
      y: y - 12,
      alpha: 0,
      duration: 550,
      onComplete: () => label.destroy(),
    });
  }

  protected onUpdate(delta: number): void {
    const now = this.time.now;
    this.player.update(now, delta);

    for (const m of this.monsters) {
      m.update(this.player);

      // Паук достал до игрока — забираем его удар.
      if (m.pendingHit) {
        const r = m.pendingHit;
        m.pendingHit = null;
        const p = this.player.sprite;
        const hit = p.x + 6 > r.x && p.x - 6 < r.x + r.w && p.y > r.y - 4 && p.y - 24 < r.y + r.h;
        if (hit && this.player.takeDamage(m.stats.dmg, now)) {
          this.damageNumber(p.x, p.y - 40, m.stats.dmg, '#ff6b5c');
          this.cameras.main.shake(120, 0.005);
        }
      }

      if (m.shouldRespawn(now)) m.reset();
    }

    this.updateLoot(now);

    if (this.player.isDead && !this.deathAt) {
      this.deathAt = now;
      this.hud.showDeath(true);
    }
    if (this.deathAt && now - this.deathAt > 2000) {
      this.deathAt = 0;
      this.hud.showDeath(false);
      const { x, y } = this.drawnCenter();
      // Опыт теряется, но не уровень: откат до нуля обиднее смерти.
      this.player.xp = Math.floor(this.player.xp * 0.7);
      this.player.respawn(x, y, now);
    }

    this.hud.set(
      this.player.hp,
      this.player.hpMax,
      this.player.mp,
      this.player.mpMax,
      this.player.xp,
      xpToNext(this.player.level),
    );
    this.followPlayer();
  }

  private deathAt = 0;

  /**
   * Камера идёт за игроком, вставая на целые ЭКРАННЫЕ пиксели.
   *
   * Родное следование Phaser округляет прокрутку до целого мирового пикселя,
   * то есть до трёх экранных при зуме 3. Вдобавок с плавностью 0.1 шаг камеры
   * (0.08 пикселя за кадр) целиком съедался округлением: камера стояла,
   * копила отставание и прыгала рывком. Отсюда и дёрганая карта на диагонали.
   *
   * Округление до экранного пикселя (треть мирового) сохраняет чёткость
   * пиксель-арта — карта не встаёт между пикселями экрана — и при этом даёт
   * шаг втрое мельче, то есть плавное движение.
   */
  private followPlayer(): void {
    const cam = this.cameras.main;
    cam.centerOn(this.player.sprite.x, this.player.sprite.y);
    cam.scrollX = Math.round(cam.scrollX * ZOOM) / ZOOM;
    cam.scrollY = Math.round(cam.scrollY * ZOOM) / ZOOM;
  }

  /** Центр области, где вообще что-то нарисовано. */
  private drawnCenter(): { x: number; y: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const layer of this.doc.layers) {
      for (let i = 0; i < layer.data.length; i++) {
        if (!layer.data[i]) continue;
        const x = i % this.doc.width;
        const y = Math.floor(i / this.doc.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const tw = this.doc.map.tileWidth;
    const th = this.doc.map.tileHeight;
    return { x: ((minX + maxX) / 2) * tw, y: ((minY + maxY) / 2) * th };
  }
}
