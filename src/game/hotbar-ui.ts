import { ITEMS, type Icon, type Stack } from './items';
import { countFor, HOTBAR_SIZE, type Hotbar } from './hotbar';
import { slotWearing, type Equipped } from './equipment';
import { DND } from './dnd';

/**
 * Планка быстрого доступа внизу экрана.
 *
 * Видна всегда, а не только в открытой сумке: весь смысл панели в том, чтобы
 * выпить зелье, НЕ открывая инвентарь. Панель внутри инвентаря решала бы ровно
 * ту задачу, которой нет.
 *
 * Планка — готовый кусок набора (Action_panel.png), вырезанный tools/cut-ui.mjs.
 * Десять гнёзд нарисованы прямо в ней, поэтому её не тянем: гнёзда размазало бы.
 * Ячейки — прозрачные квадраты поверх нарисованных гнёзд, по замеренным местам.
 */

/** Замеры планки из листа. Меняются только вместе с картинкой. */
const BAR = { w: 168, h: 20, slot: 12, first: 6, step: 16 } as const;
/** Целое кратное: на дробном пиксели планки поехали бы. */
const SCALE = 3;

const SHEETS: Record<Icon['sheet'], string> = {
  icons: 'assets/interface/PNG/Icons.png',
  Objects: 'assets/tilesets/Objects.png',
  scroll: 'assets/interface/ui/scroll.png',
};

/** Подписи клавиш: девять цифр и ноль — как нарисовано гнёзд. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const CSS = `
  #hotbar {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
    width: ${BAR.w * SCALE}px; height: ${BAR.h * SCALE}px;
    background: url(assets/interface/ui/hotbar.png) no-repeat 0 0 / 100% 100%;
    image-rendering: pixelated;
    z-index: 15;
    font: 12px/1 system-ui, sans-serif;
    filter: drop-shadow(0 3px 8px rgba(0, 0, 0, .5));
  }
  #hotbar .hs {
    position: absolute; top: ${BAR.first * SCALE}px;
    width: ${BAR.slot * SCALE}px; height: ${BAR.slot * SCALE}px;
  }
  #hotbar .hs i {
    position: absolute; inset: 0; margin: auto;
    width: 16px; height: 16px; transform: scale(2);
    image-rendering: pixelated; display: block; pointer-events: none;
  }
  /* Кончилось — гасим, но привязку держим: наберёшь ещё, и клавиша оживёт. */
  #hotbar .hs.out i { opacity: .35; filter: grayscale(1); }
  /* Надето — не погашено: вещь не потеряна, она в руке. */
  #hotbar .hs.worn { box-shadow: inset 0 0 0 2px #57c767; }
  #hotbar .hs.full { cursor: grab; }
  #hotbar .key {
    position: absolute; top: -1px; left: 1px; font-size: 9px; color: #e5d6a1;
    text-shadow: 1px 1px 0 #000; pointer-events: none;
  }
  #hotbar .cnt {
    position: absolute; right: 1px; bottom: 0; font-size: 10px; font-weight: 700; color: #fff;
    text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
    font-variant-numeric: tabular-nums; pointer-events: none;
  }
  /* Куда можно бросить перетаскиваемое. */
  #hotbar .hs.over { box-shadow: inset 0 0 0 2px #57c767; background: rgba(87, 199, 103, .25); }
  /* Вспышка на нажатие: без неё непонятно, сработала клавиша или нет. */
  #hotbar .hs.hit { animation: hotbar-hit .25s ease-out; }
  @keyframes hotbar-hit {
    from { background: rgba(255, 255, 255, .75); }
    to { background: rgba(255, 255, 255, 0); }
  }
`;

export class HotbarUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private bar: Hotbar = [];
  private bag: (Stack | null)[] = [];
  private worn: Equipped = {};
  private key = '';

  /** Сработала ячейка: сцена решает, применить предмет или надеть. */
  onTrigger: (slot: number) => void = () => {};
  /** Притащили предмет из сумки. */
  onBind: (slot: number, id: string) => void = () => {};
  /** Перетащили внутри панели. */
  onSwap: (from: number, to: number) => void = () => {};
  /** Сбросили ячейку правой кнопкой. */
  onClear: (slot: number) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'hotbar';
    document.body.append(this.root);

    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'hs';
      el.dataset.i = String(i);
      el.style.left = `${(BAR.first + i * BAR.step) * SCALE}px`;
      el.append(Object.assign(document.createElement('span'), { className: 'key', textContent: KEYS[i] }));
      this.wire(el, i);
      this.root.append(el);
    }
  }

  private wire(el: HTMLDivElement, i: number): void {
    el.onclick = () => this.onTrigger(i);

    // Правая кнопка снимает привязку. Меню браузера тут только мешает.
    el.oncontextmenu = (e) => {
      e.preventDefault();
      this.onClear(i);
    };

    el.ondragstart = (e) => {
      const id = this.bar[i];
      if (!id || !e.dataTransfer) return;
      e.dataTransfer.setData(DND.hotbar, String(i));
      e.dataTransfer.effectAllowed = 'move';
    };

    el.ondragover = (e) => {
      e.preventDefault();
      el.classList.add('over');
    };
    el.ondragleave = () => el.classList.remove('over');

    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove('over');
      if (!e.dataTransfer) return;

      const from = e.dataTransfer.getData(DND.hotbar);
      if (from !== '') {
        this.onSwap(Number(from), i);
        return;
      }
      const id = e.dataTransfer.getData(DND.item);
      if (id) this.onBind(i, id);
    };
  }

  setData(bar: Hotbar, bag: (Stack | null)[], worn: Equipped): void {
    this.bar = bar;
    this.bag = bag;
    this.worn = worn;
  }

  /** Перетаскивание настраивает сцена: она же владеет и сумкой, и панелью. */
  get slots(): HTMLDivElement[] {
    return [...this.root.querySelectorAll<HTMLDivElement>('.hs')];
  }

  /** Мигнуть ячейкой, чтобы нажатие клавиши было заметно. */
  flash(slot: number): void {
    const el = this.slots[slot];
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth; // перезапуск анимации: без этого второе нажатие подряд не мигнёт
    el.classList.add('hit');
  }

  render(): void {
    // Панель на виду всё время, поэтому перерисовку сравниваем со снимком:
    // иначе она перестраивала бы DOM каждый кадр игры.
    const key = this.bar
      .map((id, i) => `${id ?? '-'}:${countFor(this.bar, i, this.bag)}:${id ? !!slotWearing(this.worn, id) : 0}`)
      .join('|');
    if (key === this.key) return;
    this.key = key;

    for (const [i, el] of this.slots.entries()) {
      const id = this.bar[i];
      el.querySelector('i')?.remove();
      el.querySelector('.cnt')?.remove();
      el.classList.toggle('full', !!id);
      el.classList.remove('out', 'worn');
      el.title = '';
      el.draggable = !!id;

      if (!id) continue;

      const def = ITEMS[id];
      if (!def) continue;

      const icon = document.createElement('i');
      icon.style.width = `${def.icon.w}px`;
      icon.style.height = `${def.icon.h}px`;
      icon.style.backgroundImage = `url(${SHEETS[def.icon.sheet]})`;
      icon.style.backgroundPosition = `-${def.icon.x}px -${def.icon.y}px`;
      el.append(icon);

      const n = countFor(this.bar, i, this.bag);
      // Надетое лежит не в сумке. Без этой проверки надетый меч выглядел бы
      // как потерянный — «кончился», хотя он прямо в руке.
      const wearing = !!slotWearing(this.worn, id);

      if (wearing) el.classList.add('worn');
      else if (!n) el.classList.add('out');

      if (n > 1) {
        el.append(Object.assign(document.createElement('span'), { className: 'cnt', textContent: String(n) }));
      }

      if (wearing) el.title = `${def.name} — надето, снять (${KEYS[i]})`;
      else if (n) el.title = `${def.name} — ${def.slot ? 'надеть' : 'применить'} (${KEYS[i]})`;
      else el.title = `${def.name} — нет в сумке`;
    }
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
