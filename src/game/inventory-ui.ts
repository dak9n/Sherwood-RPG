import { ITEMS, type Icon, type Stack, type Tab } from './items';

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
`;

export class InventoryUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private grid: HTMLDivElement;
  private hint: HTMLDivElement;
  private tab: Tab | 'all' = 'all';
  private bag: (Stack | null)[] = [];

  /** Зовётся, когда игрок хочет применить предмет из ячейки. */
  onUse: (index: number) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'inv';
    this.root.innerHTML = `
      <div class="win">
        <div class="title"><span>Инвентарь</span><span class="close" title="Закрыть (I)">✕</span></div>
        <div class="tabs"></div>
        <div class="grid"></div>
        <div class="hint"></div>
      </div>
    `;
    document.body.append(this.root);

    this.grid = this.root.querySelector('.grid')!;
    this.hint = this.root.querySelector('.hint')!;
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

  setBag(bag: (Stack | null)[]): void {
    this.bag = bag;
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
      const icon = def.icon;

      const img = document.createElement('i');
      img.style.width = `${icon.w}px`;
      img.style.height = `${icon.h}px`;
      img.style.backgroundImage = `url(${SHEETS[icon.sheet]})`;
      img.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
      slot.append(img);

      if (entry.stack.qty > 1) {
        const qty = document.createElement('span');
        qty.className = 'qty';
        qty.textContent = String(entry.stack.qty);
        slot.append(qty);
      }

      slot.title = def.use ? `${def.name} — применить` : def.name;
      slot.onmouseenter = () => {
        this.hint.textContent = def.use
          ? `${def.name}: ${def.use.hp ? `+${def.use.hp} здоровья` : ''}${def.use.mp ? `+${def.use.mp} маны` : ''}`
          : def.name;
      };
      if (def.use) slot.onclick = () => this.onUse(entry.index);
    }
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
