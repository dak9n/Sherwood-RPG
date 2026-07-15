import { ITEMS, type Icon, type Stack, type Tab } from './items';
import { SLOTS, totalBonuses, type Equipped } from './equipment';
import { HERO } from './creatures';

/**
 * Окно инвентаря. Открывается на I.
 *
 * Рисуется DOM-ом поверх канваса, как и панель героя: камера игры увеличена
 * втрое, и всё, что рисуется внутри сцены, раздулось бы вместе с ней.
 *
 * Само окно — CSS, а не картинка: слот в наборе оказался одним сплошным цветом
 * (проверено — 14x14 пикселей ровно одного тона), поэтому сетка любого размера
 * бесплатна и выглядит как тот же набор. Из графики берутся только иконки.
 */

/** Цвета взяты пипеткой из Inventory.png — окно должно быть из того же набора. */
const C = {
  frame: '#000000',
  title: '#478773',
  bg: '#cda677',
  slot: '#9d775d',
  slotHover: '#b98f6a',
  text: '#2b1d12',
} as const;

const SHEETS: Record<Icon['sheet'], string> = {
  icons: 'assets/interface/PNG/Icons.png',
  Objects: 'assets/tilesets/Objects.png',
};

const COLS = 7;
const ROWS = 5;
/** Слот 16px мелковат для мыши — увеличиваем втрое, как и панель героя. */
const SCALE = 3;
const SLOT = 18;

const TABS: { id: Tab | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'weapon', label: 'Оружие' },
  { id: 'armor', label: 'Броня' },
  { id: 'resource', label: 'Ресурсы' },
  { id: 'food', label: 'Еда' },
];

const CSS = `
  #inv {
    position: absolute; inset: 0; z-index: 20; display: none;
    align-items: center; justify-content: center;
    font: 12px/1 system-ui, sans-serif; color: ${C.text};
    /* Растянут на весь экран, но кликов не ловит: игра не на паузе, и мимо окна
       удар должен доходить до пауков. Ловит только само окно — см. .win. */
    pointer-events: none;
  }
  #inv.open { display: flex; }
  /* Клики ловит только окно: мимо окна — по игре, чтобы не блокировать её зря. */
  #inv .win {
    pointer-events: auto;
    background: ${C.bg}; border: 3px solid ${C.frame};
    box-shadow: 0 8px 32px rgba(0,0,0,.6), inset 0 0 0 2px #b0854f;
    padding: 0 0 10px; border-radius: 2px;
  }
  #inv .title {
    background: ${C.title}; color: #eaf6f0; border-bottom: 3px solid ${C.frame};
    padding: 6px 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    display: flex; justify-content: space-between; align-items: center; gap: 24px;
  }
  #inv .close {
    cursor: pointer; width: 18px; height: 18px; line-height: 16px; text-align: center;
    background: #a33b2e; border: 2px solid ${C.frame}; color: #fff; border-radius: 2px;
  }
  #inv .close:hover { background: #c04a3a; }

  #inv .tabs { display: flex; gap: 4px; padding: 8px 10px 0; }
  #inv .tab {
    cursor: pointer; padding: 3px 8px; border: 2px solid ${C.frame}; border-radius: 2px;
    background: ${C.slot}; color: #f0e0c8;
  }
  #inv .tab:hover { background: ${C.slotHover}; }
  #inv .tab[aria-selected="true"] { background: ${C.title}; }

  #inv .grid {
    display: grid; grid-template-columns: repeat(${COLS}, ${SLOT * SCALE}px);
    gap: 4px; padding: 10px;
  }
  #inv .slot {
    width: ${SLOT * SCALE}px; height: ${SLOT * SCALE}px;
    background: ${C.slot}; border: 2px solid #6b4f3a; border-radius: 2px;
    position: relative; cursor: default;
  }
  #inv .slot.has { cursor: pointer; }
  #inv .slot.has:hover { background: ${C.slotHover}; border-color: #e0c48a; }
  /* Иконка кладётся куском листа: пиксели не сглаживаем. */
  #inv .slot i {
    position: absolute; inset: 0; margin: auto;
    image-rendering: pixelated;
    transform: scale(${SCALE}); transform-origin: center;
  }
  #inv .qty {
    position: absolute; right: 2px; bottom: 1px;
    font-size: 11px; font-weight: 700; color: #fff;
    text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
    font-variant-numeric: tabular-nums;
  }
  #inv .hint {
    padding: 0 12px; height: 16px; color: #6b4f3a; font-size: 11px;
  }

  /* Панель персонажа слева, сумка справа — как в любой RPG. */
  #inv .body { display: flex; gap: 10px; padding: 10px; align-items: flex-start; }
  #inv .hero {
    background: ${C.slot}; border: 2px solid #6b4f3a; border-radius: 2px;
    padding: 8px; display: flex; flex-direction: column; gap: 8px; color: #f0e0c8;
  }
  #inv .hero h3 {
    margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #e0c48a;
  }
  /* Портрет — тот же кружок, что в панели героя на карте. */
  #inv .portrait {
    width: 30px; height: 30px; margin: 0 auto;
    background-image: url(assets/interface/PNG/character_panel.png);
    background-position: -3px -2px;
    image-rendering: pixelated; transform: scale(2); transform-origin: top center;
  }
  #inv .lvl { text-align: center; margin-top: 34px; font-size: 12px; }
  #inv .xpbar {
    height: 6px; background: #3a2a1c; border: 1px solid #2b1d12; border-radius: 3px; overflow: hidden;
  }
  #inv .xpbar i { display: block; height: 100%; background: linear-gradient(#e0b45c, #a37a2b); }

  /* Гнёзда экипировки такие же, как в сумке: разный размер читался бы как разный смысл. */
  #inv .eq { display: grid; grid-template-columns: repeat(2, ${SLOT * SCALE}px); gap: 4px; justify-content: center; }
  #inv .eq .lbl {
    position: absolute; bottom: 2px; left: 0; right: 0; text-align: center;
    font-size: 9px; color: #d8c0a0; white-space: nowrap;
    text-shadow: 1px 1px 0 #000; pointer-events: none;
  }

  #inv .stats { font-size: 11px; display: grid; gap: 3px; }
  #inv .stats div { display: flex; justify-content: space-between; gap: 10px; }
  #inv .stats b { font-weight: 600; }
  #inv .stats .plus { color: #8ad46a; }
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
}

export class InventoryUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private grid: HTMLDivElement;
  private hint: HTMLDivElement;
  private eq!: HTMLDivElement;
  private stats!: HTMLDivElement;
  private lvl!: HTMLDivElement;
  private xpFill!: HTMLElement;
  private tab: Tab | 'all' = 'all';
  private bag: (Stack | null)[] = [];
  private equipped: Equipped = {};
  /** Спрашиваем героя, а не запоминаем: здоровье меняется каждый кадр. */
  private hero: (() => HeroView) | null = null;
  private statsKey = '';

  /** Зовётся, когда игрок хочет применить предмет из ячейки. */
  onUse: (index: number) => void = () => {};
  /** Надеть предмет из ячейки сумки. */
  onEquip: (index: number) => void = () => {};
  /** Снять надетое. */
  onUnequip: (slot: string) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'inv';
    this.root.innerHTML = `
      <div class="win">
        <div class="title"><span>Инвентарь</span><span class="close" title="Закрыть (I)">✕</span></div>
        <div class="body">
          <div class="hero">
            <h3>Персонаж</h3>
            <div><div class="portrait"></div><div class="lvl"></div></div>
            <div class="xpbar"><i></i></div>
            <div class="eq"></div>
            <h3>Характеристики</h3>
            <div class="stats"></div>
          </div>
          <div>
            <div class="tabs"></div>
            <div class="grid"></div>
            <div class="hint"></div>
          </div>
        </div>
      </div>
    `;
    document.body.append(this.root);

    this.grid = this.root.querySelector('.grid')!;
    this.hint = this.root.querySelector('.hint')!;
    this.eq = this.root.querySelector('.eq')!;
    this.stats = this.root.querySelector('.stats')!;
    this.lvl = this.root.querySelector('.lvl')!;
    this.xpFill = this.root.querySelector('.xpbar i')!;
    this.buildEquipSlots();
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());

    const tabs = this.root.querySelector('.tabs')!;
    for (const t of TABS) {
      const el = document.createElement('span');
      el.className = 'tab';
      el.textContent = t.label;
      el.setAttribute('aria-selected', String(t.id === this.tab));
      el.onclick = () => {
        this.tab = t.id;
        for (const other of tabs.children) other.setAttribute('aria-selected', String(other === el));
        this.render();
      };
      tabs.append(el);
    }

    this.buildSlots();
  }

  private buildSlots(): void {
    for (let i = 0; i < COLS * ROWS; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.i = String(i);
      this.grid.append(slot);
    }
  }

  private buildEquipSlots(): void {
    for (const s of SLOTS) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slot = s.id;
      slot.title = s.label;
      this.eq.append(slot);
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

  /** Кусок листа как фон: так рисуются все иконки предметов. */
  private iconEl(icon: Icon): HTMLElement {
    const img = document.createElement('i');
    img.style.width = `${icon.w}px`;
    img.style.height = `${icon.h}px`;
    img.style.backgroundImage = `url(${SHEETS[icon.sheet]})`;
    img.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
    return img;
  }

  private renderEquip(): void {
    for (const el of this.eq.children) {
      const slot = el as HTMLDivElement;
      const id = this.equipped[slot.dataset.slot as keyof Equipped];
      const label = SLOTS.find((s) => s.id === slot.dataset.slot)!.label;

      slot.innerHTML = '';
      slot.classList.toggle('has', !!id);
      slot.onclick = null;

      if (!id) {
        // Пустой слот подписан: иначе непонятно, что сюда вообще надевается.
        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        lbl.textContent = label;
        slot.append(lbl);
        slot.title = label;
        continue;
      }

      const def = ITEMS[id];
      slot.append(this.iconEl(def.icon));
      slot.title = `${def.name} — снять`;
      slot.onclick = () => this.onUnequip(slot.dataset.slot!);
    }
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
    const key = `${h.hp | 0}/${h.hpMax}/${h.mp | 0}/${h.mpMax}/${h.level}/${h.xp | 0}/${JSON.stringify(b)}`;
    if (key === this.statsKey) return;
    this.statsKey = key;

    const plus = (n: number): string => (n ? ` <span class="plus">+${n}</span>` : '');

    this.lvl.textContent = `Уровень ${h.level}`;
    this.xpFill.style.width = `${Math.min(100, (h.xp / h.xpNext) * 100)}%`;

    // Показываем только то, что работает. Сила, ловкость и удача из чужих игр
    // были бы числами, которые ни на что не влияют.
    this.stats.innerHTML = `
      <div><span>Здоровье</span><b>${Math.ceil(h.hp)} / ${h.hpMax}${plus(b.hp)}</b></div>
      <div><span>Мана</span><b>${Math.floor(h.mp)} / ${h.mpMax}${plus(b.mp)}</b></div>
      <div><span>Атака</span><b>${h.dmgMin + b.dmg}–${h.dmgMax + b.dmg}${plus(b.dmg)}</b></div>
      <div><span>Защита</span><b>${b.def}</b></div>
      <div><span>Скорость</span><b>${HERO.speed + b.speed}</b></div>
      <div><span>Опыт</span><b>${Math.floor(h.xp)} / ${h.xpNext}</b></div>
    `;
  }

  /** Строка для подсказки под сумкой: что предмет даёт. */
  private describe(id: string): string {
    const def = ITEMS[id];
    if (!def) return '';

    const parts: string[] = [];
    if (def.use?.hp) parts.push(`+${def.use.hp} здоровья`);
    if (def.use?.mp) parts.push(`+${def.use.mp} маны`);

    const b = def.bonus;
    if (b?.dmg) parts.push(`${b.dmg > 0 ? '+' : ''}${b.dmg} к атаке`);
    if (b?.def) parts.push(`${b.def > 0 ? '+' : ''}${b.def} к защите`);
    if (b?.speed) parts.push(`${b.speed > 0 ? '+' : ''}${b.speed} к скорости`);
    if (b?.hp) parts.push(`${b.hp > 0 ? '+' : ''}${b.hp} к здоровью`);
    if (b?.mp) parts.push(`${b.mp > 0 ? '+' : ''}${b.mp} к мане`);

    return parts.length ? `${def.name}: ${parts.join(', ')}` : def.name;
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
    const shown = this.bag.map((s, i) =>
      s && (this.tab === 'all' || ITEMS[s.id]?.tab === this.tab) ? { stack: s, index: i } : null,
    );
    const list = shown.filter(Boolean) as { stack: Stack; index: number }[];

    for (const [n, el] of [...this.grid.children].entries()) {
      const slot = el as HTMLDivElement;
      const entry = list[n];

      slot.innerHTML = '';
      slot.classList.toggle('has', !!entry);
      slot.onclick = null;
      slot.onmouseenter = null;
      slot.title = '';

      if (!entry) continue;

      const def = ITEMS[entry.stack.id];
      slot.append(this.iconEl(def.icon));

      if (entry.stack.qty > 1) {
        const qty = document.createElement('span');
        qty.className = 'qty';
        qty.textContent = String(entry.stack.qty);
        slot.append(qty);
      }

      const action = def.slot ? 'надеть' : def.use ? 'применить' : '';
      slot.title = action ? `${def.name} — ${action}` : def.name;

      slot.onmouseenter = () => {
        this.hint.textContent = this.describe(def.id);
      };

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
