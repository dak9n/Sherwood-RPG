import Phaser from 'phaser';
import { MapScene } from './MapScene';
import { Player, CHEST_OFFSET, type Strike, type Shot } from '../game/player';
import { Monster } from '../game/monster';
import { Arrow, ARROW_RANGE } from '../game/arrow';
import { findTallObjects } from '../game/tall-objects';
import { pickSpawns } from '../game/spawn';
import { buildFlow } from '../game/flow';
import { HERO, MONSTERS, SPAWNS, xpToNext, rollDrop, rollGold } from '../game/creatures';
import { Hud } from '../game/hud';
import { draftCollision, mergeCollision } from '../map/collision-draft';
import { drawnBounds } from '../map/doc';
import { Loot, registerItemFrames } from '../game/loot';
import { addToBag, takeOne, sortBag, isRanged, countOf, rarityOf, ITEMS, type Stack, type EquipSlot } from '../game/items';
import { InventoryUi } from '../game/inventory-ui';
import { SkillsUi } from '../game/skills-ui';
import { ShopUi } from '../game/shop-ui';
import { ForgeUi } from '../game/forge-ui';
import { trySharpen, plusOf, sharpenBonus, SCROLL_ID, type Sharpen } from '../game/forge';
import { SkillTreeUi } from '../game/skilltree-ui';
import { allocate as allocateSkill, skillBonuses, BASE_CRIT_MUL, type SkillRanks } from '../game/skilltree';
import { MinimapUi } from '../game/minimap-ui';
import { MenuUi } from '../game/menu-ui';
import { HotbarUi } from '../game/hotbar-ui';
import { buyItem, sellStack } from '../game/shop';
import { bind, swap, unbind, findInBag, emptyHotbar, type Hotbar } from '../game/hotbar';
import { equipFromBag, unequip, totalBonuses, slotWearing, ensureStarterWeapon, STARTER_WEAPON, type Equipped } from '../game/equipment';
import { emptySpent, unspent, spendPoint, bonusFrom, POINTS_PER_LEVEL, type Spent, type Stat } from '../game/stats';
import { parseSave, serializeProgress, type Progress } from '../game/save';
import { takePendingSave, takePendingChar, pushProgress, loadFailed } from '../auth/progress';
import { ChatUi } from '../game/chat-ui';

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
  private inventory!: InventoryUi;
  private skills!: SkillsUi;
  private skillTree!: SkillTreeUi;
  private shop!: ShopUi;
  private forge!: ForgeUi;
  private hotbar!: HotbarUi;
  private minimap!: MinimapUi;
  private menu!: MenuUi;
  private loot: Loot[] = [];
  /** Стрелы в полёте. Сцена их двигает и проверяет попадания — как взмах меча. */
  private arrows: Arrow[] = [];
  /** Золото игрока. Падает с монстров, тратится в магазине. Часть сейва. */
  private gold = 0;
  /**
   * Заточка оружия: вид -> уровень (кузница, K). Часть сейва. Ключи всегда
   * проверены по таблице предметов (trySharpen и санация сейва), чтение — через
   * plusOf с hasOwn.
   */
  private sharpen: Sharpen = {};
  /** Дерево навыков (L): узел -> ранг. Часть сейва. Отдельно от окна умений (U). */
  private skillRanks: SkillRanks = {};
  /** Вампиризм от навыков: доля урона возвращается здоровьем. Ставит applyGear. */
  private lifesteal = 0;
  /** Ник героя (создание персонажа). Показывается над ним. Часть сейва. */
  private charName = '';
  /** Метка с ником над героем. */
  private nameTag?: Phaser.GameObjects.Text;
  /** Облачко реплики над героем: что он написал в чат. */
  private chatBubble?: Phaser.GameObjects.Text;
  /** Докуда показывать облачко (время). 0 — скрыто. */
  private chatBubbleUntil = 0;
  /** Чат слева: системные события и сообщения игрока. */
  private chat!: ChatUi;
  /** Сумка игрока. */
  bag: (Stack | null)[] = new Array(BAG_SIZE).fill(null);
  /** Надетое. Новый герой начинает с мечом в руке — у каждого героя он есть. */
  equipped: Equipped = { weapon: STARTER_WEAPON };
  /** Что привязано к клавишам 1-9 и 0. Хранит вид предмета, а не место в сумке. */
  quick: Hotbar = emptyHotbar();
  /** Куда вложены очки характеристик. Сколько их выдано, считается от уровня. */
  spent: Spent = emptySpent();

  /**
   * В какой клетке был игрок, когда последний раз считали волну. Пересчитываем
   * только при переходе в новую клетку: внутри одной клетки волна та же, а
   * гонять её каждый кадр — 6300 клеток впустую 60 раз в секунду.
   */
  private flowAt = -1;

  /** Отложенный автосейв: setTimeout-id, 0 — не запланирован. */
  private saveTimer = 0;
  /**
   * До конца загрузки не сохраняем — иначе applySave тут же отправит сейв назад.
   * И НЕ включаем вовсе, если сейв не скачался: пустое стартовое состояние не
   * должно затереть настоящий прогресс на сервере.
   */
  private saveReady = false;
  /**
   * Менялось ли хоть что-то в этой сессии. flushSave без изменений — пропуск:
   * простаивающая вторая вкладка не должна при закрытии затирать сейв первой
   * своим устаревшим снимком. (Полную гонку двух АКТИВНЫХ вкладок это не
   * закрывает — там нужна сверка поколений; здесь честная частичная защита.)
   */
  private saveDirty = false;
  private onHide: () => void = () => {};
  private onLeave: () => void = () => {};

  constructor() {
    super('world');
  }

  preload(): void {
    super.preload();
    Player.preload(this);
    for (const stats of Object.values(MONSTERS)) Monster.preload(this, stats);
    // Иконки предметов. Тайлсеты карты (грибы) грузит MapScene вторым проходом.
    this.load.image('icons', 'assets/interface/PNG/Icons.png');
    // Наш дорисованный свиток — лист из одной иконки (см. items.ts про 'scroll').
    this.load.image('scroll', 'assets/interface/ui/scroll.png');
  }

  protected onReady(): void {
    // Режем кадры под предметы: делать это в preload нельзя — тайлсет Objects
    // с грибами догружается вторым проходом и до create его текстуры ещё нет.
    registerItemFrames(this);

    // Ставим в середину нарисованного леса, а не карты: холст расширяли вправо
    // и вниз, поэтому центр карты — пустое поле.
    const { x, y } = this.drawnCenter();
    this.player = new Player(
      this, x, y,
      (strike) => this.playerStrike(strike),
      () => this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#5ba3e0', 'не хватает маны'),
      (shot) => this.spawnArrow(shot),
    );

    // Большие деревья ищем один раз: карта в игре не меняется.
    const tall = findTallObjects(this.doc);
    this.player.setTallObjects(tall, this.doc.width, this.doc.map.tileWidth, this.doc.map.tileHeight);

    const walls = this.buildCollision(tall);
    this.spawnMonsters(tall, x, y, walls);

    this.hud = new Hud();

    // Чат слева: системные события и сообщения игрока. Пока игрок печатает —
    // клавиатуру игры глушим, иначе WASD и ходят, и печатаются разом.
    this.chat = new ChatUi();
    this.chat.onSend = (text) => {
      this.chat.local(this.charName, text);
      this.showChatBubble(text); // и облачком над головой — видно, кто написал
    };
    this.chat.onFocusChange = (typing) => {
      if (this.input.keyboard) this.input.keyboard.enabled = !typing;
    };

    this.inventory = new InventoryUi();
    this.inventory.setBag(this.bag);
    this.inventory.setEquipped(this.equipped);
    this.inventory.setHero(() => ({
      hp: this.player.hp,
      hpMax: this.player.hpMax,
      mp: this.player.mp,
      mpMax: this.player.mpMax,
      level: this.player.level,
      xp: this.player.xp,
      xpNext: xpToNext(this.player.level),
      // Урон растёт с уровнем — так же, как считает сам удар.
      dmgMin: HERO.dmgMin + this.player.level - 1,
      dmgMax: HERO.dmgMax + this.player.level - 1,
      points: unspent(this.player.level, this.spent),
      fromPoints: bonusFrom(this.spent),
      sharpen: sharpenBonus(this.sharpen, this.equipped.weapon),
      // Навыки дерева (L): урон «Меткости» входит в dmg только с луком — как и в бою.
      skill: (() => {
        const sb = skillBonuses(this.skillRanks);
        return {
          dmg: sb.dmg + (isRanged(this.equipped.weapon) ? sb.rangedDmg : 0),
          def: sb.def,
          speed: sb.speed,
          hp: sb.hp,
          mp: sb.mp,
        };
      })(),
      crit: skillBonuses(this.skillRanks).critChance,
    }));
    this.inventory.setPlusFor((id) => plusOf(this.sharpen, id));
    this.inventory.onUse = (index) => this.useItem(index);
    this.inventory.onEquip = (index) => this.equipItem(index);
    this.inventory.onUnequip = (slot) => this.unequipItem(slot as EquipSlot);
    this.inventory.onSort = () => {
      sortBag(this.bag);
      this.refreshBags();
    };

    // Окно умений (U): здесь тратят очки за уровень. Отдельно от сумки — так
    // просил заказчик, и трате характеристик там было тесно.
    this.skills = new SkillsUi();
    this.skills.setHero(() => ({ level: this.player.level, spent: this.spent }));
    this.skills.onSpend = (stat) => this.spendPointOn(stat);

    // Дерево навыков (L): ветвящиеся пассивные навыки, отдельно от простых очков
    // характеристик (U). Можно/нельзя решает чистая allocate; окно только рисует.
    this.skillTree = new SkillTreeUi();
    this.skillTree.setHero(() => ({ level: this.player.level, ranks: this.skillRanks }));
    this.skillTree.onAllocate = (nodeId) => this.allocateSkill(nodeId);

    // Магазин (O): покупка и продажа за золото. Решает не окно, а сцена — через
    // чистые buyItem/sellStack, чтобы проверка была одна на все пути.
    this.shop = new ShopUi();
    this.shop.setBag(this.bag);
    this.shop.setGold(() => this.gold);
    this.shop.setPlusFor((id) => plusOf(this.sharpen, id));
    this.shop.onBuy = (id) => this.buy(id);
    this.shop.onSellBasket = (indices) => this.sellBasket(indices);

    // Кузница (K): заточка оружия свитками — любого своего, не только надетого.
    // Бросок — в чистой trySharpen; окно только показывает состояние и шлёт
    // намерение. Одинаковые мечи показываются одной ячейкой: заточка числится
    // за видом оружия (см. forge.ts).
    this.forge = new ForgeUi();
    this.forge.setState(() => {
      const weapons: { id: string; plus: number; equipped: boolean }[] = [];
      const seen = new Set<string>();
      const add = (id: string | undefined, equipped: boolean): void => {
        if (!id || seen.has(id)) return;
        if (!Object.hasOwn(ITEMS, id) || ITEMS[id].slot !== 'weapon') return;
        seen.add(id);
        weapons.push({ id, plus: plusOf(this.sharpen, id), equipped });
      };
      add(this.equipped.weapon, true);
      for (const s of this.bag) add(s?.id, false);
      return { weapons, scrolls: countOf(this.bag, SCROLL_ID) };
    });
    this.forge.onSharpen = (weaponId) => this.sharpenWeapon(weaponId);

    this.hotbar = new HotbarUi();
    this.hotbar.setData(this.quick, this.bag, this.equipped);
    this.hotbar.setPlusFor((id) => plusOf(this.sharpen, id));
    this.hotbar.onTrigger = (slot) => this.useQuick(slot);
    this.hotbar.onBind = (slot, id) => {
      bind(this.quick, slot, id);
      this.hotbar.render();
      this.scheduleSave();
    };
    this.hotbar.onSwap = (from, to) => {
      swap(this.quick, from, to);
      this.hotbar.render();
      this.scheduleSave();
    };
    this.hotbar.onClear = (slot) => {
      unbind(this.quick, slot);
      this.hotbar.render();
      this.scheduleSave();
    };
    this.hotbar.render();

    // Карту печатаем один раз: она в игре не меняется, а слоёв 27. Картинки
    // тайлсетов уже загружены — Phaser держит их под именем тайлсета.
    this.minimap = new MinimapUi(this.doc.map, (name) =>
      this.textures.exists(name) ? (this.textures.get(name).getSourceImage() as CanvasImageSource) : null,
    );

    // Кнопок ровно столько, сколько окон. Появится третье — станет три строки.
    this.menu = new MenuUi([
      {
        label: 'Персонаж', key: 'I', icon: { sheet: 'icons', x: 1 * 16, y: 18 * 16, w: 16, h: 16 },
        isOpen: () => this.inventory.isOpen,
        toggle: () => this.inventory.toggle(),
      },
      {
        label: 'Умения', key: 'U', icon: { sheet: 'icons', x: 2 * 16, y: 4 * 16, w: 16, h: 16 },
        isOpen: () => this.skills.isOpen,
        toggle: () => this.skills.toggle(),
      },
      {
        label: 'Навыки', key: 'L', icon: { sheet: 'icons', x: 1 * 16, y: 1 * 16, w: 16, h: 16 },
        isOpen: () => this.skillTree.isOpen,
        toggle: () => this.skillTree.toggle(),
      },
      {
        label: 'Магазин', key: 'O', icon: { sheet: 'icons', x: 2 * 16, y: 0 * 16, w: 16, h: 16 },
        isOpen: () => this.shop.isOpen,
        toggle: () => this.toggleShop(),
      },
      {
        label: 'Кузница', key: 'K', icon: { sheet: 'icons', x: 0 * 16, y: 6 * 16, w: 16, h: 16 },
        isOpen: () => this.forge.isOpen,
        toggle: () => this.toggleForge(),
      },
      {
        label: 'Карта', key: 'M', icon: { sheet: 'icons', x: 4 * 16, y: 3 * 16, w: 16, h: 16 },
        isOpen: () => this.minimap.isFullOpen,
        toggle: () => this.minimap.toggleFull(),
      },
    ]);

    // I открывает и закрывает сумку. Игру не останавливаем: пауки не ждут, пока
    // ты роешься в грибах, — иначе сумка станет способом переждать бой.
    this.input.keyboard?.on('keydown-I', () => this.inventory.toggle());
    this.input.keyboard?.on('keydown-U', () => this.skills.toggle());
    this.input.keyboard?.on('keydown-L', () => this.skillTree.toggle());
    this.input.keyboard?.on('keydown-O', () => this.toggleShop());
    this.input.keyboard?.on('keydown-K', () => this.toggleForge());
    this.input.keyboard?.on('keydown-M', () => this.minimap.toggleFull());
    this.bindQuickKeys();

    // Прогресс вошедшего. Применяем ПОСЛЕ того, как собраны сумка, экипировка и
    // панель: applySave кладёт в те же самые объекты, на которые уже смотрят окна.
    this.applySave();

    // Ник героя: main.ts кладёт его до старта (из сейва или создания персонажа).
    const pendingName = takePendingChar();
    if (pendingName) this.charName = pendingName;
    if (!this.charName) this.charName = 'Герой';
    this.buildNameTag();
    this.chat.system(`Добро пожаловать в лес, ${this.charName}!`);

    // Сохраняемся, когда вкладку прячут или закрывают — не только по таймеру.
    // keepalive у запроса (см. pushProgress) даёт ему дожить после закрытия.
    this.onHide = () => {
      if (document.hidden) this.flushSave();
    };
    this.onLeave = () => this.flushSave();
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onLeave);

    this.events.once('shutdown', () => {
      this.flushSave();
      document.removeEventListener('visibilitychange', this.onHide);
      window.removeEventListener('pagehide', this.onLeave);
      this.hud.destroy();
      this.chat.destroy();
      this.nameTag?.destroy();
      this.chatBubble?.destroy();
      this.inventory.destroy();
      this.skills.destroy();
      this.skillTree.destroy();
      this.shop.destroy();
      this.forge.destroy();
      for (const a of this.arrows) a.destroy();
      this.hotbar.destroy();
      this.minimap.destroy();
      this.menu.destroy();
    });

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBounds(0, 0, this.doc.width * this.doc.map.tileWidth, this.doc.height * this.doc.map.tileHeight);

    // Своё округление камеры (см. followPlayer). Родное выключаем: оно живёт в
    // preRender и делает Math.floor до целого мирового пикселя — то есть до трёх
    // экранных при зуме 3 — независимо от того, следует камера за кем-то или нет.
    cam.setRoundPixels(false);
    this.followPlayer();

    // Загрузка позади — включаем автосейв. Флаг был нужен, чтобы правки во время
    // самого applySave не улетели обратно сейвом; теперь, когда опора сохранения —
    // локальное хранилище (см. auth/progress.ts), loadFailed всегда false, и
    // сохраняться можно всегда — прогресс не теряется даже без сервера.
    this.saveReady = !loadFailed();

    // Сразу сохраняемся: у нового героя ник и класс заданы, но геймплейной
    // правки, которая запустила бы автосейв, ещё не было. Закрой он вкладку
    // тут же — имя пропало бы. Один сейв на старте это закрывает.
    this.saveDirty = true;
    this.flushSave();
  }

  /**
   * Невидимый слой стен для физики.
   *
   * Черновик по картинке (вода, обрыв за краем нарисованного, стволы деревьев)
   * считаем ВСЕГДА, а размеченное руками кладём поверх: клетка UNSET значит «не
   * задано — спроси у черновика», WALK и BLOCK — слово человека.
   *
   * Раньше здесь было всё-или-ничего: черновик брали, только если вся разметка в
   * нулях. Одна нарисованная в редакторе стена отменяла черновик целиком, и вся
   * карта становилась непроходимой — на forest 0 клеток из 6300.
   */
  private buildCollision(tall: Map<number, number>): Phaser.Tilemaps.TilemapLayer {
    const draft = draftCollision(this.doc, tall, this.doc.map.tileHeight);
    const byHand = this.doc.map.collision.filter((v) => v !== 0).length;
    this.doc.map.collision = mergeCollision(this.doc.map.collision, draft.collision);

    const walkable = this.doc.map.collision.filter((v) => v === 1).length;
    console.log(
      `Проходимость: ${walkable} клеток из ${this.doc.width * this.doc.height}` +
        ` (черновик ${draft.walkable}, размечено руками ${byHand})`,
    );

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
      const m = new Monster(this, MONSTERS[p.kind], p.x, p.y);
      // Пауки прячутся за деревьями по тем же правилам, что игрок.
      m.setTallObjects(tall, this.doc.width, this.doc.height, this.doc.map.tileWidth, this.doc.map.tileHeight);
      this.monsters.push(m);
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
      this.hitMonster(m, strike.damage, strike.heavy, strike.crit);
    }

    if (hitAny.length) this.cameras.main.shake(strike.heavy ? 140 : 80, strike.heavy ? 0.006 : 0.003);
  }

  /**
   * Одно попадание по монстру — общее для взмаха меча и для стрелы. Урон, цифра,
   * а на убийстве — опыт, добыча и золото.
   *
   * Награда только на переходе «жив -> мёртв»: takeDamage по трупу молчит, но без
   * этой проверки повторное попадание всё равно начислило бы опыт и золото ещё раз.
   */
  private hitMonster(m: Monster, damage: number, heavy: boolean, crit: boolean): void {
    if (m.isDead) return;
    m.takeDamage(damage);
    // Крит — оранжевым и с восклицанием; тяжёлый — золотой; обычный — белый.
    const color = crit ? '#ff6a4d' : heavy ? '#ffd35c' : '#ffffff';
    this.damageNumber(m.sprite.x, m.sprite.y - 30, damage, color, crit ? `${damage}!` : undefined);
    // Вампиризм (навык): часть нанесённого урона возвращается здоровьем.
    this.healFromLifesteal(damage);
    if (m.isDead) {
      this.gainXp(m.stats.xp);
      this.dropLoot(m);
      const gold = this.awardGold(m);
      // Одна строка в чат на убийство: опыт и золото вместе.
      const goldPart = gold > 0 ? `, +${gold} золота` : '';
      this.chat.system(`Повержен ${m.stats.name} (ур.${m.stats.level}) — +${m.stats.xp} опыта${goldPart}.`);
    }
  }

  /** Вампиризм: вернуть здоровьем долю нанесённого урона. Тихо, но с зелёной цифрой. */
  private healFromLifesteal(damage: number): void {
    if (this.lifesteal <= 0 || this.player.isDead) return;
    const before = this.player.hp;
    this.player.hp = Math.min(this.player.hpMax, this.player.hp + Math.max(1, Math.floor(damage * this.lifesteal)));
    const gained = Math.round(this.player.hp - before);
    if (gained > 0) this.damageNumber(this.player.sprite.x, this.player.sprite.y - 38, 0, '#8ad46a', `+${gained}`);
  }

  /** Золото за убитого. Считаем чистой rollGold, показываем цифрой. Возвращаем начисленное. */
  private awardGold(m: Monster): number {
    const amount = rollGold(m.stats.gold);
    if (amount <= 0) return 0;
    this.gold += amount;
    this.damageNumber(m.sprite.x, m.sprite.y - 46, 0, '#ffd35c', `+${amount} зол.`);
    this.scheduleSave();
    return amount;
  }

  /** Лук выстрелил: рождаем стрелу. Дальше её ведёт updateArrows. */
  private spawnArrow(shot: Shot): void {
    this.arrows.push(new Arrow(this, shot.x, shot.y, shot.angle, shot.damage, shot.heavy, shot.crit));
  }

  /**
   * Двигаем стрелы и проверяем, во что они воткнулись. Первый монстр на пути ловит
   * стрелу, и она гаснет; так же гаснет в стене и на пределе дальности.
   *
   * Стену определяем ровно как для игрока — canWalk. Но стрела летит на высоте
   * груди, а проходимость задана у НОГ: клетку проверяем не там, где стрела
   * нарисована, а на CHEST_OFFSET ниже — на уровне земли. Иначе выстрел вдоль
   * стены, стоящей к северу (игрок у кромки воды), гас бы сразу: клетка над ногами
   * у воды — «не пройти», хотя летит стрела над проходимой землёй.
   */
  private updateArrows(delta: number): void {
    const tw = this.doc.map.tileWidth;
    const th = this.doc.map.tileHeight;

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.update(delta);
      const ax = a.sprite.x;
      const ay = a.sprite.y;

      const hit = this.monsters.find(
        (m) => !m.isDead && Math.abs(m.sprite.x - ax) < 11 && ay > m.sprite.y - 24 && ay < m.sprite.y + 4,
      );
      if (hit) {
        this.hitMonster(hit, a.damage, a.heavy, a.crit);
        this.cameras.main.shake(a.heavy ? 120 : 60, a.heavy ? 0.005 : 0.0025);
        a.destroy();
        this.arrows.splice(i, 1);
        continue;
      }

      const tx = Math.floor(ax / tw);
      const ty = Math.floor((ay + CHEST_OFFSET) / th); // проекция на землю
      const outside = tx < 0 || ty < 0 || tx >= this.doc.width || ty >= this.doc.height;
      const intoWall = a.traveled > 6 && !outside && !this.doc.canWalk(tx, ty);
      if (a.traveled > ARROW_RANGE || outside || intoWall) {
        a.destroy();
        this.arrows.splice(i, 1);
      }
    }
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
        // Сумка полна — предмет остаётся лежать целиком. Молча его терять нельзя.
        continue;
      }

      const name = ITEMS[l.id].name;
      const taken = l.qty - left;
      // Если сумка открыта, подобранное должно появиться в ней сразу.
      this.refreshBags();

      if (left > 0) {
        // Влезла только часть стопки. Остаток ОСТАЁТСЯ ЛЕЖАТЬ — раньше он тут же
        // стирался вместе с предметом: сумка забирала часть, а с земли исчезало
        // всё. Освободится место — доберём на следующем кадре.
        l.qty = left;
        this.damageNumber(px, py - 44, 0, '#d8c07a', `${name} ×${taken}, ещё ${left} — сумка полна`);
        continue;
      }

      this.loot.splice(i, 1);
      l.flyTo(px, py, () => {
        this.damageNumber(px, py - 44, 0, '#d8c07a', `${name}${taken > 1 ? ` ×${taken}` : ''}`);
      });
      // В чат — только заметную добычу (необычное и выше), иначе лента утонет
      // в грибах: обычные подборы и так видно всплывающей цифрой.
      if (rarityOf(l.id) !== 'common') {
        this.chat.system(`Добыча: ${name}${taken > 1 ? ` ×${taken}` : ''}.`);
      }
    }
  }

  /** Применить предмет из ячейки: съесть гриб, выпить зелье. */
  private useItem(index: number): void {
    const stack = this.bag[index];
    if (!stack) return;

    const def = ITEMS[stack.id];
    if (!def.use || this.player.isDead) return;

    // Полным здоровьем не разбрасываемся: съеденный впустую гриб — обида.
    const needHp = def.use.hp && this.player.hp < this.player.hpMax;
    const needMp = def.use.mp && this.player.mp < this.player.mpMax;
    if (!needHp && !needMp) {
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', 'не нужно');
      return;
    }

    takeOne(this.bag, index);

    if (def.use.hp) {
      this.player.hp = Math.min(this.player.hpMax, this.player.hp + def.use.hp);
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#8ad46a', `+${def.use.hp}`);
    }
    if (def.use.mp) {
      this.player.mp = Math.min(this.player.mpMax, this.player.mp + def.use.mp);
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 56, 0, '#5ba3e0', `+${def.use.mp}`);
    }

    this.refreshBags();
  }

  /**
   * Сумка изменилась. Одно место на оба окна: панель внизу показывает остаток
   * тех же предметов, и обновлять её отдельно означало бы рано или поздно забыть.
   * Отсюда же планируем автосейв — любая правка сумки его касается.
   */
  private refreshBags(): void {
    this.inventory.render();
    this.hotbar.render();
    this.scheduleSave();
  }

  /** Снимок прогресса для сейва. Ссылки, а не копии: pushProgress тут же его сериализует. */
  private snapshot(): Progress {
    return {
      level: this.player.level,
      xp: this.player.xp,
      hp: this.player.hp,
      mp: this.player.mp,
      gold: this.gold,
      bag: this.bag,
      equipped: this.equipped,
      quick: this.quick,
      spent: this.spent,
      sharpen: this.sharpen,
      skills: this.skillRanks,
      charName: this.charName,
    };
  }

  /**
   * Отложить автосейв. Собираем правки в кучу: подряд подобрал пять грибов —
   * одна отправка, а не пять. Отправляем через полторы секунды затишья.
   */
  private scheduleSave(): void {
    if (!this.saveReady) return;
    this.saveDirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 1500);
  }

  /** Отправить сейв немедленно — при выходе, смерти, закрытии вкладки. */
  private flushSave(): void {
    if (!this.saveReady || !this.saveDirty) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = 0;
    }
    this.saveDirty = false;
    void pushProgress(serializeProgress(this.snapshot()));
  }

  /**
   * Применить скачанный сейв. Кладём в те же bag/equipped/quick/spent, на которые
   * уже смотрят окна (мутируем, а не подменяем ссылку), затем пересобираем
   * прибавки и восстанавливаем игрока — в порядке очки -> вещи -> уровень, чтобы
   * потолок здоровья к моменту restore был честным.
   */
  private applySave(): void {
    const prog = parseSave(takePendingSave(), BAG_SIZE);
    if (!prog) return;

    // Сумка и панель — по месту: ссылки в окнах остаются те же.
    for (let i = 0; i < BAG_SIZE; i++) this.bag[i] = prog.bag[i] ?? null;
    for (const k of Object.keys(this.equipped) as (keyof Equipped)[]) delete this.equipped[k];
    Object.assign(this.equipped, prog.equipped);
    // Старым сейвам (сделанным до появления меча) выдаём стартовый меч, если
    // оружия у героя нет вовсе: у каждого героя он есть. Второго не плодим — см.
    // ensureStarterWeapon. Делаем ДО applyGear, чтобы прибавка и режим стрельбы
    // считались от уже финального оружия.
    ensureStarterWeapon(this.equipped, this.bag);
    for (let i = 0; i < this.quick.length; i++) this.quick[i] = prog.quick[i] ?? null;
    this.spent = prog.spent;
    this.gold = prog.gold;
    // Заточка и навыки — ДО applyGear: тот считает урон, здоровье, крит уже с ними.
    this.sharpen = prog.sharpen;
    this.skillRanks = prog.skills;
    if (prog.charName) this.charName = prog.charName;

    this.player.setPoints(bonusFrom(this.spent));
    this.applyGear(); // прибавки вещей — до restore, чтобы hpMax был верным
    this.player.restore(prog.level, prog.xp, prog.hp, prog.mp);

    this.refreshBags();
  }

  /** Клавиши 1-9 и 0 — ячейки панели быстрого доступа. */
  private bindQuickKeys(): void {
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
    keys.forEach((k, i) => this.input.keyboard?.on(`keydown-${k}`, () => this.useQuick(i)));
    // Ноль — десятая ячейка, как подписано на планке.
    this.input.keyboard?.on('keydown-ZERO', () => this.useQuick(9));
  }

  /**
   * Ячейка панели делает с предметом ровно то же, что сделал бы клик по нему в
   * сумке: еду съедает, вещь надевает. Одно правило вместо двух — гадать, какая
   * клавиша на что, игроку незачем.
   */
  private useQuick(slot: number): void {
    if (this.player.isDead) return;

    const id = this.quick[slot];
    if (!id) return;

    // Надетое снимается той же клавишей, что надела: как и клик по гнезду в окне.
    const worn = slotWearing(this.equipped, id);
    if (worn) {
      this.hotbar.flash(slot);
      this.unequipItem(worn);
      return;
    }

    const index = findInBag(this.quick, slot, this.bag);
    if (index < 0) {
      // Молчать нельзя: игрок жмёт клавишу и должен понять, почему ничего нет.
      // Без глагола намеренно — иначе «меч кончился» и «зелье кончилось».
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', `${ITEMS[id].name} — нет в сумке`);
      return;
    }

    this.hotbar.flash(slot);
    if (ITEMS[id].slot) this.equipItem(index);
    else this.useItem(index);
  }

  /** Надеть вещь из ячейки сумки. */
  private equipItem(index: number): void {
    const res = equipFromBag(this.bag, index, this.equipped);
    if (!res.ok) return;

    this.applyGear();
    this.refreshBags();
  }

  /** Снять надетое обратно в сумку. */
  private unequipItem(slot: EquipSlot): void {
    const res = unequip(this.equipped, slot, (id) => addToBag(this.bag, id, 1) === 0);
    if (!res.ok) {
      // Сумка полна: вещь осталась надетой, и игрок должен понять почему.
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', 'сумка полна');
      return;
    }

    this.applyGear();
    this.refreshBags();
  }

  /**
   * Пересчитать прибавки от вещей. Одно место — иначе бонусы разъедутся. Заодно
   * сообщаем игроку, стреляет ли надетое оружие: лук превращает взмах в выстрел.
   *
   * Заточка (кузница, K) бьёт через тот же канал, что бонус оружия: +1 урона за
   * уровень. Сняли меч — ушла и его заточка, надели обратно — вернулась.
   */
  private applyGear(): void {
    const bonus = totalBonuses(this.equipped);
    bonus.dmg += sharpenBonus(this.sharpen, this.equipped.weapon);

    // Навыки дерева (L) — через тот же аггрегат, что вещи: их стат-бонусы
    // складываются в gear и учитываются в здоровье, скорости, защите, уроне.
    // Урон лука («Меткость») добавляем только когда надет лук.
    const sb = skillBonuses(this.skillRanks);
    const ranged = isRanged(this.equipped.weapon);
    bonus.dmg += sb.dmg + (ranged ? sb.rangedDmg : 0);
    bonus.speed += sb.speed;
    bonus.mp += sb.mp;
    bonus.hp += sb.hp;
    bonus.def += sb.def;

    this.player.setGear(bonus);
    this.player.setRanged(ranged);
    // Крит и вампиризм — не стат-бонусы, отдельными каналами.
    this.player.setCrit(sb.critChance, BASE_CRIT_MUL + sb.critMul);
    this.lifesteal = sb.lifesteal;
  }

  /** Вложить ранг навыка (дерево L). Проверки — в чистой allocate; окно только шлёт намерение. */
  private allocateSkill(nodeId: string): void {
    if (!allocateSkill(nodeId, this.skillRanks, this.player.level)) return;
    this.applyGear(); // навык мог поднять здоровье/скорость/крит — пересобираем
    this.skillTree.render();
    this.inventory.refreshStats();
    this.scheduleSave();
  }

  /**
   * Попытка заточки из окна кузницы. Бросок и все проверки — в чистой trySharpen;
   * здесь только применяем итог: свиток сгорел (сумка изменилась), при успехе
   * урон пересчитан, и оба исхода честно показаны в окне.
   *
   * Оружие приходит из окна (точить можно и лежащее в сумке), поэтому первым
   * делом проверяем, что оно у игрока вообще есть: окну верить нельзя, оно DOM.
   */
  private sharpenWeapon(weaponId: string): void {
    const owned = this.equipped.weapon === weaponId || this.bag.some((s) => s?.id === weaponId);
    if (!owned) {
      this.forge.flash('этого оружия у тебя нет', false);
      return;
    }

    const res = trySharpen(this.sharpen, weaponId, this.bag);
    if (!res.ok) {
      this.forge.flash(res.reason, false);
      return;
    }

    this.refreshBags(); // свиток съеден: сумка, панель и автосейв
    if (res.success) {
      // Пересчёт урона: если точили надетое, прибавка работает сразу.
      this.applyGear();
      this.forge.flash(`Успех! ${ITEMS[weaponId].name} теперь +${res.level}`);
      this.chat.system(`Заточка удалась: ${ITEMS[weaponId].name} теперь +${res.level}!`);
    } else {
      this.forge.flash(`Неудача на +${res.target} — свиток сгорел, заточка +${res.level} цела`, false);
      this.chat.system(`Заточка на +${res.target} не удалась — свиток сгорел, заточка +${res.level} цела.`);
    }
    this.forge.render();
  }

  /**
   * Магазин и кузница не живут одновременно: оба — центральные окна, и кузница
   * (выше по z) накрывала магазин. Кнопка кузницы зовёт «купи в магазине (O)» —
   * нажал O, и магазин обязан оказаться СВЕРХУ, а не под кузницей (нашла
   * состязательная проверка). Открываешь одно — второе закрывается.
   */
  private toggleShop(): void {
    if (!this.shop.isOpen) this.forge.close();
    this.shop.toggle();
  }

  private toggleForge(): void {
    if (!this.forge.isOpen) this.shop.close();
    this.forge.toggle();
  }

  /** Купить предмет в магазине. Все проверки — в чистой buyItem, окно только шлёт намерение. */
  private buy(id: string): void {
    const res = buyItem(this.gold, this.bag, id);
    if (!res.ok) {
      this.shop.flash(res.reason, false);
      return;
    }
    this.gold = res.gold;
    this.refreshBags(); // сумка + панель + автосейв
    this.shop.render(); // витрина: обновить кошелёк и доступность кнопок
    this.shop.flash(`Куплено: ${ITEMS[id].name} (−${res.price})`);
    this.chat.system(`Покупка: ${ITEMS[id].name} за ${res.price} золота.`);
  }

  /**
   * Продать отобранные в корзине ячейки — целыми стопками. Каждую продаёт чистая
   * sellStack, сверяя, что в ячейке всё ещё ТА вещь, которую игрок отбирал:
   * горячие клавиши живут и при открытом магазине, и надетый меч мог лечь в
   * отобранную ячейку за кадр до продажи. Не совпало — ячейку пропускаем.
   */
  private sellBasket(picks: { index: number; id: string }[]): void {
    let total = 0;
    let count = 0;
    for (const p of picks) {
      const res = sellStack(this.gold, this.bag, p.index, p.id);
      if (!res.ok) continue;
      this.gold = res.gold;
      total += res.total;
      count += res.qty;
    }

    if (!count) {
      this.shop.flash('Продавать нечего', false);
      return;
    }

    this.refreshBags();
    this.shop.render();
    this.shop.flash(`Продано ×${count} за +${total}`);
    this.chat.system(`Продажа: ${count} шт. за ${total} золота.`);
  }

  /**
   * Вложить очко характеристики.
   *
   * Молчать при отказе нельзя: игрок жмёт «+» и должен понять, почему ничего не
   * произошло. Кнопку мы прячем, когда очков нет, но проверка тут — своя: окно
   * могло не успеть перерисоваться.
   */
  private spendPointOn(stat: Stat): void {
    if (!spendPoint(this.spent, stat, this.player.level)) {
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', 'нет очков');
      return;
    }

    this.player.setPoints(bonusFrom(this.spent));
    // Обновляем оба окна: тратим в умениях, но панель персонажа тоже показывает
    // и остаток очков, и прибавку от них.
    this.skills.render();
    this.inventory.refreshStats();
    this.scheduleSave();
  }

  /**
   * Пересчитать волну от игрока, если он перешёл в другую клетку.
   *
   * Одна волна на всех пауков: цель у них общая, и считать поиск пути каждому из
   * шестнадцати незачем. 6300 клеток обходятся за доли миллисекунды, а внутри
   * одной клетки игрока результат не меняется — потому и проверка flowAt.
   */
  private updateFlow(): void {
    const at =
      Math.floor(this.player.sprite.y / this.doc.map.tileHeight) * this.doc.width +
      Math.floor(this.player.sprite.x / this.doc.map.tileWidth);
    if (at === this.flowAt) return;
    this.flowAt = at;

    const flow = buildFlow(this.doc.width, this.doc.height, (i) => this.doc.map.collision[i] === 1, at);
    for (const m of this.monsters) m.setFlow(flow);
  }

  private gainXp(amount: number): void {
    this.scheduleSave();
    this.player.xp += amount;
    while (this.player.xp >= xpToNext(this.player.level)) {
      this.player.xp -= xpToNext(this.player.level);
      this.player.level++;
      this.player.growMax(10, 5);
      this.player.hp = this.player.hpMax;
      this.player.mp = this.player.mpMax;
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 40, 0, '#8ad46a', `УРОВЕНЬ ${this.player.level}`);
      // Про очки говорим отдельно: молча начисленное игрок не заметит и не
      // вложит, а окно персонажа само не откроется.
      this.damageNumber(
        this.player.sprite.x, this.player.sprite.y - 56, 0, '#e0c48a',
        `+${POINTS_PER_LEVEL} очка (U)`,
      );
      this.chat.system(`Новый уровень: ${this.player.level}! +${POINTS_PER_LEVEL} очка умений (U).`);
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

  /** Метка с ником над героем: идёт за ним и сортируется вместе с ним. */
  private buildNameTag(): void {
    this.nameTag = this.add
      .text(this.player.sprite.x, this.player.sprite.y - 33, this.charName, {
        fontFamily: 'monospace',
        fontSize: '4px',
        color: '#eaf6f0',
        stroke: '#000000',
        strokeThickness: 1,
      })
      .setOrigin(0.5, 1)
      .setResolution(ZOOM + 3);
  }

  /**
   * Показать над героем облачко с его репликой из чата: над самим ником, так
   * что видно, кто написал. Живёт несколько секунд и гаснет. Текст рисуется как
   * есть (Phaser Text — не HTML), поэтому тегам из ввода тут навредить нечем;
   * длинное обрезаем, чтобы облачко не разрослось на пол-экрана.
   */
  private showChatBubble(text: string): void {
    const msg = text.length > 60 ? `${text.slice(0, 59)}…` : text;
    this.chatBubbleUntil = this.time.now + 5000;
    if (!this.chatBubble) {
      this.chatBubble = this.add
        .text(this.player.sprite.x, this.player.sprite.y - 44, msg, {
          fontFamily: 'monospace',
          fontSize: '5px',
          color: '#ffffff',
          backgroundColor: 'rgba(20,16,12,0.82)',
          padding: { x: 3, y: 2 },
          align: 'center',
          wordWrap: { width: 96 },
        })
        .setOrigin(0.5, 1)
        .setResolution(ZOOM + 3);
    } else {
      this.chatBubble.setText(msg);
    }
    this.chatBubble.setVisible(true);
  }

  protected onUpdate(delta: number): void {
    const now = this.time.now;
    this.player.update(now, delta);
    this.updateFlow();

    // Ник идёт за героем; глубина как у него — уходит за крону вместе с ним.
    if (this.nameTag) {
      this.nameTag.setPosition(this.player.sprite.x, this.player.sprite.y - 33);
      this.nameTag.setDepth(this.player.sprite.depth + 0.03);
      this.nameTag.setVisible(!this.player.isDead);
    }

    // Облачко реплики над ником: следует за героем, к концу срока тает.
    if (this.chatBubble && this.chatBubble.visible) {
      if (now >= this.chatBubbleUntil || this.player.isDead) {
        this.chatBubble.setVisible(false);
      } else {
        this.chatBubble.setPosition(this.player.sprite.x, this.player.sprite.y - 44);
        this.chatBubble.setDepth(this.player.sprite.depth + 0.04);
        const left = this.chatBubbleUntil - now;
        this.chatBubble.setAlpha(left < 700 ? left / 700 : 1);
      }
    }

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

    this.updateArrows(delta);
    this.updateLoot(now);

    if (this.player.isDead && !this.deathAt) {
      this.deathAt = now;
      this.hud.showDeath(true);
      this.chat.system('Ты пал в бою. Часть опыта потеряна — скоро возрождение.');
    }
    if (this.deathAt && now - this.deathAt > 2000) {
      this.deathAt = 0;
      this.hud.showDeath(false);
      const { x, y } = this.drawnCenter();
      // Опыт теряется, но не уровень: откат до нуля обиднее смерти.
      this.player.xp = Math.floor(this.player.xp * 0.7);
      this.player.respawn(x, y, now);
      // Смерть сохраняем сразу: иначе игрок решит, что она откатывается, а она нет.
      this.flushSave();
    }

    this.hud.set(
      this.player.hp,
      this.player.hpMax,
      this.player.mp,
      this.player.mpMax,
      this.player.xp,
      xpToNext(this.player.level),
    );
    this.hud.setGold(this.gold);
    this.inventory.refreshStats();
    this.skills.render();
    this.skillTree.render();
    this.shop.render();
    this.forge.render();
    this.menu.render();
    // Мёртвых пауков на карте не показываем: труп — не угроза.
    this.minimap.render({
      player: { x: this.player.sprite.x, y: this.player.sprite.y },
      monsters: this.monsters.filter((m) => !m.isDead).map((m) => ({ x: m.sprite.x, y: m.sprite.y })),
      loot: this.loot.map((l) => ({ x: l.sprite.x, y: l.sprite.y })),
    });
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
    const b = drawnBounds(this.doc.map);
    const tw = this.doc.map.tileWidth;
    const th = this.doc.map.tileHeight;
    // Пустая карта — ставим в середину холста: другого ориентира нет.
    if (!b) return { x: (this.doc.width * tw) / 2, y: (this.doc.height * th) / 2 };
    return { x: ((b.minX + b.maxX) / 2) * tw, y: ((b.minY + b.maxY) / 2) * th };
  }
}
