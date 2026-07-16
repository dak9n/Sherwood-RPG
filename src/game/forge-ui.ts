import { ITEMS, type Icon } from './items';
import { SHARPEN_MAX, sharpenChance } from './forge';

/**
 * Окно кузницы. Открывается на K.
 *
 * Здесь точат оружие: попытка съедает свиток заточки (продаётся в магазине, O)
 * и с шансом поднимает НАДЕТОЕ оружие на +1 (до +${SHARPEN_MAX}). Шансы честно
 * написаны в самом окне — те же числа, что использует бросок (forge.ts).
 *
 * Рисуется DOM-ом поверх канваса той же рамой набора, что остальные окна.
 * Окно шлёт намерение в сцену, а решает чистая trySharpen — как у магазина.
 */

const UI = 'assets/interface/ui';
const ICONS = 'assets/interface/PNG/Icons.png';
/** Лист с окном крафта: оттуда берём наковальню — эмблему кузницы. */
const CRAFT = 'assets/interface/PNG/Craft.png';
/** Наковальня в листе крафта (замерено по пикселям). */
const ANVIL = { x: 537, y: 388, w: 40, h: 25 };
/** Только целый масштаб: на дробном пиксели рамки поехали бы. */
const S = 3;

const SHEETS: Record<Icon['sheet'], string> = {
  icons: ICONS,
  Objects: 'assets/tilesets/Objects.png',
  scroll: `${UI}/scroll.png`,
};

/** Что окно знает о герое. Сцена отдаёт живые данные, окно только рисует. */
export interface ForgeState {
  /** id надетого оружия. Пусто — точить нечего. */
  weapon?: string;
  /** Текущая заточка этого оружия. */
  plus: number;
  /** Сколько свитков в сумке. */
  scrolls: number;
}

const CSS = `
  #forge {
    position: absolute; inset: 0; z-index: 23; display: none;
    align-items: center; justify-content: center;
    font: 12px/1.4 system-ui, sans-serif; color: #f0e0c8;
    pointer-events: none;
  }
  #forge.open { display: flex; }
  #forge * { image-rendering: pixelated; }
  #forge i { display: block; }

  #forge .win {
    pointer-events: auto; position: relative; width: 300px;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 14px 10px;
    filter: drop-shadow(0 12px 34px rgba(0,0,0,.55));
  }
  #forge .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 14px; letter-spacing: .1em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #forge .close {
    position: absolute; top: -${13 * S}px; right: 0;
    width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #forge .close:hover { filter: brightness(1.25); }

  /* Наковальня — эмблема, вырезана взглядом из листа крафта. */
  #forge .anvil {
    width: ${ANVIL.w}px; height: ${ANVIL.h}px; margin: 4px auto 6px;
    background: url(${CRAFT}) -${ANVIL.x}px -${ANVIL.y}px;
    transform: scale(2); transform-origin: center;
  }

  #forge .page {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: ${2 * S}px; color: #2b1d12;
  }

  /* Карточка оружия. */
  #forge .wpn { display: flex; align-items: center; gap: 9px; padding: 2px 2px 8px; }
  #forge .wico {
    flex: none; width: 40px; height: 40px; background: #cda677;
    border: 2px solid #6b4f3a; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
  }
  #forge .wico .ico { transform: scale(1.9); transform-origin: center; }
  #forge .wname { flex: 1; font-size: 13px; font-weight: 700; }
  #forge .wname .plus { color: #2f7a2f; }
  #forge .wname small { display: block; font-weight: 400; font-size: 11px; color: #7a6244; margin-top: 1px; }

  /* Строки состояния: свитки и шанс. */
  #forge .row {
    display: flex; align-items: center; gap: 7px; padding: 5px 2px;
    border-top: 1px solid #cdb488; font-size: 12px;
  }
  #forge .row .ico { flex: none; }
  #forge .row .nm { flex: 1; }
  #forge .row b { font-variant-numeric: tabular-nums; }
  #forge .chance b { font-size: 14px; color: #2f7a2f; }
  #forge .chance.low b { color: #a33b2e; }

  /* Ступени шансов — обещание, которое держит бросок (см. forge.ts). */
  #forge .table { border-top: 1px solid #cdb488; padding: 6px 2px 2px; font-size: 11px; color: #6b5433; }
  #forge .table .r { display: flex; justify-content: space-between; padding: 1px 0; }
  #forge .table .r.cur { color: #2b1d12; font-weight: 700; }

  /* Кнопка заточки — своя CSS-кнопка, как вкладки окна входа. */
  #forge .go {
    width: 100%; margin-top: 9px; cursor: pointer; font: inherit; font-weight: 700; font-size: 13px;
    padding: 10px 8px; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    background: #50a978; border: 2px solid #294040; border-radius: 4px;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -3px 0 #3f7168;
  }
  #forge .go:hover:not(:disabled) { filter: brightness(1.1); }
  #forge .go:active:not(:disabled) { transform: translateY(1px); }
  #forge .go:disabled {
    cursor: default; color: #a08a6a; background: #b79b74; border-color: #6b5433;
    box-shadow: none; text-shadow: none;
  }

  #forge .msg { margin-top: 7px; min-height: 15px; font-size: 12px; text-align: center; color: #9a835f; }
`;

export class ForgeUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private wpnEl: HTMLElement;
  private rowsEl: HTMLElement;
  private tableEl: HTMLElement;
  private goBtn: HTMLButtonElement;
  private msgEl: HTMLElement;
  private state: () => ForgeState = () => ({ plus: 0, scrolls: 0 });
  private key = '';

  /** Игрок жмёт «Заточить». Решает сцена через чистую trySharpen. */
  onSharpen: () => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'forge';
    this.root.innerHTML = `
      <div class="win">
        <div class="title">Кузница</div>
        <div class="close" title="Закрыть (K)"></div>
        <div class="anvil"></div>
        <div class="page">
          <div class="wpn"></div>
          <div class="rows"></div>
          <div class="table"></div>
        </div>
        <button class="go"></button>
        <div class="msg"></div>
      </div>
    `;
    document.body.append(this.root);

    this.wpnEl = this.root.querySelector('.wpn')!;
    this.rowsEl = this.root.querySelector('.rows')!;
    this.tableEl = this.root.querySelector('.table')!;
    this.goBtn = this.root.querySelector('.go')!;
    this.msgEl = this.root.querySelector('.msg')!;

    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.goBtn.onclick = () => this.onSharpen();
  }

  setState(get: () => ForgeState): void {
    this.state = get;
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
    this.key = '';
    this.msgEl.textContent = 'Попытка съедает один свиток. Неудача не сбрасывает заточку.';
    this.msgEl.style.color = '#9a835f';
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** Итог попытки: зелёный успех или красная неудача. Живёт до следующей. */
  flash(msg: string, ok = true): void {
    this.msgEl.textContent = msg;
    this.msgEl.style.color = ok ? '#8ad46a' : '#ff8a75';
  }

  private iconEl(icon: Icon): HTMLElement {
    const el = document.createElement('i');
    el.className = 'ico';
    el.style.backgroundImage = `url(${SHEETS[icon.sheet]})`;
    el.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
    el.style.width = `${icon.w}px`;
    el.style.height = `${icon.h}px`;
    return el;
  }

  /**
   * Перерисовать, если что-то изменилось. Зовётся каждый кадр, пока окно
   * открыто (свитки докупаются, оружие меняют), поэтому сравниваем со снимком.
   */
  render(): void {
    if (!this.isOpen) return;
    const st = this.state();
    const key = `${st.weapon ?? ''}|${st.plus}|${st.scrolls}`;
    if (key === this.key) return;
    this.key = key;

    const def = st.weapon ? ITEMS[st.weapon] : undefined;
    const atMax = st.plus >= SHARPEN_MAX;
    const target = st.plus + 1;
    const chance = atMax ? 0 : sharpenChance(target);

    // Карточка оружия.
    this.wpnEl.innerHTML = '';
    const wico = document.createElement('div');
    wico.className = 'wico';
    if (def) wico.append(this.iconEl(def.icon));
    const wname = document.createElement('div');
    wname.className = 'wname';
    wname.innerHTML = def
      ? `${def.name}${st.plus > 0 ? ` <span class="plus">+${st.plus}</span>` : ''}` +
        `<small>${atMax ? 'заточен до предела' : `заточка даёт +${st.plus} к атаке`}</small>`
      : `Оружие не надето<small>надень меч или лук в инвентаре (I)</small>`;
    this.wpnEl.append(wico, wname);

    // Свитки и шанс.
    const scrollDef = ITEMS.scroll_sharpen;
    this.rowsEl.innerHTML = '';
    const rScroll = document.createElement('div');
    rScroll.className = 'row';
    rScroll.append(
      this.iconEl(scrollDef.icon),
      Object.assign(document.createElement('span'), { className: 'nm', textContent: 'Свитки заточки' }),
      Object.assign(document.createElement('b'), { textContent: String(st.scrolls) }),
    );
    this.rowsEl.append(rScroll);

    if (def && !atMax) {
      const rChance = document.createElement('div');
      rChance.className = `row chance${chance < 0.4 ? ' low' : ''}`;
      rChance.innerHTML = `<span class="nm">Шанс на +${target}</span><b>${Math.round(chance * 100)}%</b>`;
      this.rowsEl.append(rChance);
    }

    // Ступени шансов; текущая подсвечена.
    const steps: [string, number, (t: number) => boolean][] = [
      ['+1 … +5', 80, (t) => t <= 5],
      ['+6 … +10', 40, (t) => t > 5 && t <= 10],
      ['+11 … +15', 20, (t) => t > 10 && t <= 15],
      ['+16 … +20', 10, (t) => t > 15],
    ];
    this.tableEl.innerHTML = steps
      .map(([label, pct, isCur]) =>
        `<div class="r${def && !atMax && isCur(target) ? ' cur' : ''}"><span>${label}</span><span>${pct}%</span></div>`)
      .join('');

    // Кнопка.
    const can = !!def && !atMax && st.scrolls > 0;
    this.goBtn.disabled = !can;
    this.goBtn.textContent = !def
      ? 'Нет оружия'
      : atMax
        ? `Предел +${SHARPEN_MAX}`
        : st.scrolls < 1
          ? 'Нет свитков — купи в магазине (O)'
          : `Заточить на +${target} (−1 свиток)`;
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
