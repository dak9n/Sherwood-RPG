import { STATS, unspent, type Spent, type Stat } from './stats';

/**
 * Окно умений. Открывается на U.
 *
 * Здесь тратят очки, которые дают за уровень: раньше это жило в панели инвентаря,
 * но там ему тесно и не место — трата характеристик заслуживает своего окна.
 *
 * Рисуется DOM-ом поверх канваса той же рамой набора, что и инвентарь: камера
 * увеличена втрое, и всё, нарисованное в сцене, раздулось бы вместе с ней.
 */

const UI = 'assets/interface/ui';
const ICONS = 'assets/interface/PNG/Icons.png';
/** Только целый масштаб: на дробном пиксели рамки поехали бы. */
const S = 3;

/** Клетка 16x16 листа иконок. Ряды 0-5 — монохромный набор, лежит на бежевом как родной. */
const ico = (col: number, row: number): { x: number; y: number } => ({ x: col * 16, y: row * 16 });

/** Иконка на характеристику. Те же, что показывает панель инвентаря. */
const ICON: Record<Stat, { x: number; y: number }> = {
  dmg: ico(1, 0), // скрещённые мечи
  hp: ico(5, 0), // сердце
  mp: ico(4, 1), // самоцвет
  def: ico(0, 3), // щит
};

const CSS = `
  #skills {
    position: absolute; inset: 0; z-index: 21; display: none;
    align-items: center; justify-content: center;
    font: 12px/1.4 'Simplified Gothic', system-ui, sans-serif; color: #f0e0c8;
    pointer-events: none;
  }
  #skills.open { display: flex; }
  #skills * { image-rendering: pixelated; }

  #skills .win {
    pointer-events: auto; position: relative; width: 260px;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 14px 8px;
    filter: drop-shadow(0 12px 34px rgba(0,0,0,.55));
  }
  #skills .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 14px; letter-spacing: .1em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #skills .close {
    position: absolute; top: -${13 * S}px; right: 0;
    width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #skills .close:hover { filter: brightness(1.25); }

  #skills .page {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: ${2 * S}px; color: #2b1d12;
  }

  #skills .free { text-align: center; font-size: 12px; margin-bottom: 8px; color: #5a4020; }
  #skills .free b { font-size: 15px; color: #2f7a2f; }
  #skills .free.none b { color: #8a6a3a; }

  #skills .row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; }
  #skills .row + .row { border-top: 1px solid #cdb488; }
  #skills .row > i { width: 16px; height: 16px; flex: none; background: url(${ICONS}); }
  #skills .row .nm { flex: 1; font-size: 12px; }
  #skills .row .val { font-variant-numeric: tabular-nums; font-weight: 700; color: #3a2a18; }
  #skills .row .per { color: #7a6244; font-size: 11px; }

  /* Кнопка «+» — своя CSS-кнопка, как вкладки окна входа: рамка со всех сторон. */
  #skills .add {
    flex: none; width: 22px; height: 22px; line-height: 18px; text-align: center; cursor: pointer;
    font-size: 15px; font-weight: 700; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    background: #50a978; border: 2px solid #294040; border-radius: 3px;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -2px 0 #3f7168;
  }
  #skills .add:hover { filter: brightness(1.1); }
  #skills .add:active { box-shadow: inset 0 2px 4px rgba(0,0,0,.4); }
  #skills .add.off {
    cursor: default; color: #a08a6a; background: #b79b74; border-color: #6b5433;
    box-shadow: none; filter: none;
  }

  #skills .hint { margin-top: 8px; font-size: 11px; color: #6b5433; text-align: center; line-height: 1.4; }
`;

export interface SkillsHero {
  level: number;
  spent: Spent;
}

export class SkillsUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private free: HTMLDivElement;
  private rows = new Map<Stat, { val: HTMLElement; add: HTMLElement }>();
  private hero: (() => SkillsHero) | null = null;
  private key = '';

  /** Игрок вложил очко в характеристику. */
  onSpend: (stat: Stat) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'skills';
    this.root.innerHTML = `
      <div class="win">
        <div class="title">Attributes</div>
        <div class="close" title="Close (U)"></div>
        <div class="page">
          <div class="free"></div>
          <div class="rows"></div>
          <div class="hint">Points are earned per level: 3 each.<br>Spent points count in battle right away.</div>
        </div>
      </div>
    `;
    document.body.append(this.root);

    this.free = this.root.querySelector('.free')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());

    const rows = this.root.querySelector('.rows')!;
    for (const s of STATS) {
      const row = document.createElement('div');
      row.className = 'row';

      const icon = document.createElement('i');
      icon.style.backgroundPosition = `-${ICON[s.id].x}px -${ICON[s.id].y}px`;

      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = s.label;

      const val = document.createElement('span');
      val.className = 'val';

      const add = document.createElement('span');
      add.className = 'add';
      add.textContent = '+';
      add.title = s.hint;
      add.onclick = () => this.onSpend(s.id);

      row.append(icon, nm, val, add);
      rows.append(row);
      this.rows.set(s.id, { val, add });
    }
  }

  setHero(get: () => SkillsHero): void {
    this.hero = get;
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

  /**
   * Перерисовать, если что-то изменилось. Зовётся каждый кадр, пока окно открыто
   * (уровень может подрасти в бою), поэтому сравниваем со снимком.
   */
  render(): void {
    if (!this.isOpen) return;
    const h = this.hero?.();
    if (!h) return;

    const left = unspent(h.level, h.spent);
    const key = `${left}|${STATS.map((s) => h.spent[s.id]).join(',')}`;
    if (key === this.key) return;
    this.key = key;

    this.free.innerHTML = `Free points: <b>${left}</b>`;
    this.free.classList.toggle('none', left <= 0);

    for (const s of STATS) {
      const r = this.rows.get(s.id)!;
      const points = h.spent[s.id];
      // Показываем и сколько очков вложено, и что это дало в бою.
      r.val.innerHTML = points
        ? `${points} <span class="per">(+${points * s.per})</span>`
        : `0 <span class="per">${s.hint}</span>`;
      // Кнопка гаснет, когда вкладывать нечего: мёртвая кнопка хуже понятной.
      r.add.classList.toggle('off', left <= 0);
    }
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
