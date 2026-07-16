import { ITEMS, rarityOf, type Icon, type Rarity, type Stack } from './items';
import { SHOP_STOCK, buyPrice, sellPrice } from './shop';

/**
 * Окно магазина. Открывается на O.
 *
 * Витрина в духе MMORPG: сетка предметов с рамками редкости и ценником, а под
 * ней — карточка выбранного с описанием и крупной кнопкой. Так удобнее, чем
 * плоский список: товары видно с одного взгляда, а решение принимаешь по деталям.
 *
 * Две вкладки — купить и продать (заказчик выбрал обе). Золото падает с монстров,
 * тратится тут. Рисуется DOM-ом поверх канваса той же рамой набора, что инвентарь
 * и умения: камера увеличена втрое, и всё в сцене раздулось бы вместе с ней.
 *
 * Само окно НЕ решает, можно ли купить-продать: шлёт намерение в сцену, а та
 * зовёт чистые buyItem/sellItem (shop.ts). Одна проверка защищает все пути.
 */

const UI = 'assets/interface/ui';
const ICONS = 'assets/interface/PNG/Icons.png';
/** Только целый масштаб: на дробном пиксели рамки поехали бы. */
const S = 3;

/** Откуда брать картинку предмета. Те же листы, что в инвентаре. */
const SHEETS: Record<Icon['sheet'], string> = {
  icons: ICONS,
  Objects: 'assets/tilesets/Objects.png',
};

/** Монета для ценников: клетка (0,1) листа иконок. */
const COIN = { x: 0, y: 16 };

/**
 * Цвета рамок редкости — те же, что в инвентаре: тон обязан отражать, как трудно
 * вещь достать. Тёмные не случайно — лежат на песочной ячейке #cda677.
 */
const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a6a48',
  uncommon: '#2f7a35',
  rare: '#2b5ea8',
  epic: '#7b3ca8',
};

type Mode = 'buy' | 'sell';

/** Один товар витрины: что показать в ячейке и в карточке. */
interface Entry {
  /** Ключ выбора: id для покупки, номер ячейки сумки — для продажи. */
  key: string;
  id: string;
  price: number;
  /** Сколько штук (для продажи стопки). */
  qty: number;
  /** По карману ли (для покупки). Для продажи всегда true. */
  affordable: boolean;
}

const CSS = `
  #shop {
    position: absolute; inset: 0; z-index: 22; display: none;
    align-items: center; justify-content: center;
    font: 12px/1.4 system-ui, sans-serif; color: #f0e0c8;
    pointer-events: none;
  }
  #shop.open { display: flex; }
  #shop * { image-rendering: pixelated; }

  #shop .win {
    pointer-events: auto; position: relative; width: 340px; max-width: 94vw;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 14px 10px;
    filter: drop-shadow(0 14px 40px rgba(0,0,0,.6));
  }
  #shop .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 15px; letter-spacing: .12em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #shop .close {
    position: absolute; top: -${13 * S}px; right: 0;
    width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #shop .close:hover { filter: brightness(1.25); }

  /* Кошелёк — на тёмной плашке, крупно: покупатель всегда видит, на что рассчитывать. */
  #shop .purse {
    display: flex; align-items: center; justify-content: center; gap: 7px;
    margin: 2px auto 9px; width: fit-content; padding: 3px 16px;
    font-size: 16px; font-weight: 700; color: #ffe08a; text-shadow: 1px 1px 0 #3e1f1d;
    background: rgba(30,20,12,.5); border: 2px solid #3e2a18; border-radius: 12px;
  }
  #shop .purse i { width: 16px; height: 16px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; }

  /* Вкладки — CSS-кнопки с рамкой со всех сторон, как в окне входа. */
  #shop .tabs { display: flex; gap: 6px; margin-bottom: 9px; }
  #shop .tab {
    flex: 1; text-align: center; cursor: pointer; padding: 9px 6px;
    font-size: 13px; font-weight: 600; color: #e6d3b0;
    background: #825c2f; border: 2px solid #3e1f1d; border-radius: 3px;
    box-shadow: inset 0 2px 0 #9c7040, inset 0 -3px 0 #5f3d22;
    text-shadow: 1px 1px 0 rgba(0,0,0,.35);
  }
  #shop .tab:hover { filter: brightness(1.08); }
  #shop .tab[aria-selected="true"] {
    color: #eaf6f0; background: #50a978; border-color: #294040;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -3px 0 #3f7168; text-shadow: 1px 1px 0 #294040;
  }
  #shop .tab.t-sell[aria-selected="true"] {
    background: #c98a2f; border-color: #5a3d18; box-shadow: inset 0 2px 0 #e6b45c, inset 0 -3px 0 #97621f;
  }

  /* Сетка товаров на светлой странице набора. */
  #shop .page {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: ${S}px;
  }
  #shop .grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
    max-height: 224px; overflow-y: auto; padding: 2px;
  }
  #shop .grid::-webkit-scrollbar { width: 8px; }
  #shop .grid::-webkit-scrollbar-thumb { background: #8a6a48; border-radius: 4px; }
  #shop .grid::-webkit-scrollbar-track { background: rgba(0,0,0,.12); border-radius: 4px; }
  #shop .empty { grid-column: 1 / -1; text-align: center; color: #7a6244; padding: 26px 8px; font-size: 12px; }

  /* Ячейка товара: песочная, с рамкой редкости и ценником внизу. */
  #shop .slot {
    position: relative; height: 58px; cursor: pointer;
    background: #cda677; border: 2px solid ${RARITY_COLOR.common}; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.18);
  }
  #shop .slot.r-uncommon { border-color: ${RARITY_COLOR.uncommon}; }
  #shop .slot.r-rare { border-color: ${RARITY_COLOR.rare}; }
  #shop .slot.r-epic { border-color: ${RARITY_COLOR.epic}; }
  #shop .slot:hover { filter: brightness(1.08); }
  #shop .slot.sel {
    outline: 3px solid #ffe08a; outline-offset: -1px;
    box-shadow: inset 0 0 0 2px rgba(255,224,138,.5), 0 0 10px rgba(255,224,138,.4);
  }
  /* Не по карману — гасим, чтобы не тянуться к недоступному. */
  #shop .slot.off { filter: grayscale(.65) brightness(.82); }
  #shop .slot .ico { transform: scale(2); transform-origin: center; margin-bottom: 8px; }
  #shop .slot .qty {
    position: absolute; top: 1px; right: 3px; font-size: 11px; font-weight: 700; color: #fff;
    text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
    font-variant-numeric: tabular-nums;
  }
  #shop .slot .cost {
    position: absolute; left: 0; right: 0; bottom: 0; height: 15px;
    display: flex; align-items: center; justify-content: center; gap: 3px;
    background: rgba(30,20,12,.62); border-radius: 0 0 1px 1px;
    font-size: 11px; font-weight: 700; color: #ffe08a; font-variant-numeric: tabular-nums;
  }
  #shop .slot.off .cost { color: #e2705f; }
  #shop .slot .cost i { width: 10px; height: 10px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; background-size: 16px 16px; }

  /* Карточка выбранного товара — на тёмной панели набора. */
  #shop .detail {
    display: flex; gap: ${2 * S}px; align-items: center; margin-top: 9px; padding: ${2 * S}px;
    border-image: url(${UI}/panel_dark.png) 2 3 4 3 fill / ${2 * S}px ${3 * S}px ${4 * S}px ${3 * S}px repeat;
    border-width: ${2 * S}px ${3 * S}px ${4 * S}px ${3 * S}px; border-style: solid;
    min-height: 56px;
  }
  #shop .dico {
    flex: none; width: 44px; height: 44px; background: #cda677;
    border: 2px solid #3e1f1d; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
  }
  #shop .dico .ico { transform: scale(2); transform-origin: center; }
  #shop .dinfo { flex: 1; min-width: 0; }
  #shop .dname { font-size: 13px; font-weight: 700; color: #ffe08a; text-shadow: 1px 1px 0 #3e1f1d; }
  #shop .ddesc { font-size: 11px; color: #d8c0a0; margin-top: 2px; line-height: 1.35; }
  #shop .dprice { display: flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 13px; font-weight: 700; color: #ffe08a; }
  #shop .dprice.no { color: #e2705f; }
  #shop .dprice i { width: 14px; height: 14px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; background-size: 16px 16px; }
  #shop .detail.blank { color: #9a835f; font-size: 12px; align-items: center; justify-content: center; text-align: center; }

  /* Крупная кнопка действия — во всю ширину. Зелёная на покупку, янтарная на продажу. */
  #shop .act {
    width: 100%; margin-top: 8px; cursor: pointer; font: inherit; font-weight: 700; font-size: 14px;
    padding: 10px 8px; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    background: #50a978; border: 2px solid #294040; border-radius: 4px;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -3px 0 #3f7168;
  }
  #shop .act.sell { background: #c98a2f; border-color: #5a3d18; box-shadow: inset 0 2px 0 #e6b45c, inset 0 -3px 0 #97621f; }
  #shop .act:hover:not(:disabled) { filter: brightness(1.1); }
  #shop .act:active:not(:disabled) { transform: translateY(1px); }
  #shop .act:disabled {
    cursor: default; color: #a08a6a; background: #b79b74; border-color: #6b5433;
    box-shadow: none; text-shadow: none;
  }

  #shop .hint { margin-top: 7px; min-height: 15px; font-size: 12px; text-align: center; color: #6b5433; }
`;

export class ShopUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private purse: HTMLElement;
  private grid: HTMLElement;
  private detail: HTMLElement;
  private actBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  private tabsEl: HTMLElement;
  private mode: Mode = 'buy';
  private bag: (Stack | null)[] = [];
  private gold: () => number = () => 0;
  /** Выбранный товар: id (покупка) или номер ячейки (продажа). Своё на каждую вкладку. */
  private selBuy: string | null = null;
  private selSell: number | null = null;
  private key = '';

  /** Игрок купил предмет по id. */
  onBuy: (id: string) => void = () => {};
  /** Игрок продал предмет из ячейки сумки. */
  onSell: (index: number) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'shop';
    this.root.innerHTML = `
      <div class="win">
        <div class="title">Магазин</div>
        <div class="close" title="Закрыть (O)"></div>
        <div class="purse"><i></i><span class="g">0</span></div>
        <div class="tabs">
          <div class="tab t-buy" data-mode="buy">Купить</div>
          <div class="tab t-sell" data-mode="sell">Продать</div>
        </div>
        <div class="page"><div class="grid"></div></div>
        <div class="detail blank"></div>
        <button class="act"></button>
        <div class="hint"></div>
      </div>
    `;
    document.body.append(this.root);

    this.purse = this.root.querySelector('.purse .g')!;
    this.grid = this.root.querySelector('.grid')!;
    this.detail = this.root.querySelector('.detail')!;
    this.actBtn = this.root.querySelector('.act')!;
    this.hintEl = this.root.querySelector('.hint')!;
    this.tabsEl = this.root.querySelector('.tabs')!;

    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    for (const t of this.tabsEl.querySelectorAll<HTMLElement>('.tab')) {
      t.onclick = () => {
        this.mode = t.dataset.mode as Mode;
        this.key = '';
        this.hintEl.textContent = '';
        this.render();
      };
    }
    this.actBtn.onclick = () => this.act();
  }

  setBag(bag: (Stack | null)[]): void {
    this.bag = bag;
  }

  setGold(get: () => number): void {
    this.gold = get;
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
    this.hintEl.textContent = '';
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** Короткий отклик на действие: «куплено», «не хватает золота». Живёт до следующего. */
  flash(msg: string, ok = true): void {
    this.hintEl.textContent = msg;
    this.hintEl.style.color = ok ? '#2f7a2f' : '#c14a38';
  }

  /** Кусок листа как фон — так же рисует иконки инвентарь. */
  private iconEl(icon: Icon): HTMLElement {
    const el = document.createElement('i');
    el.className = 'ico';
    el.style.backgroundImage = `url(${SHEETS[icon.sheet]})`;
    el.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
    el.style.width = `${icon.w}px`;
    el.style.height = `${icon.h}px`;
    return el;
  }

  /** Что показывать в сетке для текущей вкладки. */
  private entries(gold: number): Entry[] {
    if (this.mode === 'buy') {
      const out: Entry[] = [];
      for (const id of SHOP_STOCK) {
        const price = buyPrice(id);
        if (!ITEMS[id] || price == null) continue;
        out.push({ key: id, id, price, qty: 1, affordable: gold >= price });
      }
      return out;
    }
    // Продажа: продаваемые ячейки сумки. Ключ — номер ячейки (стопки отдельные).
    const out: Entry[] = [];
    this.bag.forEach((slot, index) => {
      if (!slot) return;
      const price = sellPrice(slot.id);
      if (!ITEMS[slot.id] || price <= 0) return;
      out.push({ key: String(index), id: slot.id, price, qty: slot.qty, affordable: true });
    });
    return out;
  }

  private get sel(): string | null {
    return this.mode === 'buy' ? this.selBuy : this.selSell === null ? null : String(this.selSell);
  }

  private setSel(key: string | null): void {
    if (this.mode === 'buy') this.selBuy = key;
    else this.selSell = key === null ? null : Number(key);
  }

  /**
   * Перерисовать, если что-то изменилось. Зовётся каждый кадр, пока окно открыто
   * (золото капает, сумка меняется), поэтому сравниваем со снимком. Выбор — часть
   * снимка: сменил товар — обновилась карточка.
   */
  render(): void {
    if (!this.isOpen) return;
    const gold = this.gold();
    const list = this.entries(gold);

    // Проверяем выбор: после продажи ячейка могла опустеть, стопка — сдвинуться.
    if (!list.some((e) => e.key === this.sel)) this.setSel(list[0]?.key ?? null);

    const sig = list.map((e) => `${e.key}:${e.id}:${e.qty}:${e.affordable ? 1 : 0}`).join(',');
    const key = `${this.mode}|${gold}|${sig}|${this.sel}`;
    if (key === this.key) return;
    this.key = key;

    this.purse.textContent = String(gold);
    for (const t of this.tabsEl.querySelectorAll<HTMLElement>('.tab')) {
      t.setAttribute('aria-selected', String(t.dataset.mode === this.mode));
    }

    this.renderGrid(list);
    this.renderDetail(list.find((e) => e.key === this.sel) ?? null);
  }

  private renderGrid(list: Entry[]): void {
    this.grid.innerHTML = '';
    if (!list.length) {
      this.grid.innerHTML =
        this.mode === 'sell'
          ? '<div class="empty">Продавать нечего.<br>Набей сумку добычей.</div>'
          : '<div class="empty">Лавка пуста.</div>';
      return;
    }

    for (const e of list) {
      const def = ITEMS[e.id];
      const slot = document.createElement('div');
      slot.className = `slot r-${rarityOf(e.id)}`;
      if (e.key === this.sel) slot.classList.add('sel');
      // Гасим только недоступное при покупке; на продаже всё доступно.
      if (this.mode === 'buy' && !e.affordable) slot.classList.add('off');
      slot.title = def.name;

      slot.append(this.iconEl(def.icon));
      if (e.qty > 1) {
        slot.append(Object.assign(document.createElement('span'), { className: 'qty', textContent: `×${e.qty}` }));
      }
      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.innerHTML = `<i></i>${e.price}`;
      slot.append(cost);

      slot.onclick = () => {
        this.setSel(e.key);
        this.key = ''; // выбор изменился — перерисовать карточку и подсветку
        this.render();
      };
      this.grid.append(slot);
    }
  }

  private renderDetail(e: Entry | null): void {
    if (!e) {
      this.detail.className = 'detail blank';
      this.detail.textContent = this.mode === 'sell' ? 'Выбери, что продать.' : 'Выбери товар.';
      this.actBtn.style.display = 'none';
      return;
    }

    const def = ITEMS[e.id];
    this.detail.className = 'detail';
    this.detail.innerHTML = '';

    const dico = document.createElement('div');
    dico.className = 'dico';
    dico.append(this.iconEl(def.icon));

    const info = document.createElement('div');
    info.className = 'dinfo';
    const desc = this.effect(e.id);
    const priceNo = this.mode === 'buy' && !e.affordable;
    info.innerHTML =
      `<div class="dname">${def.name}${e.qty > 1 ? ` <span style="color:#d8c0a0;font-weight:400">×${e.qty}</span>` : ''}</div>` +
      (desc ? `<div class="ddesc">${desc}</div>` : '') +
      `<div class="dprice${priceNo ? ' no' : ''}"><i></i>${e.price}${this.mode === 'sell' ? ' за штуку' : ''}</div>`;

    this.detail.append(dico, info);

    this.actBtn.style.display = '';
    this.actBtn.className = `act${this.mode === 'sell' ? ' sell' : ''}`;
    this.actBtn.disabled = this.mode === 'buy' && !e.affordable;
    this.actBtn.textContent = this.mode === 'buy' ? (e.affordable ? 'Купить' : 'Не хватает золота') : 'Продать';
  }

  /** Нажали большую кнопку: шлём намерение сцене. Проверки — у неё. */
  private act(): void {
    const sel = this.sel;
    if (sel === null) return;
    if (this.mode === 'buy') this.onBuy(sel);
    else this.onSell(Number(sel));
  }

  /** Короткая приписка, что предмет делает: чтобы покупали со смыслом. */
  private effect(id: string): string {
    const def = ITEMS[id];
    const parts: string[] = [];
    if (def.ranged) parts.push('стреляет стрелами');
    if (def.use?.hp) parts.push(`+${def.use.hp} здоровья`);
    if (def.use?.mp) parts.push(`+${def.use.mp} маны`);
    if (def.bonus?.dmg) parts.push(`+${def.bonus.dmg} к атаке`);
    if (def.bonus?.def) parts.push(`+${def.bonus.def} к защите`);
    if (def.bonus?.speed) parts.push(`${def.bonus.speed > 0 ? '+' : ''}${def.bonus.speed} к скорости`);
    if (def.bonus?.hp) parts.push(`+${def.bonus.hp} к здоровью`);
    if (def.bonus?.mp) parts.push(`+${def.bonus.mp} к мане`);
    return parts.join(', ');
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
