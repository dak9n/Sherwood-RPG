import { ITEMS, type Icon, type Stack } from './items';
import { SHOP_STOCK, buyPrice, sellPrice } from './shop';

/**
 * Окно магазина. Открывается на O.
 *
 * Две вкладки: купить и продать (заказчик выбрал обе). Золото падает с монстров,
 * тратится тут. Рисуется DOM-ом поверх канваса той же рамой набора, что инвентарь
 * и умения: камера увеличена втрое, и всё в сцене раздулось бы вместе с ней.
 *
 * Само окно НЕ решает, можно ли купить-продать: оно шлёт намерение в сцену, а та
 * зовёт чистые buyItem/sellItem (shop.ts). Так одна и та же проверка защищает и
 * клик по кнопке, и любой другой путь.
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

/** Монета для строки золота: клетка (0,1) листа иконок. */
const COIN = { x: 0, y: 16 };

type Mode = 'buy' | 'sell';

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
    pointer-events: auto; position: relative; width: 300px;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 14px 8px;
    filter: drop-shadow(0 12px 34px rgba(0,0,0,.55));
  }
  #shop .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 14px; letter-spacing: .1em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #shop .close {
    position: absolute; top: -${13 * S}px; right: 0;
    width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #shop .close:hover { filter: brightness(1.25); }

  /* Строка золота — над вкладками, всегда на виду: покупатель должен видеть кошелёк. */
  #shop .purse {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    margin: 2px 0 8px; font-size: 14px; font-weight: 700; color: #ffe08a;
    text-shadow: 1px 1px 0 #3e1f1d;
  }
  #shop .purse i { width: 16px; height: 16px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; }

  /* Вкладки — те же CSS-кнопки, что в окне входа: рамка со всех сторон. */
  #shop .tabs { display: flex; gap: 6px; margin-bottom: 8px; }
  #shop .tab {
    flex: 1; text-align: center; cursor: pointer; padding: 8px 6px;
    font-size: 12px; font-weight: 600; color: #e6d3b0;
    background: #825c2f; border: 2px solid #3e1f1d; border-radius: 3px;
    box-shadow: inset 0 2px 0 #9c7040, inset 0 -3px 0 #5f3d22;
    text-shadow: 1px 1px 0 rgba(0,0,0,.35);
  }
  #shop .tab:hover { filter: brightness(1.08); }
  #shop .tab[aria-selected="true"] {
    color: #eaf6f0; background: #50a978; border-color: #294040;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -3px 0 #3f7168; text-shadow: 1px 1px 0 #294040;
  }

  #shop .page {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: ${S}px ${2 * S}px; color: #2b1d12;
  }
  /* Список прокручивается: на продажу может уйти вся сумка, а окно не должно расти. */
  #shop .list { max-height: 260px; overflow-y: auto; }
  #shop .empty { text-align: center; color: #7a6244; padding: 20px 8px; font-size: 12px; }

  #shop .row { display: flex; align-items: center; gap: 8px; padding: 5px 2px; }
  #shop .row + .row { border-top: 1px solid #cdb488; }
  #shop .row > .ico { width: 16px; height: 16px; flex: none; }
  #shop .row .nm { flex: 1; font-size: 12px; }
  #shop .row .nm small { display: block; color: #7a6244; font-size: 10px; }
  #shop .row .price { display: flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; font-weight: 700; color: #7a5a1a; }
  #shop .row .price i { width: 16px; height: 16px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; }

  /* Кнопка действия — CSS-кнопка с рамкой: зелёная на покупку, янтарная на продажу. */
  #shop .act {
    flex: none; min-width: 62px; text-align: center; cursor: pointer;
    padding: 5px 8px; font-size: 11px; font-weight: 700; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    background: #50a978; border: 2px solid #294040; border-radius: 3px;
    box-shadow: inset 0 2px 0 #74cf8d, inset 0 -2px 0 #3f7168;
  }
  #shop .act.sell { background: #c98a2f; border-color: #5a3d18; box-shadow: inset 0 2px 0 #e6b45c, inset 0 -2px 0 #97621f; }
  #shop .act:hover { filter: brightness(1.1); }
  #shop .act:active { box-shadow: inset 0 2px 4px rgba(0,0,0,.4); }
  #shop .act.off {
    cursor: default; color: #a08a6a; background: #b79b74; border-color: #6b5433;
    box-shadow: none; filter: none;
  }

  #shop .hint { margin-top: 8px; font-size: 11px; color: #6b5433; text-align: center; }
`;

export class ShopUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private purse: HTMLElement;
  private list: HTMLElement;
  private tabsEl: HTMLElement;
  private hintEl: HTMLElement;
  private mode: Mode = 'buy';
  private bag: (Stack | null)[] = [];
  private gold: () => number = () => 0;
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
          <div class="tab" data-mode="buy">Купить</div>
          <div class="tab" data-mode="sell">Продать</div>
        </div>
        <div class="page"><div class="list"></div></div>
        <div class="hint"></div>
      </div>
    `;
    document.body.append(this.root);

    this.purse = this.root.querySelector('.purse .g')!;
    this.list = this.root.querySelector('.list')!;
    this.tabsEl = this.root.querySelector('.tabs')!;
    this.hintEl = this.root.querySelector('.hint')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());

    for (const t of this.tabsEl.querySelectorAll<HTMLElement>('.tab')) {
      t.onclick = () => {
        this.mode = t.dataset.mode as Mode;
        this.key = ''; // сменили вкладку — перерисовать заново
        this.render();
      };
    }
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
    this.hintEl.style.color = ok ? '#2f7a2f' : '#a33b2e';
  }

  /** Кусок листа как фон — так же рисует иконки инвентарь. */
  private iconEl(icon: Icon): HTMLElement {
    const el = document.createElement('i');
    el.className = 'ico';
    el.style.backgroundImage = `url(${SHEETS[icon.sheet]})`;
    el.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
    // Клетки предметов бывают не 16x16 (грибы 14x12) — задаём точный размер.
    el.style.width = `${icon.w}px`;
    el.style.height = `${icon.h}px`;
    return el;
  }

  /**
   * Перерисовать, если что-то изменилось. Зовётся каждый кадр, пока окно открыто
   * (золото капает с монстров, сумка меняется), поэтому сравниваем со снимком.
   */
  render(): void {
    if (!this.isOpen) return;
    const gold = this.gold();
    const bagSig = this.mode === 'sell' ? this.bag.map((s) => (s ? `${s.id}:${s.qty}` : '_')).join(',') : '';
    const key = `${this.mode}|${gold}|${bagSig}`;
    if (key === this.key) return;
    this.key = key;

    this.purse.textContent = String(gold);
    for (const t of this.tabsEl.querySelectorAll<HTMLElement>('.tab')) {
      t.setAttribute('aria-selected', String(t.dataset.mode === this.mode));
    }

    this.list.innerHTML = '';
    if (this.mode === 'buy') this.renderBuy(gold);
    else this.renderSell();
  }

  private renderBuy(gold: number): void {
    for (const id of SHOP_STOCK) {
      const def = ITEMS[id];
      const price = buyPrice(id);
      if (!def || price == null) continue;
      const afford = gold >= price;
      this.addRow(def.icon, def.name, this.effect(id), price, afford ? 'Купить' : 'Дорого', afford, () =>
        this.onBuy(id),
      );
    }
  }

  private renderSell(): void {
    let any = false;
    this.bag.forEach((slot, index) => {
      if (!slot) return;
      const def = ITEMS[slot.id];
      const price = sellPrice(slot.id);
      if (!def || price <= 0) return;
      any = true;
      const name = slot.qty > 1 ? `${def.name} ×${slot.qty}` : def.name;
      this.addRow(def.icon, name, `за штуку`, price, 'Продать', true, () => this.onSell(index), true);
    });
    if (!any) {
      this.list.innerHTML = '<div class="empty">Продавать нечего.<br>Заполни сумку добычей.</div>';
    }
  }

  private addRow(
    icon: Icon,
    name: string,
    sub: string,
    price: number,
    label: string,
    enabled: boolean,
    onClick: () => void,
    sell = false,
  ): void {
    const row = document.createElement('div');
    row.className = 'row';

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.innerHTML = `${name}<small>${sub}</small>`;

    const priceEl = document.createElement('span');
    priceEl.className = 'price';
    priceEl.innerHTML = `<i></i>${price}`;

    const btn = document.createElement('span');
    btn.className = `act${sell ? ' sell' : ''}${enabled ? '' : ' off'}`;
    btn.textContent = label;
    if (enabled) btn.onclick = onClick;

    row.append(this.iconEl(icon), nm, priceEl, btn);
    this.list.append(row);
  }

  /** Короткая приписка, что предмет делает: чтобы покупали со смыслом. */
  private effect(id: string): string {
    const def = ITEMS[id];
    const parts: string[] = [];
    if (def.use?.hp) parts.push(`+${def.use.hp} здоровья`);
    if (def.use?.mp) parts.push(`+${def.use.mp} маны`);
    if (def.bonus?.dmg) parts.push(`+${def.bonus.dmg} к атаке`);
    if (def.bonus?.def) parts.push(`+${def.bonus.def} к защите`);
    if (def.bonus?.speed) parts.push(`${def.bonus.speed > 0 ? '+' : ''}${def.bonus.speed} к скорости`);
    if (def.bonus?.hp) parts.push(`+${def.bonus.hp} к здоровью`);
    if (def.bonus?.mp) parts.push(`+${def.bonus.mp} к мане`);
    if (def.ranged) parts.unshift('стреляет стрелами');
    return parts.join(', ');
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
