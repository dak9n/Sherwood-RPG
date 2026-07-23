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
  armor: 'assets/armor-icons/armor_atlas.png',
};

/** Подписи клавиш: девять цифр и ноль — как нарисовано гнёзд. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const CSS = `
  #hotbar {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
    width: ${BAR.w * SCALE}px; height: ${BAR.h * SCALE}px;
    background: url(assets/interface/ui/hotbar.png) no-repeat 0 0 / 100% 100%;
    image-rendering: pixelated;
    z-index: var(--z-hud-bar);
    font: var(--fs-body)/1 var(--font-family);
    filter: drop-shadow(0 3px 8px var(--border-dark));
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
    position: absolute; top: -1px; left: 1px; font-size: var(--fs-micro); color: var(--parchment);
    text-shadow: 1px 1px 0 #000; pointer-events: none;
  }
  #hotbar .cnt {
    position: absolute; right: 1px; bottom: 0; font-size: var(--fs-tiny); font-weight: var(--fw-bold); color: #fff;
    text-shadow: var(--text-outline-4way);
    font-variant-numeric: tabular-nums; pointer-events: none;
  }
  /* Значок заточки оружия — «+N». Оружие не копится, угол количества свободен. */
  #hotbar .plusb {
    position: absolute; right: 1px; bottom: 0; font-size: var(--fs-tiny); font-weight: var(--fw-bold); color: var(--gold);
    text-shadow: var(--text-outline-4way);
    pointer-events: none;
  }
  /* Куда можно бросить перетаскиваемое. */
  #hotbar .hs.over { box-shadow: inset 0 0 0 2px #57c767; background: rgba(87, 199, 103, .25); }
  /* Вспышка на нажатие: без неё непонятно, сработала клавиша или нет. */
  #hotbar .hs.hit { animation: hotbar-hit .25s ease-out; }
  @keyframes hotbar-hit {
    from { background: rgba(255, 255, 255, .75); }
    to { background: rgba(255, 255, 255, 0); }
  }

  /* Слот умения (первый): огненный шар, а не предмет. Кладётся не сумкой. */
  #hotbar .hs.skill { cursor: pointer; }
  #hotbar .hs.skill .fire {
    position: absolute; inset: 3px; border-radius: var(--radius-pill); pointer-events: none;
    background: radial-gradient(circle at 50% 42%,
      var(--fire-core) 0 14%, var(--fire-hot) 14% 34%, var(--fire-orange) 34% 60%, var(--fire-ember) 60% 82%, transparent 82%);
    box-shadow: 0 0 6px 1px rgba(232, 100, 26, .7);
  }
  /* Затемнение перезарядки: «стекает» по кругу от полного к пустому. */
  #hotbar .hs.skill .cd {
    position: absolute; inset: 0; border-radius: var(--radius-2); pointer-events: none;
    background: transparent;
  }
  #hotbar .hs.skill.ready .fire { box-shadow: 0 0 8px 2px rgba(255, 176, 46, .9); }
  /* Готовность умения-значка (град стрел): подсветка вокруг иконки. */
  #hotbar .hs.skill .skillico { position: absolute; inset: 0; margin: auto; }
  #hotbar .hs.skill.ready .skillico { filter: drop-shadow(0 0 3px rgba(255, 207, 90, .95)); }
`;

export class HotbarUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private bar: Hotbar = [];
  private bag: (Stack | null)[] = [];
  private worn: Equipped = {};
  /** Заточка вида оружия — для значка «+N». Ставит сцена. */
  private plusFor: (id: string) => number = () => 0;
  private key = '';

  /** Сработала ячейка: сцена решает, применить предмет или надеть. */
  onTrigger: (slot: number) => void = () => {};
  /** Притащили предмет из сумки. */
  onBind: (slot: number, id: string) => void = () => {};
  /** Перетащили внутри панели. */
  onSwap: (from: number, to: number) => void = () => {};
  /** Сбросили ячейку правой кнопкой. */
  onClear: (slot: number) => void = () => {};
  /** Нажали слот умения i (0 — огненный шар, 1 — град стрел). */
  onSkill: (index: number) => void = () => {};

  /** Слоты умений — первые (0 — огненный шар, 1 — град стрел, 2 — барьер): не предметные. */
  private static readonly SKILL_SLOTS = 3;
  /** Затемнение-перезарядка на слотах умений (по индексу слота). */
  private cdEls: HTMLDivElement[] = [];

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

      if (i < HotbarUi.SKILL_SLOTS) {
        // Слоты умений: значок + затемнение перезарядки. Ни перетащить, ни сбросить —
        // это способности героя, а не предметы.
        el.classList.add('skill', 'ready');
        if (i === 0) {
          el.title = `Fireball (${KEYS[i]})`;
          el.append(Object.assign(document.createElement('div'), { className: 'fire' }));
        } else if (i === 1) {
          el.title = `Arrow Rain (${KEYS[i]})`;
          el.append(this.skillIcon(ITEMS['bow'].icon)); // лук — узнаваемо для града стрел
        } else {
          el.title = `Barrier (${KEYS[i]})`;
          el.append(this.skillIcon(ITEMS['shield'].icon)); // щит — узнаваемо для барьера
        }
        const cd = Object.assign(document.createElement('div'), { className: 'cd' });
        el.append(cd);
        this.cdEls[i] = cd;
        el.onclick = () => this.onSkill(i);
        el.oncontextmenu = (e) => e.preventDefault();
      } else {
        this.wire(el, i);
      }
      this.root.append(el);
    }
  }

  /** Иконка-значок для слота умения (например, лук для града стрел). */
  private skillIcon(icon: Icon): HTMLElement {
    const el = document.createElement('i');
    el.className = 'skillico';
    el.style.width = `${icon.w}px`;
    el.style.height = `${icon.h}px`;
    el.style.backgroundImage = `url(${SHEETS[icon.sheet]})`;
    el.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
    return el;
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

  setPlusFor(get: (id: string) => number): void {
    this.plusFor = get;
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

  /** Перезарядка умения в слоте i: frac 1 — только откастовал, 0 — готов (каждый кадр). */
  setSkillCooldown(index: number, frac: number): void {
    const el = this.slots[index];
    const cd = this.cdEls[index];
    if (!el || !cd) return;
    const f = Math.max(0, Math.min(1, frac));
    cd.style.background = f > 0
      ? `conic-gradient(rgba(6, 4, 2, .72) ${f * 360}deg, transparent 0)`
      : 'transparent';
    el.classList.toggle('ready', f <= 0);
  }

  render(): void {
    // Панель на виду всё время, поэтому перерисовку сравниваем со снимком:
    // иначе она перестраивала бы DOM каждый кадр игры.
    const key = this.bar
      .map((id, i) => `${id ?? '-'}:${countFor(this.bar, i, this.bag)}:${id ? !!slotWearing(this.worn, id) : 0}:${id ? this.plusFor(id) : 0}`)
      .join('|');
    if (key === this.key) return;
    this.key = key;

    for (const [i, el] of this.slots.entries()) {
      if (i < HotbarUi.SKILL_SLOTS) continue; // слоты умений не предметные — их не перерисовываем
      const id = this.bar[i];
      el.querySelector('i')?.remove();
      el.querySelector('.cnt')?.remove();
      el.querySelector('.plusb')?.remove();
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

      // Заточенное оружие носит значок «+N» и подписывается им же.
      const plus = def.slot === 'weapon' ? this.plusFor(id) : 0;
      if (plus > 0) {
        el.append(Object.assign(document.createElement('span'), { className: 'plusb', textContent: `+${plus}` }));
      }
      const nm = `${def.name}${plus > 0 ? ` +${plus}` : ''}`;

      if (wearing) el.title = `${nm} — equipped, unequip (${KEYS[i]})`;
      else if (n) el.title = `${nm} — ${def.slot ? 'equip' : 'use'} (${KEYS[i]})`;
      else el.title = `${nm} — not in bag`;
    }
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
