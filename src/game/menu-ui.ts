import type { Icon } from './items';

/**
 * Полоса кнопок у правого края, под мини-картой.
 *
 * Нужна затем, что клавиши I и M ниоткуда не узнать: игра их нигде не пишет.
 * Кнопка показывает и что есть, и на что нажать.
 *
 * Кнопок ровно столько, сколько окон в игре. Дорисовать сюда «Умения» или
 * «Задания» под будущее нельзя: мёртвая кнопка — обещание, которого игра не
 * держит. Появится окно — появится кнопка, это одна строка в GameScene.
 */

const UI = 'assets/interface/ui';
const ICONS = 'assets/interface/PNG/Icons.png';

/** Кнопка меню. Открытость спрашиваем у окна, а не помним у себя: окно закрывают и крестиком, и клавишей. */
export interface MenuItem {
  label: string;
  /** Подпись клавиши — то, ради чего меню и заводили. */
  key: string;
  icon: Icon;
  isOpen: () => boolean;
  toggle: () => void;
}

/** Под мини-картой: её рама 150px плюс отступ сверху. */
const TOP = 12 + 150 + 8;

const CSS = `
  #menu {
    position: absolute; right: 12px; top: ${TOP}px; z-index: 10;
    display: flex; flex-direction: column; gap: 4px;
    font: 11px/1 system-ui, sans-serif;
  }
  #menu .mi {
    display: flex; align-items: center; gap: 5px; cursor: pointer;
    padding: 3px 8px 3px 5px; min-width: 96px;
    border-image: url(${UI}/button.png) 4 3 3 3 fill / 8px 6px 6px 6px repeat;
    border-width: 8px 6px 6px 6px; border-style: solid;
    image-rendering: pixelated;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #menu .mi:hover { filter: brightness(1.15); }
  #menu .mi:active { transform: translateY(1px); }
  /* Открытое окно — кнопка притушена и сдвинута: иначе непонятно, что открыто.
     Одной яркости мало — на глаз разница почти не читалась. */
  #menu .mi[aria-pressed="true"] {
    filter: brightness(.68) saturate(1.4);
    transform: translateX(3px);
  }
  #menu .mi i {
    width: 16px; height: 16px; flex: none; display: block;
    image-rendering: pixelated;
  }
  #menu .mi .nm { flex: 1; }
  #menu .mi .k {
    flex: none; opacity: .75; font-variant-numeric: tabular-nums;
  }
`;

export class MenuUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private items: MenuItem[];
  private buttons: HTMLDivElement[] = [];
  private last = '';

  constructor(items: MenuItem[]) {
    this.items = items;

    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'menu';
    document.body.append(this.root);

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'mi';
      el.title = `${item.label} — клавиша ${item.key}`;

      const icon = document.createElement('i');
      icon.style.backgroundImage = `url(${ICONS})`;
      icon.style.backgroundPosition = `-${item.icon.x}px -${item.icon.y}px`;
      el.append(icon);
      el.append(Object.assign(document.createElement('span'), { className: 'nm', textContent: item.label }));
      el.append(Object.assign(document.createElement('span'), { className: 'k', textContent: item.key }));

      el.onclick = () => item.toggle();
      this.root.append(el);
      this.buttons.push(el);
    }
  }

  /**
   * Подсветить открытые окна. Зовётся каждый кадр, поэтому сверяемся со снимком:
   * трогать DOM 60 раз в секунду ради двух кнопок незачем.
   */
  render(): void {
    const key = this.items.map((i) => (i.isOpen() ? '1' : '0')).join('');
    if (key === this.last) return;
    this.last = key;

    for (const [n, el] of this.buttons.entries()) {
      el.setAttribute('aria-pressed', String(this.items[n].isOpen()));
    }
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
