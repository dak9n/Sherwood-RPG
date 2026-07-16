import { ITEMS, RARITY_NAME, rarityOf, type Icon, type Rarity, type Stack, type Tab } from './items';
import { SLOTS, LEFT_SLOTS, RIGHT_SLOTS, totalBonuses, type Equipped } from './equipment';
import { canBind } from './hotbar';
import { STATS, POINTS_PER_LEVEL, type Stat } from './stats';
import { DND } from './dnd';
import { HERO } from './creatures';

/**
 * Окно инвентаря. Открывается на I.
 *
 * Рисуется DOM-ом поверх канваса, а не внутри сцены: камера игры увеличена
 * втрое, и всё, нарисованное в сцене, раздулось бы вместе с ней.
 *
 * Вся рама — настоящая графика набора, а не похожие прямоугольники на CSS.
 * Куски вырезаны из листов скриптом tools/cut-ui.mjs в assets/interface/ui/ и
 * тянутся девятислайсом (border-image). Отдельные файлы нужны потому, что
 * border-image умеет растягивать только целую картинку — кусок общего листа он
 * не берёт.
 *
 * Плоскими цветами остались ровно те места, которые плоские и в наборе: ячейка
 * на бежевой странице — сплошной #CDA677 (проверено: 196 из 196 пикселей), а на
 * тёмной — белая полупрозрачная накладка.
 */

/** Цвета взяты с листов набора пипеткой, а не подобраны на глаз. */
const C = {
  ink: '#f0e0c8',
  inkDark: '#2b1d12',
  page: '#e5d6a1',
  slotBeige: '#cda677',
  /** Ячейка на тёмной странице: в наборе это белая накладка с альфой 26/255. */
  slotDark: 'rgba(255, 255, 255, 0.102)',
  gold: '#e0c48a',
  good: '#8ad46a',
  bad: '#e08a6a',
  /** Трава нашей карты. Тот самый тайл, которым нарисована вся суша леса. */
  grass: '#7aad55',
} as const;

/**
 * Рамки редкости. Цвет обязан отражать, как трудно вещь достать (см. items.ts).
 * Тона тёмные не случайно: рамка лежит на песочной ячейке #cda677, и светло
 * зелёный на ней просто терялся.
 */
const RARITY_COLOR: Record<Rarity, string> = {
  common: '#6b4f3a',
  uncommon: '#2f7a35',
  rare: '#2b5ea8',
  epic: '#7b3ca8',
};

const UI = 'assets/interface/ui';

const SHEETS: Record<Icon['sheet'], string> = {
  icons: 'assets/interface/PNG/Icons.png',
  Objects: 'assets/tilesets/Objects.png',
};

/** Кадр героя для портрета: мечник анфас, поза покоя. */
const PORTRAIT = {
  sheet: 'assets/characters/PNG/Swordsman_lvl1/With_shadow/Swordsman_lvl1_Idle_with_shadow.png',
  // Плотный bbox внутри кадра 64x64 — вокруг него в кадре одна пустота.
  x: 19, y: 20, w: 20, h: 27,
  // Только целое кратное: на дробном пиксели мечника поехали бы.
  zoom: 8,
} as const;

const COLS = 7;
const ROWS = 5;
/** Во сколько раз увеличены рамки набора. Только целое: дробное размажет пиксели. */
const SCALE = 3;
/**
 * Ячейки крупнее рам: 14px из набора — это мелко и для мыши, и для глаза. Заодно
 * ширина сетки сходится с полосой вкладок, и на странице не остаётся пустоты.
 */
const SLOT_SCALE = 4;
const SLOT = 14 * SLOT_SCALE;
const GAP = 2 * SLOT_SCALE;
/** Вкладки с рамкой в полный масштаб не влезали в ширину сетки. */
const TAB_SCALE = 2;

/** Клетка листа иконок. Ряды 11-16 не трогаем: там сетка 32x32 (см. items.ts). */
const ico = (col: number, row: number): Icon => ({ sheet: 'icons', x: col * 16, y: row * 16, w: 16, h: 16 });

const TABS: { id: Tab | 'all'; label: string; icon: Icon }[] = [
  { id: 'all', label: 'Все', icon: ico(3, 7) },
  { id: 'weapon', label: 'Оружие', icon: ico(0, 8) },
  { id: 'armor', label: 'Броня', icon: ico(5, 6) },
  { id: 'resource', label: 'Ресурсы', icon: ico(5, 15) },
  { id: 'food', label: 'Еда', icon: ico(5, 5) },
];

/**
 * Иконки характеристик берём из монохромного набора (ряды 0-5) — он коричнево
 * золотой и лежит на бежевой панели как родной. Цветные иконки предметов рядом
 * с ним смотрелись бы чужими.
 */
const STAT_ICON = {
  hp: ico(5, 0),      // сердце
  mp: ico(4, 1),      // самоцвет
  dmg: ico(1, 0),     // скрещённые мечи
  def: ico(0, 3),     // щит
  speed: ico(5, 4),   // стрелка вправо
  regen: ico(2, 4),   // стрелка вверх
} as const;

/** Подсказка пустого слота: та же иконка предмета, только погашенная. */
const SLOT_GHOST: Record<string, Icon> = {
  helm: ico(4, 6),
  amulet: ico(0, 9),
  body: ico(5, 6),
  ring: ico(5, 8),
  weapon: ico(0, 8),
  shield: ico(1, 8),
  boots: ico(2, 8),
};

const CSS = `
  #inv {
    position: absolute; inset: 0; z-index: 20; display: none;
    align-items: center; justify-content: center;
    font: 12px/1 system-ui, sans-serif; color: ${C.ink};
    /* Растянут на весь экран, но кликов не ловит: игра не на паузе, и мимо окна
       удар должен доходить до пауков. Ловит только само окно — см. .win. */
    pointer-events: none;
    -webkit-font-smoothing: none;
  }
  #inv.open { display: flex; }
  #inv i { image-rendering: pixelated; display: block; }

  /* Окно целиком — кусок набора: зелёная шапка и коричневое тело одной рамой. */
  #inv .win {
    pointer-events: auto;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px repeat;
    border-width: ${16 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px;
    border-style: solid;
    image-rendering: pixelated;
    position: relative;
    filter: drop-shadow(0 10px 24px rgba(0, 0, 0, .55));
  }
  /* Заголовок ложится поверх шапки, которая уже нарисована в рамке окна. */
  #inv .title {
    position: absolute; top: -${13 * SCALE}px; left: 0; right: 0;
    text-align: center; font-weight: 700; font-size: 14px;
    letter-spacing: .1em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #inv .close {
    position: absolute; top: -${13 * SCALE}px; right: 0;
    width: ${9 * SCALE}px; height: ${9 * SCALE}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
    image-rendering: pixelated;
  }
  #inv .close:hover { filter: brightness(1.25); }
  #inv .close:active { transform: translateY(1px); }

  /* stretch: обе колонки одной высоты, иначе под сумкой зияла бы пустая рама. */
  #inv .body { display: flex; gap: ${4 * SCALE}px; align-items: stretch; }

  /* --- Панель персонажа (левая страница) --- */
  #inv .hero {
    display: flex; flex-direction: column; gap: ${3 * SCALE}px;
    border-image: url(${UI}/panel_dark.png) 2 3 4 3 fill / ${2 * SCALE}px ${3 * SCALE}px ${4 * SCALE}px ${3 * SCALE}px repeat;
    border-width: ${2 * SCALE}px ${3 * SCALE}px ${4 * SCALE}px ${3 * SCALE}px;
    border-style: solid; image-rendering: pixelated;
    padding: ${2 * SCALE}px;
  }
  #inv .who { text-align: center; }
  #inv .who b { font-size: 14px; color: ${C.gold}; text-shadow: 1px 1px 0 #3e1f1d; }
  #inv .who span { display: block; margin-top: 3px; font-size: 11px; color: ${C.ink}; }
  #inv .xpbar {
    position: relative; height: ${3 * SCALE}px; margin-top: 4px;
    background: #3e1f1d; border: 1px solid #241010; border-radius: 1px; overflow: hidden;
  }
  #inv .xpbar i { height: 100%; background: linear-gradient(#e0c48a, #a07f2d); transition: width .2s; }
  #inv .xpnum {
    text-align: center; font-size: 10px; margin-top: 3px; color: #d8c0a0;
    font-variant-numeric: tabular-nums;
  }

  /* Слоты — портрет — слоты, как на образце. */
  #inv .doll { display: flex; gap: ${2 * SCALE}px; justify-content: center; }
  #inv .col { display: flex; flex-direction: column; gap: ${2 * SCALE}px; }
  #inv .portrait {
    flex: 1; position: relative; background: ${C.grass};
    border: ${SCALE}px solid #3e1f1d; box-shadow: inset 0 0 0 ${SCALE}px #70492a;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  /* Мечник из игрового листа, увеличенный целым кратным — иначе поедут пиксели. */
  #inv .portrait i {
    width: ${PORTRAIT.w}px; height: ${PORTRAIT.h}px;
    background: url(${PORTRAIT.sheet}) -${PORTRAIT.x}px -${PORTRAIT.y}px;
    transform: scale(${PORTRAIT.zoom});
  }

  #inv .slot {
    width: ${SLOT}px; height: ${SLOT}px; position: relative; cursor: default;
    background: ${C.slotDark};
  }
  #inv .slot.has { cursor: pointer; }
  #inv .slot.has:hover { background: rgba(255, 255, 255, .22); }
  #inv .slot > i.item {
    position: absolute; inset: 0; margin: auto;
    width: 16px; height: 16px; transform: scale(${SLOT_SCALE - 1});
  }
  #inv .slot > i.ghost { opacity: .3; filter: grayscale(1); }
  /* Подпись НАД гнездом, как на образце: внутри она налезала бы на иконку. */
  #inv .eqslot { display: flex; flex-direction: column; gap: 2px; }
  #inv .eqslot > .lbl {
    font-size: 9px; color: #d8c0a0; text-shadow: 1px 1px 0 #3e1f1d;
    white-space: nowrap; text-align: center;
  }

  /* --- Характеристики: бежевая панель, монохромные иконки, тёмный текст --- */
  #inv .stats {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px repeat;
    border-width: ${2 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px;
    border-style: solid; image-rendering: pixelated;
    color: ${C.inkDark};
    display: grid; grid-template-columns: 1fr 1fr; gap: 3px ${3 * SCALE}px;
    padding: ${SCALE}px ${2 * SCALE}px;
  }
  #inv .stat { display: flex; align-items: center; gap: 5px; font-size: 11px; }
  #inv .stat i { width: 16px; height: 16px; flex: none; }
  #inv .stat span { flex: 1; }
  #inv .stat b { font-weight: 700; font-variant-numeric: tabular-nums; }
  #inv .plus { color: #2f7a2f; }
  #inv .minus { color: #a33b2e; }

  /* Очки характеристик: строка с остатком и кнопки «+» у тех характеристик,
     в которые можно вложить. Кнопки появляются только когда есть что вкладывать —
     мёртвая кнопка хуже её отсутствия. */
  #inv .pts {
    grid-column: 1 / -1; display: flex; align-items: center; gap: 6px;
    border-top: 1px solid #b0854f; margin-top: 2px; padding-top: 4px;
    font-size: 11px;
  }
  #inv .pts b { color: #2f7a2f; }
  #inv .pts.none { color: #7a6a52; }
  #inv .add {
    flex: none; width: 15px; height: 15px; line-height: 13px; text-align: center;
    cursor: pointer; font-weight: 700; font-size: 12px;
    color: #eaf6f0; background: #50a978; border: 1px solid #294040; border-radius: 2px;
  }
  #inv .add:hover { background: #68c97e; }
  #inv .add:active { transform: translateY(1px); }

  /* --- Сумка (правая страница) --- */
  #inv .bagside { display: flex; flex-direction: column; }
  #inv .tabs { display: flex; gap: ${TAB_SCALE}px; padding-left: ${2 * SCALE}px; }
  #inv .tab {
    display: flex; align-items: center; gap: 3px; cursor: pointer;
    padding: ${2 * TAB_SCALE}px ${2 * TAB_SCALE}px ${TAB_SCALE}px;
    border-image: url(${UI}/tab_off.png) 4 5 1 5 fill / ${4 * TAB_SCALE}px ${5 * TAB_SCALE}px ${TAB_SCALE}px ${5 * TAB_SCALE}px repeat;
    border-width: ${4 * TAB_SCALE}px ${5 * TAB_SCALE}px ${TAB_SCALE}px ${5 * TAB_SCALE}px;
    border-style: solid; image-rendering: pixelated;
    font-size: 11px; color: ${C.ink}; position: relative; top: ${2 * TAB_SCALE}px;
  }
  #inv .tab i { width: 16px; height: 16px; flex: none; }
  #inv .tab:hover { filter: brightness(1.12); }
  /* Выбранная вкладка поднимается и прирастает к странице — как в наборе. */
  #inv .tab[aria-selected="true"] {
    border-image-source: url(${UI}/tab_on.png);
    top: 0; padding-bottom: ${3 * TAB_SCALE}px; color: #eaf6f0;
  }

  #inv .page {
    flex: 1;
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px repeat;
    border-width: ${2 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px ${5 * SCALE}px;
    border-style: solid; image-rendering: pixelated;
    padding: ${2 * SCALE}px;
  }
  #inv .grid {
    display: grid; grid-template-columns: repeat(${COLS}, ${SLOT}px);
    gap: ${GAP}px; justify-content: center;
  }
  #inv .grid .slot { background: ${C.slotBeige}; }
  #inv .grid .slot.has:hover { filter: brightness(1.12); }
  /* Рамка редкости: обещание, что вещь чего-то стоит. */
  #inv .grid .slot.r-uncommon { box-shadow: inset 0 0 0 2px ${RARITY_COLOR.uncommon}; }
  #inv .grid .slot.r-rare { box-shadow: inset 0 0 0 2px ${RARITY_COLOR.rare}; }
  #inv .grid .slot.r-epic { box-shadow: inset 0 0 0 2px ${RARITY_COLOR.epic}; }
  #inv .qty {
    position: absolute; right: 2px; bottom: 1px;
    font-size: 11px; font-weight: 700; color: #fff;
    text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
    font-variant-numeric: tabular-nums; pointer-events: none;
  }

  #inv .foot { display: flex; align-items: center; gap: ${2 * SCALE}px; margin-top: ${2 * SCALE}px; }
  #inv .btn {
    cursor: pointer; font-size: 11px; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    padding: ${SCALE}px ${3 * SCALE}px;
    border-image: url(${UI}/button.png) 4 3 3 3 fill / ${4 * SCALE}px ${3 * SCALE}px ${3 * SCALE}px ${3 * SCALE}px repeat;
    border-width: ${4 * SCALE}px ${3 * SCALE}px ${3 * SCALE}px ${3 * SCALE}px;
    border-style: solid; image-rendering: pixelated;
  }
  #inv .btn:hover { filter: brightness(1.15); }
  #inv .btn:active { transform: translateY(1px); }
  #inv .hint { flex: 1; font-size: 11px; color: #e5d6a1; min-height: 14px; }
`;

/** Что окно должно знать о герое, чтобы показать характеристики. */
export interface HeroView {
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  level: number;
  xp: number;
  xpNext: number;
  dmgMin: number;
  dmgMax: number;
  /** Сколько очков характеристик ещё не вложено. */
  points: number;
  /** Что уже дали вложенные очки — показываем отдельно от вещей. */
  fromPoints: { dmg: number; hp: number; mp: number; def: number };
}

export class InventoryUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private grid!: HTMLDivElement;
  private hint!: HTMLDivElement;
  private stats!: HTMLDivElement;
  private lvl!: HTMLElement;
  private xpFill!: HTMLElement;
  private xpNum!: HTMLElement;
  private tab: Tab | 'all' = 'all';
  private bag: (Stack | null)[] = [];
  private equipped: Equipped = {};
  /** Спрашиваем героя, а не запоминаем: здоровье меняется каждый кадр. */
  private hero: (() => HeroView) | null = null;
  private statsKey = '';
  /** Есть ли что вкладывать: от этого зависит, рисовать ли кнопки «+». */
  private canAdd = false;

  /** Зовётся, когда игрок хочет применить предмет из ячейки. */
  onUse: (index: number) => void = () => {};
  /** Надеть предмет из ячейки сумки. */
  onEquip: (index: number) => void = () => {};
  /** Снять надетое. */
  onUnequip: (slot: string) => void = () => {};
  /** Разложить сумку. */
  onSort: () => void = () => {};
  /** Игрок вложил очко в характеристику. */
  onSpend: (stat: Stat) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'inv';
    this.root.innerHTML = `
      <div class="win">
        <div class="title">Инвентарь</div>
        <div class="close" title="Закрыть (I)"></div>
        <div class="body">
          <div class="hero">
            <div class="who">
              <b>Мечник</b>
              <span class="lvl"></span>
              <div class="xpbar"><i></i></div>
              <div class="xpnum"></div>
            </div>
            <div class="doll">
              <div class="col" data-col="left"></div>
              <div class="portrait"><i></i></div>
              <div class="col" data-col="right"></div>
            </div>
            <div class="stats"></div>
          </div>
          <div class="bagside">
            <div class="tabs"></div>
            <div class="page"><div class="grid"></div></div>
            <div class="foot">
              <div class="btn sort">Разложить</div>
              <div class="hint"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.append(this.root);

    this.grid = this.q('.grid');
    this.hint = this.q('.hint');
    this.stats = this.q('.stats');
    this.lvl = this.q('.lvl');
    this.xpFill = this.q('.xpbar i');
    this.xpNum = this.q('.xpnum');

    this.q('.close').addEventListener('click', () => this.close());
    this.q('.btn.sort').addEventListener('click', () => this.onSort());

    this.buildTabs();
    this.buildEquipSlots();
    this.buildBagSlots();
  }

  private q<T extends HTMLElement = HTMLDivElement>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`инвентарь: нет элемента ${sel}`);
    return el;
  }

  /** Кусок листа как фон: так рисуются все иконки. */
  private iconEl(icon: Icon, cls: string): HTMLElement {
    const el = document.createElement('i');
    el.className = cls;
    el.style.width = `${icon.w}px`;
    el.style.height = `${icon.h}px`;
    el.style.backgroundImage = `url(${SHEETS[icon.sheet]})`;
    el.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
    return el;
  }

  private buildTabs(): void {
    const tabs = this.q('.tabs');
    for (const t of TABS) {
      const el = document.createElement('div');
      el.className = 'tab';
      el.setAttribute('aria-selected', String(t.id === this.tab));
      el.append(this.iconEl(t.icon, 'tabico'), Object.assign(document.createElement('span'), { textContent: t.label }));
      el.onclick = () => {
        this.tab = t.id;
        for (const other of tabs.children) other.setAttribute('aria-selected', String(other === el));
        this.render();
      };
      tabs.append(el);
    }
  }

  private buildEquipSlots(): void {
    for (const side of ['left', 'right'] as const) {
      const col = this.q(`.col[data-col="${side}"]`);
      const ids = side === 'left' ? LEFT_SLOTS : RIGHT_SLOTS;
      for (const id of ids) {
        const wrap = document.createElement('div');
        wrap.className = 'eqslot';
        wrap.append(Object.assign(document.createElement('span'), {
          className: 'lbl',
          textContent: SLOTS.find((s) => s.id === id)!.label,
        }));
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.slot = id;
        wrap.append(slot);
        col.append(wrap);
      }
    }
  }

  private buildBagSlots(): void {
    for (let i = 0; i < COLS * ROWS; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.i = String(i);
      this.grid.append(slot);
    }
  }

  setBag(bag: (Stack | null)[]): void {
    this.bag = bag;
  }

  setEquipped(eq: Equipped): void {
    this.equipped = eq;
  }

  setHero(get: () => HeroView): void {
    this.hero = get;
  }

  /** Строка для подсказки: что предмет даёт. */
  private describe(id: string): string {
    const def = ITEMS[id];
    if (!def) return '';

    const parts: string[] = [];
    if (def.use?.hp) parts.push(`+${def.use.hp} здоровья`);
    if (def.use?.mp) parts.push(`+${def.use.mp} маны`);

    const b = def.bonus;
    const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));
    if (b?.dmg) parts.push(`${sign(b.dmg)} к атаке`);
    if (b?.def) parts.push(`${sign(b.def)} к защите`);
    if (b?.speed) parts.push(`${sign(b.speed)} к скорости`);
    if (b?.hp) parts.push(`${sign(b.hp)} к здоровью`);
    if (b?.mp) parts.push(`${sign(b.mp)} к мане`);

    const head = `${def.name} — ${RARITY_NAME[rarityOf(id)].toLowerCase()}`;
    return parts.length ? `${head}. ${parts.join(', ')}` : head;
  }

  private renderEquip(): void {
    for (const el of this.root.querySelectorAll<HTMLDivElement>('.col .slot')) {
      const key = el.dataset.slot as keyof Equipped;
      const id = this.equipped[key];
      const label = SLOTS.find((s) => s.id === key)!.label;

      el.innerHTML = '';
      el.classList.toggle('has', !!id);
      el.onclick = null;
      el.onmouseenter = null;

      if (!id) {
        // Пустое гнездо показывает погашенную иконку: иначе непонятно, что сюда
        // вообще надевается. Подпись стоит над гнездом (см. buildEquipSlots).
        el.append(this.iconEl(SLOT_GHOST[key], 'item ghost'));
        el.title = `${label} — пусто`;
        continue;
      }

      const def = ITEMS[id];
      el.append(this.iconEl(def.icon, 'item'));
      el.title = `${def.name} — снять`;
      el.onclick = () => this.onUnequip(key);
      el.onmouseenter = () => {
        this.hint.textContent = this.describe(id);
      };
    }
  }

  private statRow(icon: Icon, name: string, value: string, extra = '', title = '', stat?: Stat): string {
    const i = this.iconEl(icon, '');
    const t = title ? ` title="${title}"` : '';
    // Кнопку рисуем, только если очко реально есть куда вложить.
    const add = stat && this.canAdd
      ? `<span class="add" data-stat="${stat}" title="Вложить очко: ${STATS.find((s) => s.id === stat)!.hint}">+</span>`
      : '';
    return `<div class="stat"${t}>${i.outerHTML}<span>${name}</span><b>${value}${extra}</b>${add}</div>`;
  }

  /**
   * Характеристики. Зовётся каждый кадр, пока окно открыто, — здоровье и опыт
   * не ждут закрытия сумки. Собранная строка сравнивается с прошлой: без этого
   * перерисовка съедала бы кадры впустую.
   */
  refreshStats(): void {
    if (this.isOpen) this.renderStats();
  }

  private renderStats(): void {
    const h = this.hero?.();
    if (!h) return;

    const b = totalBonuses(this.equipped);
    const key = `${Math.ceil(h.hp)}/${h.hpMax}/${Math.floor(h.mp)}/${h.mpMax}/${h.level}/${Math.floor(h.xp)}/${JSON.stringify(b)}/${h.points}/${JSON.stringify(h.fromPoints)}`;
    if (key === this.statsKey) return;
    this.statsKey = key;
    this.canAdd = h.points > 0;

    this.lvl.textContent = `Уровень ${h.level}`;
    this.xpFill.style.width = `${Math.min(100, (h.xp / h.xpNext) * 100)}%`;
    this.xpNum.textContent = `${Math.floor(h.xp)} / ${h.xpNext}`;

    // Прибавку от вещей показываем отдельным числом: игрок должен видеть, что
    // изменилось именно из-за надетого.
    const mark = (n: number): string =>
      n > 0 ? ` <span class="plus">+${n}</span>` : n < 0 ? ` <span class="minus">${n}</span>` : '';

    // Показываем только то, что работает. Сила, ловкость и удача из чужих игр
    // были бы числами, которые ни на что не влияют.
    // Прибавки от вещей и от очков показываем ОДНОЙ зелёной цифрой: игроку важно,
    // насколько он сильнее базы, а не бухгалтерия по источникам. Разбор по
    // источникам — в подсказке.
    const p = h.fromPoints;
    const src = (gear: number, pts: number): string =>
      !gear && !pts ? '' : `от вещей ${gear >= 0 ? '+' : ''}${gear}, от очков +${pts}`;

    this.stats.innerHTML = [
      this.statRow(STAT_ICON.hp, 'Здоровье', `${Math.ceil(h.hp)} / ${h.hpMax}`, mark(b.hp + p.hp), src(b.hp, p.hp), 'hp'),
      this.statRow(STAT_ICON.dmg, 'Атака', `${h.dmgMin + b.dmg + p.dmg}–${h.dmgMax + b.dmg + p.dmg}`, mark(b.dmg + p.dmg), src(b.dmg, p.dmg), 'dmg'),
      this.statRow(STAT_ICON.mp, 'Мана', `${Math.floor(h.mp)} / ${h.mpMax}`, mark(b.mp + p.mp), src(b.mp, p.mp), 'mp'),
      this.statRow(STAT_ICON.def, 'Защита', String(b.def + p.def), '', src(b.def, p.def), 'def'),
      this.statRow(STAT_ICON.speed, 'Скорость', String(HERO.speed + b.speed), mark(b.speed)),
      // Про здоровье оговорка обязательна: в бою оно не растёт, и молчать об
      // этом — значит обещать лечение, которого не будет.
      this.statRow(
        STAT_ICON.regen, 'Восстановление', `${HERO.hpRegen}/с`, '',
        `${HERO.hpRegen} здоровья в секунду, но только если по вам не били ${HERO.regenDelay / 1000} с. Мана растёт всегда: ${HERO.mpRegen}/с.`,
      ),
      h.points > 0
        ? `<div class="pts">Очков характеристик: <b>${h.points}</b> — жми «+»</div>`
        : `<div class="pts none">Очки характеристик дают за уровень: по ${POINTS_PER_LEVEL} за каждый</div>`,
    ].join('');

    for (const el of this.stats.querySelectorAll<HTMLElement>('.add')) {
      el.onclick = () => this.onSpend(el.dataset.stat as Stat);
    }
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.root.classList.add('open');
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** Перерисовать содержимое. Зовётся при открытии и после каждой правки сумки. */
  render(): void {
    if (!this.isOpen) return;

    this.renderEquip();
    this.renderStats();

    // Вкладка не переставляет предметы, а прячет лишние: иначе ячейка под курсором
    // означала бы разное в разных вкладках, и клик попадал бы не туда.
    const list = this.bag
      .map((s, i) => (s ? { stack: s, index: i } : null))
      .filter((e): e is { stack: Stack; index: number } => !!e)
      .filter((e) => this.tab === 'all' || ITEMS[e.stack.id]?.tab === this.tab);

    for (const [n, el] of [...this.grid.children].entries()) {
      const slot = el as HTMLDivElement;
      const entry = list[n];

      slot.innerHTML = '';
      slot.className = 'slot';
      slot.onclick = null;
      slot.onmouseenter = null;
      slot.ondragstart = null;
      slot.draggable = false;
      slot.title = '';

      if (!entry) continue;

      const def = ITEMS[entry.stack.id];
      const rarity = rarityOf(entry.stack.id);
      slot.classList.add('has', `r-${rarity}`);
      slot.append(this.iconEl(def.icon, 'item'));

      if (entry.stack.qty > 1) {
        slot.append(Object.assign(document.createElement('span'), {
          className: 'qty',
          textContent: String(entry.stack.qty),
        }));
      }

      const action = def.slot ? 'надеть' : def.use ? 'применить' : '';
      slot.title = action ? `${def.name} — ${action}` : def.name;
      slot.onmouseenter = () => {
        this.hint.textContent = this.describe(def.id);
      };

      // На панель внизу вещь попадает перетаскиванием. Тащим ВИД предмета, а не
      // номер ячейки: номер живёт до первой раскладки сумки.
      if (canBind(def.id)) {
        slot.draggable = true;
        slot.ondragstart = (e) => {
          e.dataTransfer?.setData(DND.item, def.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
        };
      }

      // Вещь надевается, еда применяется — одним и тем же кликом: гадать, какая
      // кнопка на что, игроку незачем.
      if (def.slot) slot.onclick = () => this.onEquip(entry.index);
      else if (def.use) slot.onclick = () => this.onUse(entry.index);
    }
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
