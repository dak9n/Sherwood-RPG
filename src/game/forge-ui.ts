import { ITEMS, rarityOf, RARITY_NAME, type Icon, type Rarity } from './items';
import { SHARPEN_MAX, sharpenChance } from './forge';

/**
 * Окно кузницы. Открывается на K.
 *
 * Три панели, как в больших MMORPG (заказчик показал образец): слева — выбор
 * оружия из своего добра, в центре — само улучшение (уровень, шанс, свитки,
 * кнопка), справа — характеристики выбранного сейчас и после заточки.
 *
 * Всё в окне — правда нашей игры, а не картинки-образца: платы золотом нет,
 * уровень при неудаче НЕ падает (сгорает только свиток), свитки берутся только
 * в магазине. Чего игра не делает — того окно не обещает.
 *
 * Точить можно ЛЮБОЕ своё оружие — надетое или из сумки. Заточка числится за
 * КОНКРЕТНЫМ мечом (см. forge.ts), поэтому одинаковые мечи — это разные ячейки,
 * и каждая точится сама по себе.
 *
 * Окно шлёт намерение в сцену, а решает чистая trySharpen — как у магазина.
 */

const UI = 'assets/interface/ui';
const ICONS = 'assets/interface/PNG/Icons.png';
/** Лист с окном крафта: оттуда наковальня — эмблема кузницы. */
const CRAFT = 'assets/interface/PNG/Craft.png';
/** Наковальня в листе крафта (замерено по пикселям). */
const ANVIL = { x: 537, y: 388, w: 40, h: 25 };
/** Только целый масштаб: на дробном пиксели рамки поехали бы. */
const S = 3;

const SHEETS: Record<Icon['sheet'], string> = {
  icons: ICONS,
  Objects: 'assets/tilesets/Objects.png',
  scroll: `${UI}/scroll.png`,
  armor: 'assets/armor-icons/armor_atlas.png',
};

/** Рамки редкости — те же, что в инвентаре и магазине. */
const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a6a48',
  uncommon: '#2f7a35',
  rare: '#2b5ea8',
  epic: '#7b3ca8',
};

/** Один ЭКЗЕМПЛЯР оружия игрока в списке слева. */
export interface ForgeWeapon {
  /** Адрес экземпляра: 'equipped' или 'bag:<индекс>'. По нему сцена его и найдёт. */
  key: string;
  id: string;
  plus: number;
  /** Надето сейчас — помечаем: его заточка работает в бою прямо сейчас. */
  equipped: boolean;
}

/** Что окно знает о герое. Сцена отдаёт живые данные, окно только рисует. */
export interface ForgeState {
  /** Все экземпляры оружия у игрока: надетое первым, дальше по сумке. Одинаковые
   *  мечи — РАЗНЫЕ ячейки: каждый точится сам по себе. */
  weapons: ForgeWeapon[];
  /** Сколько свитков в сумке. */
  scrolls: number;
}

const CSS = `
  #forge {
    position: absolute; inset: 0; z-index: 23; display: none;
    align-items: center; justify-content: center;
    font: var(--fs-body)/1.4 var(--font-family); color: var(--ink);
    pointer-events: none;
  }
  #forge.open { display: flex; }
  #forge * { image-rendering: pixelated; }
  #forge i { display: block; }

  #forge .win {
    pointer-events: auto; position: relative; width: 680px; max-width: 97vw;
    border-width: var(--frame-window-w); border-image: var(--frame-window);
    border-style: solid;
    padding: 4px 14px 10px;
    filter: drop-shadow(0 16px 44px rgba(0,0,0,.62));
  }
  #forge .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: var(--fw-bold); font-size: var(--fs-lg); letter-spacing: .1em; text-transform: uppercase;
    color: var(--ink-bright); text-shadow: var(--text-shadow-teal);
  }
  #forge .close {
    position: absolute; top: -${13 * S}px; right: 0;
    width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #forge .close:hover { filter: brightness(1.25); }

  #forge .body { display: flex; gap: 10px; align-items: stretch; }
  #forge .colL { width: 196px; flex: none; display: flex; flex-direction: column; }
  #forge .colC { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  #forge .colR { width: 208px; flex: none; display: flex; flex-direction: column; gap: 8px; }

  #forge .phead {
    margin: 0 2px 6px; font-size: var(--fs-small); font-weight: var(--fw-bold); color: var(--gold-soft);
    text-shadow: var(--text-shadow-maroon); text-transform: uppercase; letter-spacing: .05em;
    text-align: center;
  }

  #forge .page {
    border-width: var(--frame-beige-w); border-image: var(--frame-beige);
    border-style: solid;
    padding: ${S}px; color: var(--ink-dark); flex: 1;
  }
  #forge .dark {
    border-width: var(--frame-dark-w); border-image: var(--frame-dark);
    border-style: solid;
    padding: ${2 * S}px;
  }

  /* --- Слева: выбор оружия --- */
  #forge .wgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; align-content: start; }
  #forge .slot {
    position: relative; height: 42px; cursor: pointer;
    background: var(--slot-bg); border: 2px solid ${RARITY_COLOR.common}; border-radius: var(--radius-2);
    display: flex; align-items: center; justify-content: center;
    box-shadow: inset 0 1px 0 var(--edge-hi);
  }
  #forge .slot.r-uncommon { border-color: ${RARITY_COLOR.uncommon}; }
  #forge .slot.r-rare { border-color: ${RARITY_COLOR.rare}; }
  #forge .slot.r-epic { border-color: ${RARITY_COLOR.epic}; }
  #forge .slot:hover { filter: brightness(1.09); }
  #forge .slot.sel {
    outline: 3px solid var(--gold); outline-offset: -1px;
    box-shadow: inset 0 0 0 2px rgba(255,207,90,.45), 0 0 8px var(--gold-glow);
  }
  #forge .slot .ico { transform: scale(1.8); transform-origin: center; }
  #forge .slot .plus {
    position: absolute; bottom: 0; right: 2px; font-size: var(--fs-tiny); font-weight: var(--fw-bold); color: var(--white);
    text-shadow: var(--text-outline-4way);
  }
  #forge .slot .on {
    position: absolute; top: 0; left: 2px; font-size: 8px; font-weight: var(--fw-bold); color: var(--ink-bright);
    background: var(--green); border-radius: var(--radius-1); padding: 0 2px; text-shadow: none;
  }
  #forge .empty { grid-column: 1 / -1; text-align: center; color: #7a6244; padding: 18px 6px; font-size: var(--fs-small); }

  /* --- Центр: улучшение --- */
  #forge .anvil {
    width: ${ANVIL.w}px; height: ${ANVIL.h}px; margin: 2px auto 8px;
    background: url(${CRAFT}) -${ANVIL.x}px -${ANVIL.y}px;
    transform: scale(1.6); transform-origin: center;
  }
  #forge .big {
    width: 64px; height: 64px; margin: 0 auto; position: relative;
    background: var(--slot-bg); border: 3px solid var(--gold); border-radius: var(--radius-3);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 12px rgba(255,207,90,.35);
  }
  #forge .big .ico { transform: scale(3); transform-origin: center; }
  #forge .big .plus {
    position: absolute; bottom: 1px; right: 3px; font-size: var(--fs-body); font-weight: var(--fw-bold); color: var(--white);
    text-shadow: var(--text-outline-4way);
  }
  #forge .wname { text-align: center; font-size: var(--fs-md); font-weight: var(--fw-bold); margin-top: 6px; color: var(--rarity-rare); }

  #forge .lvlrow {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    margin-top: 8px; font-size: var(--fs-display); font-weight: 800; font-variant-numeric: tabular-nums;
  }
  #forge .lvlrow .cur { color: #7a5a1a; }
  #forge .lvlrow .arr { color: var(--amber); font-size: var(--fs-xl); }
  #forge .lvlrow .next { color: var(--rarity-uncommon); }
  #forge .lvlrow .max { font-size: var(--fs-lg); color: #7a6244; font-weight: var(--fw-bold); }
  #forge .sub { text-align: center; font-size: var(--fs-small); color: #7a6244; margin-top: 2px; }
  #forge .chance { text-align: center; font-size: var(--fs-md); margin-top: 6px; color: var(--ink-dark); }
  #forge .chance b { font-size: var(--fs-xl); color: var(--rarity-uncommon); }
  #forge .chance.low b { color: var(--danger); }

  #forge .need {
    display: flex; align-items: center; gap: 8px; margin: 10px 4px 0; padding: 6px 8px;
    background: rgba(90,60,35,.14); border: 1px solid #cdb488; border-radius: var(--radius-3);
  }
  #forge .need .ico { flex: none; }
  #forge .need .nm { flex: 1; font-size: var(--fs-body); }
  #forge .need b { font-variant-numeric: tabular-nums; }
  #forge .need .short { color: var(--danger); }

  #forge .go {
    width: 100%; margin-top: 10px; cursor: pointer; font: inherit; font-weight: var(--fw-bold); font-size: var(--fs-lg);
    padding: 11px 8px; color: var(--ink-bright); text-shadow: var(--text-shadow-teal);
    background: var(--green); border: 2px solid var(--shadow-teal); border-radius: var(--radius-3);
    box-shadow: var(--bevel-green);
    text-transform: uppercase; letter-spacing: .06em;
  }
  #forge .go:hover:not(:disabled) { filter: brightness(1.1); }
  #forge .go:active:not(:disabled) { transform: translateY(1px); }
  #forge .go:disabled {
    cursor: default; color: var(--disabled-text); background: var(--disabled-bg); border-color: var(--disabled-border);
    box-shadow: none; text-shadow: none;
  }
  #forge .msg { margin-top: 7px; min-height: 15px; font-size: var(--fs-body); text-align: center; color: var(--tan-dim); }

  /* --- Справа: характеристики --- */
  #forge .card { display: flex; gap: 8px; align-items: center; }
  #forge .cico {
    flex: none; width: 40px; height: 40px; background: var(--slot-bg);
    border: 2px solid var(--wood-shadow); border-radius: var(--radius-2);
    display: flex; align-items: center; justify-content: center;
  }
  #forge .cico .ico { transform: scale(1.9); transform-origin: center; }
  #forge .cinfo { flex: 1; min-width: 0; font-size: var(--fs-small); color: var(--tan); line-height: 1.5; }
  #forge .cinfo .nm { font-size: var(--fs-body); font-weight: var(--fw-bold); color: var(--rarity-rare-text); }
  #forge .cinfo .rar-common { color: var(--tan); }
  #forge .cinfo .rar-uncommon { color: var(--rarity-uncommon-text); }
  #forge .cinfo .rar-rare { color: var(--rarity-rare-text); }
  #forge .cinfo .rar-epic { color: var(--rarity-epic-text); }

  #forge .stats { font-size: var(--fs-small); }
  #forge .stats .h { font-weight: var(--fw-bold); color: var(--rarity-uncommon-text); margin-bottom: 3px; }
  #forge .stats .h.next { color: var(--rarity-uncommon-text); }
  #forge .stats .r { display: flex; justify-content: space-between; padding: 1px 0; color: var(--tan); }
  #forge .stats .r b { color: var(--ink); font-variant-numeric: tabular-nums; }
  #forge .stats .r .up { color: var(--rarity-uncommon-text); }

  #forge .about { font-size: var(--fs-tiny); color: #b8a284; line-height: 1.5; }
  #forge .about .h { font-weight: var(--fw-bold); color: var(--gold-soft); font-size: var(--fs-small); margin-bottom: 3px; }
  #forge .about .steps { margin-top: 4px; color: var(--tan-dim); }
`;

export class ForgeUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private wgrid: HTMLElement;
  private center: HTMLElement;
  private card: HTMLElement;
  private statsEl: HTMLElement;
  private goBtn!: HTMLButtonElement;
  private msgEl!: HTMLElement;
  private state: () => ForgeState = () => ({ weapons: [], scrolls: 0 });
  private selected: string | null = null;
  private key = '';
  /** Отложенный текст сообщения: flash приходит ДО перерисовки центра. */
  private msgText = '';
  private msgColor = '#9a835f';

  /** Игрок жмёт «Улучшить» по выбранному оружию: адрес экземпляра + его вид (для
   *  сверки на стороне сцены). Решает сцена через trySharpen. */
  onSharpen: (key: string, id: string) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'forge';
    this.root.innerHTML = `
      <div class="win">
        <div class="title">Forge — Weapon Upgrade</div>
        <div class="close" title="Close (K)"></div>
        <div class="body">
          <div class="colL">
            <div class="phead">Your Weapons</div>
            <div class="page"><div class="wgrid"></div></div>
          </div>
          <div class="colC">
            <div class="phead">Selected Item</div>
            <div class="page"><div class="center"></div></div>
          </div>
          <div class="colR">
            <div class="dark card"></div>
            <div class="dark stats"></div>
            <div class="dark about">
              <div class="h">About Sharpening Scrolls</div>
              Scrolls are sold in the shop (O). An attempt consumes one scroll;
              failure does NOT lower the upgrade.
              <div class="steps">Chances: +1–5 · 80%, +6–10 · 40%,<br>+11–15 · 20%, +16–20 · 10%</div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.append(this.root);

    this.wgrid = this.root.querySelector('.wgrid')!;
    this.center = this.root.querySelector('.center')!;
    this.card = this.root.querySelector('.card')!;
    this.statsEl = this.root.querySelector('.stats')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
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
    this.msgText = '';
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** Итог попытки: зелёный успех или красная неудача. Живёт до следующей. */
  flash(msg: string, ok = true): void {
    this.msgText = msg;
    this.msgColor = ok ? '#2f7a35' : '#a33b2e';
    if (this.msgEl) {
      this.msgEl.textContent = msg;
      this.msgEl.style.color = this.msgColor;
    }
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

    // Выбор обязан указывать на живой экземпляр: надетое — первым по умолчанию.
    if (!st.weapons.some((w) => w.key === this.selected)) {
      this.selected = st.weapons[0]?.key ?? null;
    }

    const sig = st.weapons.map((w) => `${w.key}:${w.id}:${w.plus}:${w.equipped ? 1 : 0}`).join(',');
    const key = `${sig}|${st.scrolls}|${this.selected}`;
    if (key === this.key) return;
    this.key = key;

    this.renderGrid(st);
    const sel = st.weapons.find((w) => w.key === this.selected) ?? null;
    this.renderCenter(sel, st.scrolls);
    this.renderRight(sel);
  }

  private renderGrid(st: ForgeState): void {
    this.wgrid.innerHTML = '';
    if (!st.weapons.length) {
      this.wgrid.innerHTML = '<div class="empty">No weapons.<br>Buy in the shop (O) or drop them from monsters.</div>';
      return;
    }
    for (const w of st.weapons) {
      const def = ITEMS[w.id];
      const slot = document.createElement('div');
      slot.className = `slot r-${rarityOf(w.id)}${w.key === this.selected ? ' sel' : ''}`;
      slot.title = `${def.name} +${w.plus}${w.equipped ? ' (equipped)' : ''}`;
      slot.append(this.iconEl(def.icon));
      slot.append(Object.assign(document.createElement('span'), { className: 'plus', textContent: `+${w.plus}` }));
      if (w.equipped) {
        slot.append(Object.assign(document.createElement('span'), { className: 'on', textContent: 'equipped' }));
      }
      slot.onclick = () => {
        this.selected = w.key;
        this.key = '';
        this.msgText = '';
        this.render();
      };
      this.wgrid.append(slot);
    }
  }

  private renderCenter(sel: ForgeWeapon | null, scrolls: number): void {
    this.center.innerHTML = '';
    const scrollDef = ITEMS.scroll_sharpen;

    if (!sel) {
      this.center.innerHTML = '<div class="empty" style="padding:30px 8px">Select a weapon on the left.</div>';
      return;
    }

    const def = ITEMS[sel.id];
    const atMax = sel.plus >= SHARPEN_MAX;
    const target = sel.plus + 1;
    const chance = atMax ? 0 : sharpenChance(target);

    const anvil = document.createElement('div');
    anvil.className = 'anvil';

    const big = document.createElement('div');
    big.className = 'big';
    big.append(this.iconEl(def.icon));
    big.append(Object.assign(document.createElement('span'), { className: 'plus', textContent: `+${sel.plus}` }));

    const name = document.createElement('div');
    name.className = 'wname';
    name.textContent = def.name;

    const lvl = document.createElement('div');
    lvl.className = 'lvlrow';
    lvl.innerHTML = atMax
      ? `<span class="max">Sharpened to max +${SHARPEN_MAX}</span>`
      : `<span class="cur">+${sel.plus}</span><span class="arr">➜</span><span class="next">+${target}</span>`;

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = 'Upgrade level';

    this.center.append(anvil, big, name, sub, lvl);

    if (!atMax) {
      const ch = document.createElement('div');
      ch.className = `chance${chance < 0.4 ? ' low' : ''}`;
      ch.innerHTML = `Success chance: <b>${Math.round(chance * 100)}%</b>`;
      this.center.append(ch);

      const need = document.createElement('div');
      need.className = 'need';
      const enough = scrolls >= 1;
      need.append(this.iconEl(scrollDef.icon));
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.innerHTML = `${scrollDef.name} ×1 <b class="${enough ? '' : 'short'}">(have ${scrolls})</b>`;
      need.append(nm);
      this.center.append(need);
    }

    this.goBtn = document.createElement('button');
    this.goBtn.className = 'go';
    const can = !atMax && scrolls >= 1;
    this.goBtn.disabled = !can;
    this.goBtn.textContent = atMax ? `Max +${SHARPEN_MAX}` : scrolls < 1 ? 'No scrolls' : 'Upgrade';
    this.goBtn.onclick = () => this.onSharpen(sel.key, sel.id);
    this.center.append(this.goBtn);

    this.msgEl = document.createElement('div');
    this.msgEl.className = 'msg';
    this.msgEl.textContent = this.msgText || 'Failure burns the scroll but does not lower the upgrade.';
    this.msgEl.style.color = this.msgText ? this.msgColor : '#9a835f';
    this.center.append(this.msgEl);
  }

  private renderRight(sel: ForgeWeapon | null): void {
    if (!sel) {
      this.card.innerHTML = '<span style="font-size:var(--fs-small);color:var(--tan-dim)">No weapon selected.</span>';
      this.statsEl.innerHTML = '';
      return;
    }

    const def = ITEMS[sel.id];
    const rarity = rarityOf(sel.id);
    const base = def.bonus?.dmg ?? 0;
    const atMax = sel.plus >= SHARPEN_MAX;

    // Карточка: тип и редкость — правда из таблицы предметов.
    this.card.innerHTML = '';
    const cico = document.createElement('div');
    cico.className = 'cico';
    cico.append(this.iconEl(def.icon));
    const cinfo = document.createElement('div');
    cinfo.className = 'cinfo';
    cinfo.innerHTML =
      `<div class="nm">${def.name}</div>` +
      `Type: ${def.ranged ? 'Bow' : 'Sword'}<br>` +
      `Rarity: <span class="rar-${rarity}">${RARITY_NAME[rarity]}</span>`;
    this.card.append(cico, cinfo);

    // Характеристики: у нашего оружия одна боевая цифра — прибавка к атаке.
    // Показываем её сейчас и после удачной заточки; выдумывать силу и криты,
    // которых в игре нет, нельзя.
    const rows = (plus: number): string => {
      const parts = [
        `<div class="r"><span>Attack bonus</span><b>+${base + plus}</b></div>`,
        `<div class="r"><span>From sharpening</span><b>+${plus}</b></div>`,
      ];
      if (def.ranged) parts.push(`<div class="r"><span>Combat</span><b>ranged, with arrows</b></div>`);
      return parts.join('');
    };

    this.statsEl.innerHTML =
      `<div class="h">Now (+${sel.plus})</div>${rows(sel.plus)}` +
      (atMax
        ? ''
        : `<div class="h next" style="margin-top:7px">After sharpening (+${sel.plus + 1})</div>` +
          `<div class="r"><span>Attack bonus</span><b class="up">+${base + sel.plus + 1} ↑</b></div>`);
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
