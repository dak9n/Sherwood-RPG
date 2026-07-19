import { ITEMS, rarityOf, type Icon, type Rarity, type Stack } from './items';
import { SHOP_STOCK, buyPrice, sellPrice } from './shop';

/**
 * Окно магазина. Открывается на O.
 *
 * Две панели разом (так просил заказчик): слева — товары лавки, справа — ВЕСЬ
 * инвентарь игрока. Клик по вещи в инвентаре отбирает её в корзину продажи,
 * кнопка «Продать выбранное» продаёт всё разом. Покупка — клик по товару слева.
 *
 * Рисуется DOM-ом поверх канваса той же рамой набора, что инвентарь и умения:
 * камера увеличена втрое, и всё в сцене раздулось бы вместе с ней.
 *
 * Само окно НЕ решает, можно ли купить-продать: шлёт намерение в сцену, а та
 * зовёт чистые buyItem/sellStack (shop.ts). Одна проверка защищает все пути.
 */

const UI = 'assets/interface/ui';
const ICONS = 'assets/interface/PNG/Icons.png';
/** Только целый масштаб: на дробном пиксели рамки поехали бы. */
const S = 3;

/** Откуда брать картинку предмета. Те же листы, что в инвентаре. */
const SHEETS: Record<Icon['sheet'], string> = {
  icons: ICONS,
  Objects: 'assets/tilesets/Objects.png',
  scroll: `${UI}/scroll.png`,
};

/** Монета для ценников: клетка (0,1) листа иконок. */
const COIN = { x: 0, y: 16 };

/** Колонок в сетке инвентаря — как в окне инвентаря (7x5). */
const BAG_COLS = 7;

/**
 * Цвета рамок редкости — те же, что в инвентаре: тон обязан отражать, как
 * трудно вещь достать. Тёмные не случайно — лежат на песочной ячейке #cda677.
 */
const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a6a48',
  uncommon: '#2f7a35',
  rare: '#2b5ea8',
  epic: '#7b3ca8',
};

const CSS = `
  #shop {
    position: absolute; inset: 0; z-index: 22; display: none;
    align-items: center; justify-content: center;
    font: 12px/1.4 'Simplified Gothic', system-ui, sans-serif; color: #f0e0c8;
    pointer-events: none;
  }
  #shop.open { display: flex; }
  #shop * { image-rendering: pixelated; }
  #shop i { display: block; }

  #shop .win {
    pointer-events: auto; position: relative; width: 640px; max-width: 96vw;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 4px 14px 10px;
    filter: drop-shadow(0 16px 44px rgba(0,0,0,.62));
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

  #shop .body { display: flex; gap: 12px; align-items: flex-start; }
  #shop .col.left { width: 236px; flex: none; }
  #shop .col.right { flex: 1; min-width: 0; }

  /* Шапка панели: подпись слева, золото справа. */
  #shop .phead {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 0 2px 6px; font-size: 11px; font-weight: 700; color: #e0c48a;
    text-shadow: 1px 1px 0 #3e1f1d; text-transform: uppercase; letter-spacing: .05em;
  }
  #shop .gold { display: flex; align-items: center; gap: 5px; font-size: 14px; color: #ffe08a; text-transform: none; }
  #shop .gold i { width: 16px; height: 16px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; }

  /* Светлая страница набора под сетками. */
  #shop .page {
    border-image: url(${UI}/panel_beige.png) 2 5 5 5 fill / ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${2 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: ${S}px;
  }

  #shop .grid { display: grid; gap: 5px; }
  #shop .shopgrid { grid-template-columns: repeat(4, 1fr); }
  #shop .invgrid { grid-template-columns: repeat(${BAG_COLS}, 1fr); }

  /* Ячейка товара/предмета. */
  #shop .slot {
    position: relative; cursor: pointer;
    background: #cda677; border: 2px solid ${RARITY_COLOR.common}; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.18);
  }
  #shop .shopgrid .slot { height: 56px; }
  #shop .invgrid .slot { height: 44px; }
  #shop .slot.empty { background: rgba(90,60,35,.30); border-color: #6b4d2e; cursor: default; box-shadow: none; }
  #shop .slot.r-uncommon { border-color: ${RARITY_COLOR.uncommon}; }
  #shop .slot.r-rare { border-color: ${RARITY_COLOR.rare}; }
  #shop .slot.r-epic { border-color: ${RARITY_COLOR.epic}; }
  #shop .slot.has:hover { filter: brightness(1.09); }
  #shop .slot.off { filter: grayscale(.65) brightness(.82); }
  #shop .slot.picked {
    outline: 3px solid #ffcf5a; outline-offset: -1px;
    box-shadow: inset 0 0 0 2px rgba(255,207,90,.45), 0 0 8px rgba(255,207,90,.4);
  }
  #shop .slot .ico { transform: scale(1.9); transform-origin: center; }
  #shop .shopgrid .slot .ico { margin-bottom: 8px; }
  #shop .slot .qty {
    position: absolute; bottom: 1px; right: 3px; font-size: 11px; font-weight: 700; color: #fff;
    text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
    font-variant-numeric: tabular-nums; pointer-events: none;
  }
  /* Ценник товара — плашка внизу ячейки. */
  #shop .slot .cost {
    position: absolute; left: 0; right: 0; bottom: 0; height: 15px;
    display: flex; align-items: center; justify-content: center; gap: 3px;
    background: rgba(30,20,12,.62);
    font-size: 11px; font-weight: 700; color: #ffe08a; font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  #shop .slot.off .cost { color: #e2705f; }
  #shop .slot .cost i, #shop .slot .tag i {
    width: 10px; height: 10px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; background-size: 16px 16px;
  }
  /* Значок заточки оружия — «+N», как в MMORPG. */
  #shop .plusb {
    position: absolute; bottom: 1px; right: 3px; font-size: 11px; font-weight: 700; color: #ffcf5a;
    text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
    pointer-events: none;
  }
  /* Цена продажи в углу вещи инвентаря — маленькой монеткой. */
  #shop .slot .tag {
    position: absolute; top: 1px; left: 2px; display: flex; align-items: center; gap: 2px;
    font-size: 9px; font-weight: 700; color: #ffe08a; text-shadow: 1px 1px 0 #000;
    background: rgba(30,20,12,.5); padding: 0 2px; border-radius: 3px; pointer-events: none;
  }

  /* Корзина продажи. */
  #shop .basket { margin-top: 10px; }
  #shop .bhead {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 0 2px 6px; font-size: 11px; font-weight: 700; color: #e0c48a;
    text-shadow: 1px 1px 0 #3e1f1d; text-transform: uppercase; letter-spacing: .05em;
  }
  #shop .bhead .clear {
    cursor: pointer; font-size: 10px; color: #d8b088; border: 1px solid #6b5433; border-radius: 3px;
    padding: 2px 7px; background: rgba(60,40,22,.5); text-transform: none; letter-spacing: 0;
  }
  #shop .bhead .clear:hover { color: #ff9c8a; border-color: #8a4a3a; }
  #shop .bcells { display: grid; grid-template-columns: repeat(${BAG_COLS}, 1fr); gap: 5px; }
  #shop .bcells .slot { height: 44px; }
  #shop .foot { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  #shop .total { flex: none; display: flex; align-items: center; gap: 5px; font-size: 15px; font-weight: 700; color: #ffe08a; }
  #shop .total i { width: 16px; height: 16px; background: url(${ICONS}) -${COIN.x}px -${COIN.y}px; }
  #shop .sellbtn {
    flex: 1; cursor: pointer; font: inherit; font-weight: 700; font-size: 13px;
    padding: 9px 8px; color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
    background: #c98a2f; border: 2px solid #5a3d18; border-radius: 4px;
    box-shadow: inset 0 2px 0 #e6b45c, inset 0 -3px 0 #97621f;
  }
  #shop .sellbtn:hover:not(:disabled) { filter: brightness(1.1); }
  #shop .sellbtn:active:not(:disabled) { transform: translateY(1px); }
  #shop .sellbtn:disabled {
    cursor: default; color: #a08a6a; background: #b79b74; border-color: #6b5433;
    box-shadow: none; text-shadow: none;
  }

  #shop .hint { margin: 8px 2px 0; min-height: 15px; font-size: 12px; text-align: center; color: #9a835f; }
`;

export class ShopUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private goldEl: HTMLElement;
  private shopGrid: HTMLElement;
  private invGrid: HTMLElement;
  private bcells: HTMLElement;
  private bcount: HTMLElement;
  private totalEl: HTMLElement;
  private sellBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  private bag: (Stack | null)[] = [];
  private gold: () => number = () => 0;
  /** Отобрано на продажу: номер ячейки сумки -> id вещи на момент выбора. */
  private basket = new Map<number, string>();
  private key = '';

  /** Игрок купил предмет по id. */
  onBuy: (id: string) => void = () => {};
  /**
   * Игрок продал отобранное (целыми стопками). Пары «ячейка + что в ней было
   * при отборе»: сцена продаёт только при совпадении — сумка могла измениться.
   */
  onSellBasket: (picks: { index: number; id: string }[]) => void = () => {};

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'shop';
    this.root.innerHTML = `
      <div class="win">
        <div class="title">Shop</div>
        <div class="close" title="Close (O)"></div>
        <div class="body">
          <div class="col left">
            <div class="phead"><span>Shop items</span></div>
            <div class="page"><div class="grid shopgrid"></div></div>
          </div>
          <div class="col right">
            <div class="phead"><span>Your Inventory</span><span class="gold"><i></i><span class="g">0</span></span></div>
            <div class="page"><div class="grid invgrid"></div></div>
            <div class="basket">
              <div class="bhead">
                <span>Selected to sell (<span class="bn">0</span>)</span>
                <span class="clear" title="Remove all from cart">Clear</span>
              </div>
              <div class="page"><div class="bcells"></div></div>
              <div class="foot">
                <button class="sellbtn">Sell selected</button>
                <span class="total"><i></i><span class="tv">0</span></span>
              </div>
            </div>
          </div>
        </div>
        <div class="hint"></div>
      </div>
    `;
    document.body.append(this.root);

    this.goldEl = this.root.querySelector('.gold .g')!;
    this.shopGrid = this.root.querySelector('.shopgrid')!;
    this.invGrid = this.root.querySelector('.invgrid')!;
    this.bcells = this.root.querySelector('.bcells')!;
    this.bcount = this.root.querySelector('.bn')!;
    this.totalEl = this.root.querySelector('.total .tv')!;
    this.sellBtn = this.root.querySelector('.sellbtn')!;
    this.hintEl = this.root.querySelector('.hint')!;

    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.querySelector('.clear')!.addEventListener('click', () => this.clearBasket());
    this.sellBtn.onclick = () => this.sellPicked();
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
    this.basket.clear();
    this.key = '';
    this.defaultHint();
    this.render();
  }

  close(): void {
    this.root.classList.remove('open');
  }

  /** Короткий отклик на действие: «куплено», «не хватает золота». Живёт до следующего. */
  flash(msg: string, ok = true): void {
    this.hintEl.textContent = msg;
    this.hintEl.style.color = ok ? '#8ad46a' : '#ff8a75';
  }

  private defaultHint(): void {
    this.hintEl.textContent = 'Click an item on the left to buy. Click an item in your inventory to select it for sale.';
    this.hintEl.style.color = '#9a835f';
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

  /** Стоимость и число отобранных стопок. */
  private basketTotals(): { total: number; count: number } {
    let total = 0;
    for (const [i] of this.basket) {
      const slot = this.bag[i];
      if (slot) total += sellPrice(slot.id) * slot.qty;
    }
    return { total, count: this.basket.size };
  }

  /**
   * Перерисовать, если что-то изменилось. Зовётся каждый кадр, пока окно открыто
   * (золото капает с монстров, сумка меняется), поэтому сравниваем со снимком.
   */
  render(): void {
    if (!this.isOpen) return;

    // Чистим корзину от исчезнувшего: вещь могли съесть или надеть горячей
    // клавишей, и ячейка больше не держит то, что отобрали.
    for (const [i, id] of this.basket) {
      const slot = this.bag[i];
      if (!slot || slot.id !== id || sellPrice(id) <= 0) this.basket.delete(i);
    }

    const gold = this.gold();
    const bagSig = this.bag.map((s) => (s ? `${s.id}:${s.qty}` : '_')).join(',');
    const basketSig = [...this.basket.keys()].sort((a, b) => a - b).join(',');
    const key = `${gold}|${bagSig}|${basketSig}`;
    if (key === this.key) return;
    this.key = key;

    this.goldEl.textContent = gold.toLocaleString('ru-RU');
    this.renderShop(gold);
    this.renderInventory();
    this.renderBasket();
  }

  private renderShop(gold: number): void {
    this.shopGrid.innerHTML = '';
    for (const id of SHOP_STOCK) {
      const def = ITEMS[id];
      const price = buyPrice(id);
      if (!def || price == null) continue;
      const afford = gold >= price;

      const slot = document.createElement('div');
      slot.className = `slot has r-${rarityOf(id)}${afford ? '' : ' off'}`;
      slot.title = this.tip(id, price, afford);
      slot.append(this.iconEl(def.icon));
      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.innerHTML = `<i></i>${price}`;
      slot.append(cost);
      slot.onclick = () => this.onBuy(id);
      this.shopGrid.append(slot);
    }
  }

  private renderInventory(): void {
    this.invGrid.innerHTML = '';
    this.bag.forEach((stack, index) => {
      const slot = document.createElement('div');
      if (!stack) {
        slot.className = 'slot empty';
        this.invGrid.append(slot);
        return;
      }

      const def = ITEMS[stack.id];
      const price = sellPrice(stack.id);
      const sellable = price > 0;
      const plus = def?.slot === 'weapon' ? stack.sharpen ?? 0 : 0;
      const nm = def ? `${def.name}${plus > 0 ? ` +${plus}` : ''}` : '';
      slot.className = `slot has r-${rarityOf(stack.id)}${this.basket.has(index) ? ' picked' : ''}`;
      slot.title = def
        ? sellable
          ? `${nm} — for sale (${price} each)`
          : `${nm} — not for sale`
        : '';
      if (def) slot.append(this.iconEl(def.icon));
      if (stack.qty > 1) {
        slot.append(Object.assign(document.createElement('span'), { className: 'qty', textContent: String(stack.qty) }));
      }
      if (plus > 0) {
        slot.append(Object.assign(document.createElement('span'), { className: 'plusb', textContent: `+${plus}` }));
      }
      if (sellable) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.innerHTML = `<i></i>${price}`;
        slot.append(tag);
        slot.onclick = () => this.togglePick(index, stack.id);
      }
      this.invGrid.append(slot);
    });
  }

  private renderBasket(): void {
    const { total, count } = this.basketTotals();
    this.bcount.textContent = String(count);
    this.totalEl.textContent = `+${total.toLocaleString('ru-RU')}`;
    this.sellBtn.disabled = count === 0;

    // Отобранное — рядами по ширине сумки; всегда хотя бы один ряд, чтобы было
    // видно, куда ложится выбор.
    this.bcells.innerHTML = '';
    const picks = [...this.basket.keys()];
    const cells = Math.max(BAG_COLS, Math.ceil(picks.length / BAG_COLS) * BAG_COLS);
    for (let n = 0; n < cells; n++) {
      const index = picks[n];
      const stack = index === undefined ? null : this.bag[index];
      const slot = document.createElement('div');
      if (!stack) {
        slot.className = 'slot empty';
        this.bcells.append(slot);
        continue;
      }
      const def = ITEMS[stack.id];
      const plus = def.slot === 'weapon' ? stack.sharpen ?? 0 : 0;
      slot.className = `slot has r-${rarityOf(stack.id)}`;
      slot.title = `${def.name}${plus > 0 ? ` +${plus}` : ''} — remove from sale`;
      slot.append(this.iconEl(def.icon));
      if (stack.qty > 1) {
        slot.append(Object.assign(document.createElement('span'), { className: 'qty', textContent: String(stack.qty) }));
      }
      if (plus > 0) {
        slot.append(Object.assign(document.createElement('span'), { className: 'plusb', textContent: `+${plus}` }));
      }
      slot.onclick = () => this.togglePick(index, stack.id);
      this.bcells.append(slot);
    }
  }

  /** Клик по вещи: в корзину или из неё. */
  private togglePick(index: number, id: string): void {
    if (this.basket.has(index)) this.basket.delete(index);
    else this.basket.set(index, id);
    this.key = '';
    this.render();
  }

  private clearBasket(): void {
    if (!this.basket.size) return;
    this.basket.clear();
    this.key = '';
    this.render();
  }

  private sellPicked(): void {
    if (!this.basket.size) return;
    // Отдаём и номер ячейки, и вещь, которую игрок видел при отборе: продажа
    // по голому номеру продала бы то, что УСПЕЛО лечь в ячейку за этот кадр.
    const picks = [...this.basket].map(([index, id]) => ({ index, id }));
    this.basket.clear();
    this.key = '';
    this.onSellBasket(picks); // сцена продаст, обновит сумку и позовёт render
  }

  /** Подсказка по товару: имя, что даёт, цена. */
  private tip(id: string, price: number, afford: boolean): string {
    const def = ITEMS[id];
    const parts: string[] = [];
    if (def.ranged) parts.push('shoots arrows');
    if (def.use?.hp) parts.push(`+${def.use.hp} Health`);
    if (def.use?.mp) parts.push(`+${def.use.mp} Mana`);
    if (def.bonus?.dmg) parts.push(`+${def.bonus.dmg} Attack`);
    if (def.bonus?.def) parts.push(`+${def.bonus.def} Defense`);
    if (def.bonus?.speed) parts.push(`${def.bonus.speed > 0 ? '+' : ''}${def.bonus.speed} Speed`);
    if (def.bonus?.hp) parts.push(`+${def.bonus.hp} Health`);
    if (def.bonus?.mp) parts.push(`+${def.bonus.mp} Mana`);
    const body = parts.length ? ` (${parts.join(', ')})` : '';
    return `${def.name}${body} — ${afford ? `buy for ${price}` : `not enough gold: need ${price}`}`;
  }

  destroy(): void {
    this.root.remove();
    this.style.remove();
  }
}
