import Phaser from 'phaser';
import { MapScene } from './MapScene';
import { Player, CHEST_OFFSET, type ArmorTint, type Strike, type Shot } from '../game/player';
import { Monster } from '../game/monster';
import { Arrow, ARROW_RANGE } from '../game/arrow';
import { Fireball, FIREBALL_RANGE, FIREBALL_MP_COST, FIREBALL_COOLDOWN, FIREBALL_CAST_TIME } from '../game/fireball';
import {
  RAIN_TEX, RAIN_RANGE, RAIN_RADIUS, RAIN_MP_COST, RAIN_COOLDOWN, RAIN_DURATION, RAIN_TICKS, RAIN_ARROWS,
  ensureRainArrowTexture,
} from '../game/arrow-rain';
import { BARRIER_MP_COST, BARRIER_COOLDOWN, BARRIER_REDUCTION } from '../game/barrier';
import { fireballDamage, arrowRainDamage } from '../game/combat';
import { findTallObjects } from '../game/tall-objects';
import { pickSpawns } from '../game/spawn';
import { buildFlow } from '../game/flow';
import { HERO, MONSTERS, SPAWNS, xpToNext, rollDrop, rollGold } from '../game/creatures';
import { Hud } from '../game/hud';
import { draftCollision, mergeCollision } from '../map/collision-draft';
import { drawnBounds } from '../map/doc';
import { Loot, registerItemFrames } from '../game/loot';
import { addToBag, takeOne, sortBag, isRanged, countOf, rarityOf, roomFor, ITEMS, type Stack, type EquipSlot } from '../game/items';
import { MarketUi } from '../game/market-ui';
import { marketBrowse, marketBuy, marketList, marketCancel, marketMine, marketHistory, marketMail, marketMailAck } from '../game/market-client';
import type { BrowseFilter, BrowseResult, Lot, TradeItem, TradeRecord } from '../game/market-types';
import { InventoryUi } from '../game/inventory-ui';
import { SkillsUi } from '../game/skills-ui';
import { ShopUi } from '../game/shop-ui';
import { ForgeUi } from '../game/forge-ui';
import { trySharpen, SCROLL_ID } from '../game/forge';
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

/** Первый слот хотбара — умение «Огненный шар» (клавиша 1), а не предмет. */
const SKILL_SLOT = 0;
/** Слот умения «Град стрел» (клавиша 2). */
const RAIN_SLOT = 1;
/** Слот умения «Барьер» (клавиша 3). */
const BARRIER_SLOT = 2;
/** Сколько первых слотов хотбара заняты умениями (не предметами). */
const SKILL_SLOTS = 3;

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
  private market!: MarketUi;
  /** Снимок рынка для окна: витрина/мои/история и состояние запроса. Сервер ходит через market-client. */
  private mkBrowse: BrowseResult | null = null;
  private mkMine: Lot[] = [];
  private mkHistory: TradeRecord[] = [];
  private mkUnavailable = false;
  private mkLoading = false;
  private mkNotice: { text: string; ok: boolean } | undefined;
  private mkFilter: BrowseFilter = { category: 'all', search: '', rarity: 'any', sort: 'newest', page: 1 };
  /** Идёт покупка/выставление/снятие — блокирует новые действия, чтобы не было гонок золота/предметов. */
  private mkBusy = false;
  /** Текущий сбор почты — чтобы два наложенных сбора не задвоили выручку/предметы. */
  private mkMailRun: Promise<void> | undefined;
  private hotbar!: HotbarUi;
  private minimap!: MinimapUi;
  private menu!: MenuUi;
  private loot: Loot[] = [];
  /** Стрелы в полёте. Сцена их двигает и проверяет попадания — как взмах меча. */
  private arrows: Arrow[] = [];
  /** Огненные шары в полёте (умение, слот 1 хотбара). Ведёт сцена, как стрелы. */
  private fireballs: Fireball[] = [];
  /** Докуда умение «Огненный шар» на перезарядке (время сцены). 0 — готово. */
  private fireballReadyAt = 0;
  /** Идёт каст: время его завершения. 0 — не кастуем. Пока кастуем — герой «читает». */
  private fireballCastUntil = 0;
  /** Когда каст начался — для полоски прогресса над героем. */
  private fireballCastStart = 0;
  /** Полоска каста над героем (фон + оранжевая заливка). Создаётся при первом касте. */
  private castBarBg?: Phaser.GameObjects.Rectangle;
  private castBar?: Phaser.GameObjects.Rectangle;
  /** Град стрел: идёт ли прицеливание (круг у курсора ждёт клика по точке залпа). */
  private rainAiming = false;
  /** Круг-прицел града стрел. Создаётся при первом прицеливании. */
  private rainReticle?: Phaser.GameObjects.Arc;
  /** Докуда «Град стрел» на перезарядке (время сцены). 0 — готово. */
  private rainReadyAt = 0;
  /** Активные залпы града: центр, следующая волна урона и сколько волн осталось. */
  private rains: { cx: number; cy: number; nextTick: number; ticksLeft: number }[] = [];
  /** Докуда «Барьер» на перезарядке (время сцены). 0 — готово. */
  private barrierReadyAt = 0;
  /** Пузырь щита вокруг героя, пока держится барьер. Создаётся при первом касте. */
  private shieldBubble?: Phaser.GameObjects.Arc;
  /** Золото игрока. Падает с монстров, тратится в магазине. Часть сейва. */
  private gold = 0;
  /**
   * Заточка НАДЕТОГО оружия, +N (кузница, K). Часть сейва. Заточка оружия в
   * сумке живёт на самих ячейках (`Stack.sharpen`): каждый меч точится отдельно.
   * Снял меч — его заточка уезжает в сумку вместе с ним, надел — возвращается.
   */
  private weaponSharpen = 0;
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
    // Оружие в руке героя: у каждого меча/лука своя картинка (items.held).
    for (const def of Object.values(ITEMS)) {
      if (def.held) this.load.image(`held-${def.id}`, def.held);
    }
  }

  protected onReady(): void {
    // Режем кадры под предметы: делать это в preload нельзя — тайлсет Objects
    // с грибами догружается вторым проходом и до create его текстуры ещё нет.
    registerItemFrames(this);
    // Склеиваем героя из слоёв (тело+голова+тень, БЕЗ меча) — до создания анимаций
    // в конструкторе Player: они нарезают кадры уже из готового листа.
    Player.buildTextures(this);

    // Ставим в середину нарисованного леса, а не карты: холст расширяли вправо
    // и вниз, поэтому центр карты — пустое поле.
    const { x, y } = this.drawnCenter();
    this.player = new Player(
      this, x, y,
      (strike) => this.playerStrike(strike),
      () => this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#5ba3e0', 'not enough mana'),
      (shot) => this.spawnArrow(shot),
      () => !this.rainAiming, // пока целятся градом стрел, обычный удар не проходит
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
      sharpen: this.weaponSharpen,
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
    this.shop.onBuy = (id) => this.buy(id);
    this.shop.onSellBasket = (indices) => this.sellBasket(indices);

    // Кузница (K): заточка оружия свитками — любого своего, не только надетого.
    // Бросок — в чистой trySharpen; окно только показывает состояние и шлёт
    // намерение. Каждый экземпляр — отдельная ячейка: заточка числится за
    // конкретным мечом (см. forge.ts). Адрес экземпляра — key: 'equipped' или
    // 'bag:<индекс>'; id несём рядом, чтобы сцена сверила, что за это время оружие
    // в ячейке не подменилось.
    this.forge = new ForgeUi();
    this.forge.setState(() => {
      const isWeapon = (id: string | undefined): id is string =>
        !!id && Object.hasOwn(ITEMS, id) && ITEMS[id].slot === 'weapon';
      const weapons: { key: string; id: string; plus: number; equipped: boolean }[] = [];
      if (isWeapon(this.equipped.weapon)) {
        weapons.push({ key: 'equipped', id: this.equipped.weapon, plus: this.weaponSharpen, equipped: true });
      }
      this.bag.forEach((s, i) => {
        if (s && isWeapon(s.id)) weapons.push({ key: `bag:${i}`, id: s.id, plus: s.sharpen ?? 0, equipped: false });
      });
      return { weapons, scrolls: countOf(this.bag, SCROLL_ID) };
    });
    this.forge.onSharpen = (key, id) => this.sharpenWeapon(key, id);

    // Торговый рынок (T): аукцион между аккаунтами. Окно только рисует снимок и
    // шлёт намерения; на сервер (market-client) ходит сцена — одно место оркестрации.
    this.market = new MarketUi();
    this.market.setState(() => ({
      gold: this.gold,
      bag: this.bag,
      unavailable: this.mkUnavailable,
      loading: this.mkLoading,
      browse: this.mkBrowse,
      mine: this.mkMine,
      history: this.mkHistory,
      notice: this.mkNotice,
      busy: this.mkBusy,
    }));
    this.market.setActions({
      onQuery: (f) => void this.marketQuery(f),
      onRefresh: (tab) => void this.marketOnRefresh(tab),
      onBuy: (id) => void this.marketBuyLot(id),
      onList: (item, price) => void this.marketListItem(item, price),
      onCancel: (id) => void this.marketCancelLot(id),
    });

    this.hotbar = new HotbarUi();
    this.hotbar.setData(this.quick, this.bag, this.equipped);
    this.hotbar.setPlusFor((id) => this.weaponPlusFor(id));
    this.hotbar.onTrigger = (slot) => this.useQuick(slot);
    // Первые слоты — умения (0 — огненный шар, 1 — град стрел, 2 — барьер), а не предметы.
    this.hotbar.onSkill = (i) => {
      if (i === SKILL_SLOT) this.castFireball();
      else if (i === RAIN_SLOT) this.castArrowRain();
      else this.castBarrier();
    };
    this.hotbar.onBind = (slot, id) => {
      // В слоты умений предмет не кладём — они заняты способностями.
      if (slot < SKILL_SLOTS) return;
      bind(this.quick, slot, id);
      this.hotbar.render();
      this.scheduleSave();
    };
    this.hotbar.onSwap = (from, to) => {
      if (from < SKILL_SLOTS || to < SKILL_SLOTS) return; // умения не перетаскиваются
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
        label: 'Character', key: 'I', icon: { sheet: 'icons', x: 1 * 16, y: 18 * 16, w: 16, h: 16 },
        isOpen: () => this.inventory.isOpen,
        toggle: () => this.inventory.toggle(),
      },
      {
        label: 'Attributes', key: 'U', icon: { sheet: 'icons', x: 2 * 16, y: 4 * 16, w: 16, h: 16 },
        isOpen: () => this.skills.isOpen,
        toggle: () => this.skills.toggle(),
      },
      {
        label: 'Skills', key: 'L', icon: { sheet: 'icons', x: 1 * 16, y: 1 * 16, w: 16, h: 16 },
        isOpen: () => this.skillTree.isOpen,
        toggle: () => this.skillTree.toggle(),
      },
      {
        label: 'Shop', key: 'O', icon: { sheet: 'icons', x: 2 * 16, y: 0 * 16, w: 16, h: 16 },
        isOpen: () => this.shop.isOpen,
        toggle: () => this.toggleShop(),
      },
      {
        label: 'Forge', key: 'K', icon: { sheet: 'icons', x: 0 * 16, y: 6 * 16, w: 16, h: 16 },
        isOpen: () => this.forge.isOpen,
        toggle: () => this.toggleForge(),
      },
      {
        label: 'Market', key: 'T', icon: { sheet: 'icons', x: 0, y: 16 * 16, w: 16, h: 16 },
        isOpen: () => this.market.isOpen,
        toggle: () => this.toggleMarket(),
      },
      {
        label: 'Map', key: 'M', icon: { sheet: 'icons', x: 4 * 16, y: 3 * 16, w: 16, h: 16 },
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
    this.input.keyboard?.on('keydown-T', () => this.toggleMarket());
    this.input.keyboard?.on('keydown-M', () => this.minimap.toggleFull());
    // Esc отменяет прицеливание града стрел (если целятся).
    this.input.keyboard?.on('keydown-ESC', () => { if (this.rainAiming) this.cancelRainAim(); });
    // Клик по миру во время прицеливания: ЛКМ — залп в точку, ПКМ — отмена. Обычный
    // удар в это время не проходит (Player.canAct), так что конфликта нет.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (!this.rainAiming) return;
      if (p.rightButtonDown()) this.cancelRainAim();
      else this.confirmArrowRain(p);
    });
    this.bindQuickKeys();

    // Прогресс вошедшего. Применяем ПОСЛЕ того, как собраны сумка, экипировка и
    // панель: applySave кладёт в те же самые объекты, на которые уже смотрят окна.
    this.applySave();

    // Ник героя: main.ts кладёт его до старта (из сейва или создания персонажа).
    const pendingName = takePendingChar();
    if (pendingName) this.charName = pendingName;
    if (!this.charName) this.charName = 'Hero';
    this.buildNameTag();
    this.chat.system(`Welcome to the forest, ${this.charName}!`);

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
      this.market.destroy();
      for (const a of this.arrows) a.destroy();
      for (const f of this.fireballs) f.destroy();
      this.castBarBg?.destroy();
      this.castBar?.destroy();
      this.rainReticle?.destroy();
      this.shieldBubble?.destroy();
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
    // Тяжёлый удар (ПКМ) — со своим росчерком, даже если взмах прошёл по воздуху.
    if (strike.heavy) this.heavySwingFx(strike.angle);

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
   * Зрелище тяжёлого удара (ПКМ): светящийся росчерк-дуга по стороне взмаха и
   * короткая вспышка-ядро в точке удара. Рисуем ПОВЕРХ героя, его костюм и тинт
   * не трогаем — герой остаётся собой (белую вспышку тинтом занимает урон), а
   * удар всё равно читается как мощный. Лёгкий удар этого не получает.
   */
  private heavySwingFx(angle: number): void {
    const hero = this.player.sprite;
    const depth = hero.depth + 0.5;
    // Центр эффекта — перед грудью героя, в сторону взмаха.
    const ox = hero.x + Math.cos(angle) * 12;
    const oy = hero.y - CHEST_OFFSET + Math.sin(angle) * 12;

    // Полумесяц-росчерк: толстая светящаяся дуга, развёрнутая по удару, растёт и тает.
    const slash = this.add.graphics({ x: ox, y: oy });
    slash.lineStyle(3, 0xbfefff, 1).beginPath();
    slash.arc(0, 0, 14, -1, 1, false);
    slash.strokePath();
    slash.setRotation(angle).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);
    this.tweens.add({
      targets: slash,
      scaleX: 1.9,
      scaleY: 1.9,
      alpha: 0,
      duration: 210,
      ease: 'Cubic.Out',
      onComplete: () => slash.destroy(),
    });

    // Вспышка-ядро: короткий яркий блик в точке удара. Голубой, а не белый, —
    // чтобы не путать с вспышкой получения урона.
    const core = this.add.graphics({ x: ox, y: oy });
    core.fillStyle(0xeaffff, 0.9).fillCircle(0, 0, 5);
    core.setBlendMode(Phaser.BlendModes.ADD).setDepth(depth + 0.01);
    this.tweens.add({
      targets: core,
      scaleX: 2.2,
      scaleY: 2.2,
      alpha: 0,
      duration: 150,
      ease: 'Quad.Out',
      onComplete: () => core.destroy(),
    });
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
      const goldPart = gold > 0 ? `, +${gold} gold` : '';
      this.chat.system(`Defeated ${m.stats.name} (Lv.${m.stats.level}) — +${m.stats.xp} XP${goldPart}.`);
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
    this.damageNumber(m.sprite.x, m.sprite.y - 46, 0, '#ffd35c', `+${amount} g`);
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

  /**
   * Нажали умение «Огненный шар» (клавиша «1» или клик по слоту). Не выпускаем
   * шар сразу: герой секунду «читает» заклинание (полоска каста над головой), и
   * только потом снаряд вылетает — см. updateCast. Ману резервируем в начале,
   * перезарядку ставим уже на вылете.
   */
  private castFireball(): void {
    if (this.player.isDead) return;

    const now = this.time.now;
    if (this.fireballCastUntil > 0) {
      this.hotbar.flash(SKILL_SLOT); // уже читаем заклинание — второй каст не начать
      return;
    }
    if (now < this.fireballReadyAt) {
      this.hotbar.flash(SKILL_SLOT); // идёт перезарядка — каста нет
      return;
    }
    if (this.player.mp < FIREBALL_MP_COST) {
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#5ba3e0', 'not enough mana');
      return;
    }

    // Ману резервируем сразу; если каст прервётся (смерть) — вернём (см. cancelCast).
    this.player.mp -= FIREBALL_MP_COST;
    this.fireballCastStart = now;
    this.fireballCastUntil = now + FIREBALL_CAST_TIME;
    this.hotbar.flash(SKILL_SLOT);
    this.showCastBar();
  }

  /** Идёт каст: двигаем полоску, а на завершении выпускаем шар. Смерть — отмена. */
  private updateCast(now: number): void {
    if (this.fireballCastUntil <= 0) return;

    if (this.player.isDead) {
      this.cancelCast(true); // помер во время чтения — вернём ману, шар не летит
      return;
    }

    if (now >= this.fireballCastUntil) {
      this.spawnFireball();
      this.fireballReadyAt = now + FIREBALL_COOLDOWN; // перезарядка идёт от ВЫЛЕТА
      this.fireballCastUntil = 0;
      if (this.castBarBg) this.castBarBg.setVisible(false);
      if (this.castBar) this.castBar.setVisible(false);
      return;
    }

    // Прогресс полоски и её место над героем (полоска идёт за ним).
    const frac = (now - this.fireballCastStart) / FIREBALL_CAST_TIME;
    this.updateCastBar(frac);
  }

  /** Отменить каст (смерть). refundMana — вернуть зарезервированную ману. */
  private cancelCast(refundMana: boolean): void {
    if (this.fireballCastUntil <= 0) return;
    this.fireballCastUntil = 0;
    if (refundMana) this.player.mp = Math.min(this.player.mpMax, this.player.mp + FIREBALL_MP_COST);
    if (this.castBarBg) this.castBarBg.setVisible(false);
    if (this.castBar) this.castBar.setVisible(false);
  }

  /** Выпустить шар в курсор — в момент завершения каста. Прицел берём АКТУАЛЬНЫЙ. */
  private spawnFireball(): void {
    const p = this.input.activePointer;
    const ox = this.player.sprite.x;
    const oy = this.player.sprite.y - CHEST_OFFSET; // от груди, а не от ног — иначе стелется
    const angle = Math.atan2(p.worldY - oy, p.worldX - ox);
    this.player.faceToward(p.worldX, p.worldY);

    // Урон растёт с уровнем; крит — из дерева навыков (как у меча и стрелы).
    const sb = skillBonuses(this.skillRanks);
    const crit = sb.critChance > 0 && Math.random() < sb.critChance;
    let dmg = fireballDamage(this.player.level);
    if (crit) dmg = Math.round(dmg * (BASE_CRIT_MUL + sb.critMul));

    this.fireballs.push(new Fireball(this, ox, oy, angle, dmg, crit));
  }

  /** Полоску каста создаём при первом касте и показываем над героем. */
  private showCastBar(): void {
    const x = this.player.sprite.x;
    const y = this.player.sprite.y - 28;
    if (!this.castBarBg) {
      this.castBarBg = this.add.rectangle(x, y, 24, 4, 0x000000).setOrigin(0.5);
      this.castBar = this.add.rectangle(x - 11, y, 0, 2, 0xffa030).setOrigin(0, 0.5);
    }
    this.updateCastBar(0);
    this.castBarBg.setVisible(true);
    this.castBar!.setVisible(true);
  }

  /** Полоска каста идёт за героем и заполняется по мере чтения заклинания. */
  private updateCastBar(frac: number): void {
    if (!this.castBarBg || !this.castBar) return;
    const x = this.player.sprite.x;
    const y = this.player.sprite.y - 28;
    const depth = this.player.sprite.depth + 0.05;
    this.castBarBg.setPosition(x, y).setDepth(depth);
    this.castBar.setPosition(x - 11, y).setDepth(depth + 0.01);
    this.castBar.width = 22 * Math.max(0, Math.min(1, frac));
  }

  /** Двигаем огненные шары и проверяем попадания — как стрелы, но на попадании взрыв. */
  private updateFireballs(delta: number): void {
    const tw = this.doc.map.tileWidth;
    const th = this.doc.map.tileHeight;

    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.update(delta);
      const ax = f.sprite.x;
      const ay = f.sprite.y;

      const hit = this.monsters.find(
        (m) => !m.isDead && Math.abs(m.sprite.x - ax) < 12 && ay > m.sprite.y - 24 && ay < m.sprite.y + 5,
      );
      if (hit) {
        this.hitMonster(hit, f.damage, false, f.crit);
        this.fireBurst(ax, ay);
        this.cameras.main.shake(90, 0.004);
        f.destroy();
        this.fireballs.splice(i, 1);
        continue;
      }

      const tx = Math.floor(ax / tw);
      const ty = Math.floor((ay + CHEST_OFFSET) / th); // проекция на землю, как у стрелы
      const outside = tx < 0 || ty < 0 || tx >= this.doc.width || ty >= this.doc.height;
      const intoWall = f.traveled > 6 && !outside && !this.doc.canWalk(tx, ty);
      if (f.traveled > FIREBALL_RANGE || outside || intoWall) {
        if (intoWall) this.fireBurst(ax, ay); // о стену — вспышка; на излёте просто гаснет
        f.destroy();
        this.fireballs.splice(i, 1);
      }
    }
  }

  // --- Умение «Град стрел» (слот 2): прицельный AoE ---

  /**
   * Начать прицеливание града стрел (клавиша «2» или клик по слоту). Не бьём сразу:
   * включаем режим прицела — круг у курсора ждёт, куда игрок кликнет. Повторная «2»
   * прицеливание отменяет. Ману и перезарядку тратим только на подтверждении залпа.
   */
  private castArrowRain(): void {
    if (this.player.isDead) return;
    if (this.rainAiming) { this.cancelRainAim(); return; } // «2» второй раз — отмена
    if (this.time.now < this.rainReadyAt) { this.hotbar.flash(RAIN_SLOT); return; } // перезарядка
    if (this.player.mp < RAIN_MP_COST) {
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#5ba3e0', 'not enough mana');
      return;
    }
    this.rainAiming = true;
    this.hotbar.flash(RAIN_SLOT);
    if (!this.rainReticle) {
      this.rainReticle = this.add.circle(0, 0, RAIN_RADIUS, 0x8ad46a, 0.15)
        .setStrokeStyle(2, 0x8ad46a, 0.9).setDepth(305);
    }
    this.rainReticle.setVisible(true);
    this.updateRainAim();
  }

  /** Точка не дальше RAIN_RANGE от героя: курсор клампим к дальности умения. */
  private clampToRange(wx: number, wy: number): { x: number; y: number } {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    let dx = wx - px;
    let dy = wy - py;
    const d = Math.hypot(dx, dy);
    if (d > RAIN_RANGE) { dx = (dx / d) * RAIN_RANGE; dy = (dy / d) * RAIN_RANGE; }
    return { x: px + dx, y: py + dy };
  }

  /** Пока целятся — круг идёт за курсором (в пределах дальности). Смерть — отмена. */
  private updateRainAim(): void {
    if (!this.rainAiming || !this.rainReticle) return;
    if (this.player.isDead) { this.cancelRainAim(); return; }
    const p = this.input.activePointer;
    const t = this.clampToRange(p.worldX, p.worldY);
    this.rainReticle.setPosition(t.x, t.y);
  }

  /** Отменить прицеливание (ПКМ / Esc / смерть / повторная «2») — без траты маны. */
  private cancelRainAim(): void {
    this.rainAiming = false;
    this.rainReticle?.setVisible(false);
  }

  /** Подтвердить залп по точке клика: тратим ману, ставим перезарядку, сыплем стрелы. */
  private confirmArrowRain(p: Phaser.Input.Pointer): void {
    if (!this.rainAiming) return;
    // Мана могла уйти на другой каст, пока целились, — проверяем ещё раз.
    if (this.player.mp < RAIN_MP_COST) {
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#5ba3e0', 'not enough mana');
      this.cancelRainAim();
      return;
    }
    const t = this.clampToRange(p.worldX, p.worldY);
    this.player.mp -= RAIN_MP_COST;
    this.rainReadyAt = this.time.now + RAIN_COOLDOWN;
    this.player.faceToward(t.x, t.y);
    this.cancelRainAim();
    this.spawnArrowRain(t.x, t.y);
  }

  /** Залп: волны урона (updateRains) + падающие с неба стрелы (визуал твинами). */
  private spawnArrowRain(cx: number, cy: number): void {
    // Первая волна урона — через долю длительности, дальше по updateRains.
    this.rains.push({ cx, cy, nextTick: this.time.now + RAIN_DURATION / RAIN_TICKS, ticksLeft: RAIN_TICKS });

    ensureRainArrowTexture(this);
    const half = Math.round(RAIN_RADIUS / 2);
    for (let i = 0; i < RAIN_ARROWS; i++) {
      const ax = cx + Phaser.Math.Between(-RAIN_RADIUS, RAIN_RADIUS);
      const landY = cy + Phaser.Math.Between(-half, half);
      const arrow = this.add.image(ax, landY - 220, RAIN_TEX).setDepth(330);
      this.tweens.add({
        targets: arrow, y: landY, duration: 300,
        delay: Phaser.Math.Between(0, RAIN_DURATION - 300), ease: 'Quad.easeIn',
        onComplete: () => arrow.destroy(),
      });
    }
  }

  /** Волны урона активных залпов: раз в RAIN_DURATION/RAIN_TICKS бьём всех в круге. */
  private updateRains(now: number): void {
    const r2 = RAIN_RADIUS * RAIN_RADIUS;
    const sb = skillBonuses(this.skillRanks);
    for (let i = this.rains.length - 1; i >= 0; i--) {
      const rain = this.rains[i];
      if (now < rain.nextTick) continue;
      for (const m of this.monsters) {
        if (m.isDead) continue;
        const dx = m.sprite.x - rain.cx;
        const dy = m.sprite.y - rain.cy;
        if (dx * dx + dy * dy > r2) continue;
        const crit = sb.critChance > 0 && Math.random() < sb.critChance;
        let dmg = arrowRainDamage(this.player.level);
        if (crit) dmg = Math.round(dmg * (BASE_CRIT_MUL + sb.critMul));
        this.hitMonster(m, dmg, false, crit);
      }
      rain.ticksLeft -= 1;
      rain.nextTick += RAIN_DURATION / RAIN_TICKS;
      if (rain.ticksLeft <= 0) this.rains.splice(i, 1);
    }
  }

  // --- Умение «Барьер» (слот 3): щит на себя ---

  /**
   * Повесить барьер (клавиша «3» или клик по слоту). Ни прицела, ни снаряда:
   * мгновенно на себя. На BARRIER_DURATION входящий урон режется на 80% —
   * считает это player.takeDamage через playerDamageTaken.
   */
  private castBarrier(): void {
    if (this.player.isDead) return;

    const now = this.time.now;
    if (now < this.barrierReadyAt) {
      this.hotbar.flash(BARRIER_SLOT); // идёт перезарядка
      return;
    }
    if (this.player.mp < BARRIER_MP_COST) {
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#5ba3e0', 'not enough mana');
      return;
    }

    this.player.mp -= BARRIER_MP_COST;
    this.barrierReadyAt = now + BARRIER_COOLDOWN;
    this.player.shieldFor(now);
    this.hotbar.flash(BARRIER_SLOT);

    // Подпись над головой: сколько режет — иначе не видно, что умение сработало.
    this.damageNumber(
      this.player.sprite.x, this.player.sprite.y - 44, 0, '#9fd8ff',
      `barrier −${Math.round(BARRIER_REDUCTION * 100)}%`,
    );

    if (!this.shieldBubble) {
      this.shieldBubble = this.add.circle(0, 0, 16, 0x6fb2ff, 0.18)
        .setStrokeStyle(2, 0x9fd8ff, 0.9);
    }
    this.shieldBubble.setVisible(true);
  }

  /** Пузырь щита идёт за героем и к концу срока тает. Кончился барьер — гасим. */
  private updateBarrier(now: number): void {
    if (!this.shieldBubble || !this.shieldBubble.visible) return;

    if (!this.player.isShielded(now) || this.player.isDead) {
      this.shieldBubble.setVisible(false);
      return;
    }
    const p = this.player.sprite;
    this.shieldBubble.setPosition(p.x, p.y - 10);
    this.shieldBubble.setDepth(p.depth + 0.02); // прямо над героем, вместе с ним за крону
    // Последние 800 мс — плавно гаснет, чтобы конец щита не был неожиданным.
    const left = this.player.shieldLeft(now);
    this.shieldBubble.setAlpha(left < 800 ? left / 800 : 1);
  }

  /** Вспышка-взрыв в точке попадания огненного шара: яркое кольцо и ядро, гаснут. */
  private fireBurst(x: number, y: number): void {
    const ring = this.add.graphics({ x, y });
    ring.fillStyle(0xffb02e, 0.9).fillCircle(0, 0, 5);
    ring.setBlendMode(Phaser.BlendModes.ADD).setDepth(330);
    this.tweens.add({
      targets: ring, scaleX: 3, scaleY: 3, alpha: 0, duration: 220, ease: 'Cubic.Out',
      onComplete: () => ring.destroy(),
    });

    const core = this.add.graphics({ x, y });
    core.fillStyle(0xfff2a8, 1).fillCircle(0, 0, 3);
    core.setBlendMode(Phaser.BlendModes.ADD).setDepth(330.01);
    this.tweens.add({
      targets: core, scaleX: 2, scaleY: 2, alpha: 0, duration: 160, ease: 'Quad.Out',
      onComplete: () => core.destroy(),
    });
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
        this.damageNumber(px, py - 44, 0, '#d8c07a', `${name} ×${taken}, ${left} more — bag full`);
        continue;
      }

      this.loot.splice(i, 1);
      l.flyTo(px, py, () => {
        this.damageNumber(px, py - 44, 0, '#d8c07a', `${name}${taken > 1 ? ` ×${taken}` : ''}`);
      });
      // В чат — только заметную добычу (необычное и выше), иначе лента утонет
      // в грибах: обычные подборы и так видно всплывающей цифрой.
      if (rarityOf(l.id) !== 'common') {
        this.chat.system(`Loot: ${name}${taken > 1 ? ` ×${taken}` : ''}.`);
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
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', 'not needed');
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
      weaponSharpen: this.weaponSharpen,
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
    for (let i = 0; i < SKILL_SLOTS; i++) this.quick[i] = null; // слоты умений не предметные (в т.ч. из старых сейвов, где слот 1 был предметным)
    this.spent = prog.spent;
    this.gold = prog.gold;
    // Заточка и навыки — ДО applyGear: тот считает урон, здоровье, крит уже с ними.
    this.weaponSharpen = prog.weaponSharpen;
    this.skillRanks = prog.skills;
    if (prog.charName) this.charName = prog.charName;

    this.player.setPoints(bonusFrom(this.spent));
    this.applyGear(); // прибавки вещей — до restore, чтобы hpMax был верным
    this.player.restore(prog.level, prog.xp, prog.hp, prog.mp);

    this.refreshBags();
  }

  /** Клавиши 1-9 и 0 — планка быстрого доступа. «1» — умение, дальше — предметы. */
  private bindQuickKeys(): void {
    // Слоты умений: «1» — огненный шар, «2» — град стрел, «3» — барьер.
    this.input.keyboard?.on('keydown-ONE', () => this.castFireball());
    this.input.keyboard?.on('keydown-TWO', () => this.castArrowRain());
    this.input.keyboard?.on('keydown-THREE', () => this.castBarrier());
    // Клавиши 4..9 — предметные слоты 3..8 (слоты 0..2 заняты умениями).
    const keys = ['FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
    keys.forEach((k, i) => this.input.keyboard?.on(`keydown-${k}`, () => this.useQuick(i + 3)));
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
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', `${ITEMS[id].name} — not in bag`);
      return;
    }

    this.hotbar.flash(slot);
    if (ITEMS[id].slot) this.equipItem(index);
    else this.useItem(index);
  }

  /** Надеть вещь из ячейки сумки. */
  private equipItem(index: number): void {
    const stack = this.bag[index];
    const isWeapon = !!stack && Object.hasOwn(ITEMS, stack.id) && ITEMS[stack.id].slot === 'weapon';
    // Заточка едет С оружием. Снимаем снимок ДО обмена: equipFromBag перезапишет ячейку.
    const incomingSharpen = stack?.sharpen ?? 0;
    const prevWeaponSharpen = this.weaponSharpen;

    const res = equipFromBag(this.bag, index, this.equipped);
    if (!res.ok) return;

    if (isWeapon) {
      // Надетым становится взятый меч — с его заточкой; снятый лёг на его место
      // в сумке (bag[index]) и уносит СВОЮ прежнюю заточку.
      this.weaponSharpen = incomingSharpen;
      const swapped = this.bag[index];
      if (swapped && prevWeaponSharpen > 0) swapped.sharpen = prevWeaponSharpen;
    }

    this.applyGear();
    this.refreshBags();
  }

  /** Снять надетое обратно в сумку. */
  private unequipItem(slot: EquipSlot): void {
    const isWeapon = slot === 'weapon';
    // Снимаемое оружие уносит заточку в сумку — той же ячейкой, что заводит addToBag.
    const res = unequip(this.equipped, slot, (id) =>
      addToBag(this.bag, id, 1, isWeapon ? this.weaponSharpen : undefined) === 0);
    if (!res.ok) {
      // Сумка полна: вещь осталась надетой, и игрок должен понять почему.
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', 'bag full');
      return;
    }

    if (isWeapon) this.weaponSharpen = 0; // рука пуста — заточки надетого больше нет

    this.applyGear();
    this.refreshBags();
  }

  /**
   * «Представительная» заточка для ВИДА оружия — нужна планке быстрого доступа,
   * где ячейка помнит вид, а не экземпляр. Надето — заточка надетого; иначе —
   * первого такого меча в сумке (тот, что планка и наденет).
   */
  private weaponPlusFor(id: string): number {
    if (this.equipped.weapon === id) return this.weaponSharpen;
    return this.bag.find((s) => s?.id === id)?.sharpen ?? 0;
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
    bonus.dmg += this.weaponSharpen; // заточка НАДЕТОГО оружия: +1 урона за уровень

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

    // Оружие в руке: показываем спрайт ИМЕННО надетого меча/лука (items.held).
    const weapon = this.equipped.weapon;
    this.player.setHeldWeapon(weapon && ITEMS[weapon]?.held ? `held-${weapon}` : null);

    // Броня на модельке: нагрудник перекрашивает тунику, шлем — волосы (items.tint).
    const tintOf = (id: string | undefined): ArmorTint | null =>
      (id && ITEMS[id]?.tint) || null;
    Player.retintArmor(this, tintOf(this.equipped.body), tintOf(this.equipped.helm));
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
   * здесь только резолвим КОНКРЕТНЫЙ экземпляр по адресу из окна, применяем итог
   * (свиток сгорел — сумка изменилась; при успехе поднимаем заточку этого меча) и
   * честно показываем оба исхода.
   *
   * Адрес приходит из окна (DOM — ему верить нельзя): key + id. Сверяем, что в
   * ячейке всё ещё то самое оружие, иначе за это время его могли снять/потратить.
   */
  private sharpenWeapon(key: string, id: string): void {
    let currentPlus: number;
    let bagIndex = -1;

    if (key === 'equipped') {
      if (this.equipped.weapon !== id) {
        this.forge.flash('that weapon is no longer equipped', false);
        return;
      }
      currentPlus = this.weaponSharpen;
    } else if (key.startsWith('bag:')) {
      bagIndex = Number(key.slice(4));
      const stack = this.bag[bagIndex];
      if (!stack || stack.id !== id) {
        this.forge.flash('you no longer have that weapon', false);
        return;
      }
      currentPlus = stack.sharpen ?? 0;
    } else {
      this.forge.flash('you no longer have that weapon', false);
      return;
    }

    const res = trySharpen(currentPlus, id, this.bag);
    if (!res.ok) {
      this.forge.flash(res.reason, false);
      return;
    }

    if (res.success) {
      // Заточку поднимаем ИМЕННО у этого экземпляра.
      if (key === 'equipped') this.weaponSharpen = res.level;
      else {
        const st = this.bag[bagIndex];
        if (st) st.sharpen = res.level;
      }
      // Урон надетого пересчитываем всегда (для сумки безвредно).
      this.applyGear();
      this.forge.flash(`Success! ${ITEMS[id].name} is now +${res.level}`);
      this.chat.system(`Sharpening succeeded: ${ITEMS[id].name} is now +${res.level}!`);
    } else {
      this.forge.flash(`Failed at +${res.target} — scroll burned, +${res.level} sharpen intact`, false);
      this.chat.system(`Sharpening to +${res.target} failed — scroll burned, +${res.level} sharpen intact.`);
    }

    this.refreshBags(); // свиток съеден: сумка, панель и автосейв
    this.forge.render();
  }

  /**
   * Магазин и кузница не живут одновременно: оба — центральные окна, и кузница
   * (выше по z) накрывала магазин. Кнопка кузницы зовёт «купи в магазине (O)» —
   * нажал O, и магазин обязан оказаться СВЕРХУ, а не под кузницей (нашла
   * состязательная проверка). Открываешь одно — второе закрывается.
   */
  private toggleShop(): void {
    if (!this.shop.isOpen) { this.forge.close(); this.market.close(); }
    this.shop.toggle();
  }

  private toggleForge(): void {
    if (!this.forge.isOpen) { this.shop.close(); this.market.close(); }
    this.forge.toggle();
  }

  /** Открыть/закрыть рынок (T). Центральные окна не живут вместе. При открытии — забрать почту и обновить данные. */
  private toggleMarket(): void {
    if (!this.market.isOpen) {
      this.shop.close();
      this.forge.close();
      this.mkNotice = undefined; // не тащим старое сообщение в свежеоткрытое окно
      this.market.open();
      void this.marketRefreshAll();
    } else {
      this.market.close();
    }
  }

  /** Спросить витрину под фильтром (окно сменило категорию/поиск/сортировку/страницу). */
  private async marketQuery(filter: BrowseFilter): Promise<void> {
    this.mkFilter = filter;
    this.mkLoading = true;
    this.market.render();
    const r = await marketBrowse(filter);
    this.mkUnavailable = !!r.unavailable;
    this.mkBrowse = r.result ?? null;
    this.mkLoading = false;
    this.market.render();
  }

  /** Обновить данные активной вкладки (смена вкладки / «↻»): чужие могли купить твой лот. */
  private async marketOnRefresh(tab: 'market' | 'mine' | 'history'): Promise<void> {
    if (tab === 'market') return; // витрину обновляет marketQuery от «↻»
    await this.marketRefreshAll();
  }

  /** При открытии/обновлении: забрать почту (выручку/возвраты) и подтянуть мои лоты и историю. */
  private async marketRefreshAll(): Promise<void> {
    await this.collectMarketMail();
    const [mine, hist] = await Promise.all([marketMine(), marketHistory()]);
    this.mkUnavailable = !!mine.unavailable;
    this.mkMine = mine.lots;
    this.mkHistory = hist.history;
    this.market.render();
  }

  /**
   * Купить лот. Золото РЕЗЕРВИРУЕМ до запроса (иначе две быстрые покупки увели бы
   * его в минус), при отказе возвращаем. Предмет приходит покупателю ПОЧТОЙ —
   * забираем через collectMarketMail (он же следит за местом в сумке). Блокируемся
   * флагом mkBusy, чтобы второе действие не началось поверх этого.
   */
  private async marketBuyLot(lotId: string): Promise<void> {
    if (this.mkBusy) return;
    const lot = this.mkBrowse?.lots.find((l) => l.id === lotId);
    if (!lot) return;
    if (this.gold < lot.price) return this.marketFlash('Not enough gold', false);

    this.mkBusy = true;
    this.gold -= lot.price; // резерв: следующая покупка сразу увидит уменьшённое золото
    this.market.render();
    try {
      const r = await marketBuy(lotId);
      if (r.ok) {
        await this.collectMarketMail(); // купленный предмет ждёт на почте — заберём (с учётом места)
        this.mkNotice = { text: `Bought: ${ITEMS[lot.item.id]?.name ?? lot.item.id}`, ok: true };
      } else {
        this.gold += lot.price; // не купили — вернуть резерв
        this.mkNotice = { text: r.error ?? 'Purchase failed', ok: false };
      }
      await this.marketQuery(this.mkFilter); // лот ушёл — обновляем витрину
    } finally {
      this.mkBusy = false;
      this.refreshBags();
      this.market.render();
    }
  }

  /** Выставить лот: предмет резервируем из сумки сразу, при неудаче возвращаем. */
  private async marketListItem(item: TradeItem, price: number): Promise<void> {
    if (this.mkBusy) return;
    const idx = this.bag.findIndex(
      (s) => s && s.id === item.id && (s.sharpen ?? 0) === (item.sharpen ?? 0) && s.qty >= item.qty,
    );
    if (idx < 0) return this.marketFlash('That item is not in your bag', false);

    const sharpen = this.bag[idx]!.sharpen;
    this.mkBusy = true;
    this.takeFromBag(idx, item.qty);
    this.refreshBags();
    this.market.render();
    try {
      const r = await marketList(item, price);
      if (r.ok) {
        // Подсказываем вкладку: своих лотов в «Market» не видно, и без этого кажется,
        // что предмет пропал.
        this.mkNotice = { text: `Listed: ${ITEMS[item.id]?.name ?? item.id} — see "My Listings"`, ok: true };
        const mine = await marketMine();
        this.mkMine = mine.lots;
      } else {
        addToBag(this.bag, item.id, item.qty, sharpen); // сервер не принял — вернём предмет
        this.mkNotice = { text: r.error ?? 'Listing failed', ok: false };
      }
    } finally {
      this.mkBusy = false;
      this.refreshBags();
      this.market.render();
    }
  }

  /** Снять свой лот: предмет вернётся по почте, тут же её и заберём. */
  private async marketCancelLot(lotId: string): Promise<void> {
    if (this.mkBusy) return;
    this.mkBusy = true;
    this.market.render();
    try {
      const r = await marketCancel(lotId);
      if (r.ok) {
        await this.collectMarketMail();
        const mine = await marketMine();
        this.mkMine = mine.lots;
        this.mkNotice = { text: 'Listing cancelled, item collected from mail', ok: true };
      } else {
        // Лота уже нет (например, его купили) — обновим «Мои лоты», чтобы призрак исчез.
        const mine = await marketMine();
        this.mkMine = mine.lots;
        this.mkNotice = { text: r.error ?? 'Failed to cancel listing', ok: false };
      }
    } finally {
      this.mkBusy = false;
      this.refreshBags();
      this.market.render();
    }
  }

  /**
   * Забрать почту рынка: золото зачисляем всегда, предметы — если влезли в сумку.
   * Принятое подтверждаем (ack), не влезшее остаётся ждать — так вещь не теряется.
   *
   * Защита от повторного входа: пока идёт сбор, повторный вызов ждёт тот же запуск,
   * иначе два наложенных сбора успели бы забрать одну и ту же почту дважды.
   */
  private collectMarketMail(): Promise<void> {
    if (this.mkMailRun) return this.mkMailRun;
    this.mkMailRun = this.doCollectMail().finally(() => { this.mkMailRun = undefined; });
    return this.mkMailRun;
  }

  private async doCollectMail(): Promise<void> {
    const r = await marketMail();
    this.mkUnavailable = !!r.unavailable;
    if (!r.ok || !r.mail.length) return;

    const accepted: string[] = [];
    const parts: string[] = [];
    for (const e of r.mail) {
      if (e.kind === 'gold') {
        this.gold += e.amount;
        accepted.push(e.id);
        parts.push(`+${e.amount} g`);
      } else if (roomFor(this.bag, e.item.id) >= e.item.qty) {
        addToBag(this.bag, e.item.id, e.item.qty, e.item.sharpen);
        accepted.push(e.id);
        parts.push(`${ITEMS[e.item.id]?.name ?? e.item.id}${e.item.qty > 1 ? ` ×${e.item.qty}` : ''}`);
      }
      // предмет не влез — оставляем на почте (не подтверждаем)
    }
    if (accepted.length) {
      await marketMailAck(accepted);
      this.refreshBags();
      this.mkNotice = { text: `From mail: ${parts.join(', ')}`, ok: true };
    }
  }

  private marketFlash(text: string, ok: boolean): void {
    this.mkNotice = { text, ok };
    this.market.render();
  }

  /** Убрать qty из ячейки сумки (для выставления лота). Оружие — stack:1 → ячейка пустеет. */
  private takeFromBag(index: number, qty: number): void {
    const s = this.bag[index];
    if (!s) return;
    s.qty -= qty;
    if (s.qty <= 0) this.bag[index] = null;
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
    this.shop.flash(`Bought: ${ITEMS[id].name} (−${res.price})`);
    this.chat.system(`Purchase: ${ITEMS[id].name} for ${res.price} gold.`);
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
      this.shop.flash('Nothing to sell', false);
      return;
    }

    this.refreshBags();
    this.shop.render();
    this.shop.flash(`Sold ×${count} for +${total}`);
    this.chat.system(`Sale: ${count} items for ${total} gold.`);
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
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 44, 0, '#b0a08a', 'no points');
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
      this.damageNumber(this.player.sprite.x, this.player.sprite.y - 40, 0, '#8ad46a', `LEVEL ${this.player.level}`);
      // Про очки говорим отдельно: молча начисленное игрок не заметит и не
      // вложит, а окно персонажа само не откроется.
      this.damageNumber(
        this.player.sprite.x, this.player.sprite.y - 56, 0, '#e0c48a',
        `+${POINTS_PER_LEVEL} points (U)`,
      );
      this.chat.system(`New level: ${this.player.level}! +${POINTS_PER_LEVEL} attribute points (U).`);
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
        // Урон снимаем ТОЛЬКО при попадании (иначе промах бил бы героя). takeDamage
        // возвращает, сколько реально прошло (броня и барьер уже учтены), — его и
        // показываем: под щитом число должно быть заметно меньше.
        const taken = hit ? this.player.takeDamage(m.stats.dmg, now) : 0;
        if (taken > 0) {
          this.damageNumber(p.x, p.y - 40, taken, '#ff6b5c');
          this.cameras.main.shake(120, 0.005);
        }
      }

      if (m.shouldRespawn(now)) m.reset();
    }

    this.updateArrows(delta);
    this.updateCast(now); // сначала докрутить каст: он может выпустить шар в этот кадр
    this.updateFireballs(delta);
    this.updateRainAim();  // круг прицела идёт за курсором, пока целятся
    this.updateRains(now); // волны урона активных залпов града стрел
    this.updateBarrier(now); // пузырь щита за героем, пока держится барьер
    // Перезарядка умений на планке: 1 — только откастовал, 0 — готов.
    this.hotbar.setSkillCooldown(SKILL_SLOT, this.fireballReadyAt > now ? (this.fireballReadyAt - now) / FIREBALL_COOLDOWN : 0);
    this.hotbar.setSkillCooldown(RAIN_SLOT, this.rainReadyAt > now ? (this.rainReadyAt - now) / RAIN_COOLDOWN : 0);
    this.hotbar.setSkillCooldown(BARRIER_SLOT, this.barrierReadyAt > now ? (this.barrierReadyAt - now) / BARRIER_COOLDOWN : 0);
    this.updateLoot(now);

    if (this.player.isDead && !this.deathAt) {
      this.deathAt = now;
      this.hud.showDeath(true);
      this.chat.system('You fell in battle. Some XP lost — respawning soon.');
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
