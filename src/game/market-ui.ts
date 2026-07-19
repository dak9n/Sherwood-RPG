import { ITEMS, rarityOf, marketCategory, MARKET_CATEGORIES, RARITY_NAME, type Icon, type Rarity, type Stack } from './items';
import { MARKET_COMMISSION, MAX_PRICE, type Lot, type TradeItem, type TradeRecord, type BrowseResult, type BrowseFilter } from './market-types';

/**
 * Окно торгового рынка (клавиша T). Аукцион между аккаунтами: слева категории и
 * фильтры, в центре лоты чужих игроков, справа — свой инвентарь и «Создать лот».
 * Вкладки: Рынок / Мои лоты / История.
 *
 * Рисуется DOM-ом поверх канваса той же рамой набора, что магазин и кузница.
 * Само окно НЕ ходит на сервер и ничего не решает: показывает снимок от сцены и
 * шлёт намерения (спросить витрину, купить, выставить, снять). Сервер и клиент
 * рынка (market-client) дёргает сцена — одно место оркестрации на все пути.
 */

const UI = 'assets/interface/ui';
const ICONS = 'assets/interface/PNG/Icons.png';
const S = 3;

const SHEETS: Record<Icon['sheet'], string> = {
  icons: ICONS,
  Objects: 'assets/tilesets/Objects.png',
  scroll: `${UI}/scroll.png`,
};

/** Монета для ценников: клетка (0,16) листа иконок (как в магазине). */
const COIN = { x: 0, y: 16 };
const BAG_COLS = 5;

const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a6a48',
  uncommon: '#2f7a35',
  rare: '#2b5ea8',
  epic: '#7b3ca8',
};

/** Снимок рынка от сцены — окно только рисует его. */
export interface MarketView {
  gold: number;
  bag: (Stack | null)[];
  /** Рынка нет: собранная игра без сервера или он не запущен. */
  unavailable: boolean;
  /** Идёт запрос витрины. */
  loading: boolean;
  /** Текущая витрина под активным фильтром (чужие лоты). */
  browse: BrowseResult | null;
  /** Мои активные лоты. */
  mine: Lot[];
  /** История моих сделок. */
  history: TradeRecord[];
  /** Короткое сообщение (куплено/выставлено/почта/ошибка). */
  notice?: { text: string; ok: boolean };
  /** Идёт покупка/выставление/снятие — блокируем кнопки, чтобы не было гонок и двойных трат. */
  busy?: boolean;
}

export interface MarketActions {
  /** Спросить витрину под фильтром (смена категории/поиска/сортировки/страницы). */
  onQuery: (filter: BrowseFilter) => void;
  /** Обновить данные активной вкладки (мои лоты/история/почта) — при смене вкладки и «↻». */
  onRefresh: (tab: 'market' | 'mine' | 'history') => void;
  onBuy: (lotId: string) => void;
  onList: (item: TradeItem, price: number) => void;
  onCancel: (lotId: string) => void;
}

type Tab = 'market' | 'mine' | 'history';

const SORTS: { id: NonNullable<BrowseFilter['sort']>; label: string }[] = [
  { id: 'newest', label: 'Default' },
  { id: 'price_asc', label: 'Price ↑' },
  { id: 'price_desc', label: 'Price ↓' },
  { id: 'unit_asc', label: 'Price per unit' },
  { id: 'expires', label: 'Expiring soon' },
];

const fmtGold = (n: number): string => Math.floor(n).toLocaleString('ru-RU');

/** «23ч 45м» / «5м» — сколько лоту осталось. */
function fmtLeft(ms: number): string {
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

const CSS = `
  #market {
    position: absolute; inset: 0; z-index: 24; display: none;
    align-items: center; justify-content: center;
    font: 12px/1.4 'MedievalSharp', system-ui, sans-serif; color: #f0e0c8; pointer-events: none;
  }
  #market.open { display: flex; }
  #market * { image-rendering: pixelated; box-sizing: border-box; }
  #market i { display: block; }

  #market .win {
    pointer-events: auto; position: relative; width: 1000px; max-width: 98vw; height: 88vh; max-height: 760px;
    display: flex; flex-direction: column;
    border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid;
    padding: 2px 12px 8px; filter: drop-shadow(0 16px 44px rgba(0,0,0,.62));
  }
  #market .title {
    position: absolute; top: -${13 * S}px; left: 0; right: 0; text-align: center;
    font-weight: 700; font-size: 15px; letter-spacing: .12em; text-transform: uppercase;
    color: #eaf6f0; text-shadow: 1px 1px 0 #294040;
  }
  #market .gold {
    position: absolute; top: -${12 * S}px; left: 6px; display: flex; align-items: center; gap: 6px;
    font-weight: 700; color: #ffcf5a; font-variant-numeric: tabular-nums; text-shadow: 1px 1px 0 #000;
  }
  #market .close {
    position: absolute; top: -${13 * S}px; right: 0; width: ${9 * S}px; height: ${9 * S}px; cursor: pointer;
    background: url(${UI}/close.png) no-repeat center / 100% 100%;
  }
  #market .close:hover { filter: brightness(1.25); }

  #market .tabs { display: flex; gap: 6px; margin: 2px 0 6px; }
  #market .tab {
    cursor: pointer; padding: 5px 14px; font-weight: 700; font-size: 12px; color: #b8a284;
    border: 2px solid #3a2c1c; border-radius: 4px 4px 0 0; background: rgba(20,14,8,.4);
  }
  #market .tab.on { color: #eaf6f0; background: #50a978; border-color: #294040; }

  #market .body { display: flex; gap: 10px; flex: 1; min-height: 0; }
  #market .colL { width: 180px; flex: none; display: flex; flex-direction: column; gap: 8px; }
  #market .colC { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  #market .colR { width: 250px; flex: none; display: flex; flex-direction: column; gap: 8px; }

  #market .panel {
    border-image: url(${UI}/panel_dark.png) 2 3 4 3 fill / ${2 * S}px ${3 * S}px ${4 * S}px ${3 * S}px repeat;
    border-width: ${2 * S}px ${3 * S}px ${4 * S}px ${3 * S}px; border-style: solid; padding: ${2 * S}px;
  }
  #market .phead { font-size: 11px; font-weight: 700; color: #e0c48a; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 6px; }

  #market .cats { display: flex; flex-direction: column; gap: 2px; }
  #market .cat { cursor: pointer; padding: 6px 8px; border-radius: 4px; color: #d8c0a0; font-size: 12px; }
  #market .cat:hover { background: rgba(255,255,255,.06); }
  #market .cat.on { background: #50a978; color: #eaf6f0; font-weight: 700; }

  #market label.f { display: block; font-size: 10px; color: #b8a284; margin: 8px 2px 2px; text-transform: uppercase; }
  #market select, #market input.txt {
    width: 100%; font: inherit; font-size: 12px; padding: 5px 6px; color: #f0e0c8;
    background: #2b1d12; border: 2px solid #5a4224; border-radius: 4px;
  }
  #market .chk { display: flex; align-items: center; gap: 6px; margin: 8px 2px 0; font-size: 12px; color: #d8c0a0; cursor: pointer; }
  #market .reset {
    margin-top: auto; cursor: pointer; font: inherit; font-weight: 700; padding: 8px; color: #eaf6f0;
    background: #7a4a2a; border: 2px solid #294040; border-radius: 4px;
  }
  #market .reset:hover { filter: brightness(1.1); }

  #market .searchrow { display: flex; gap: 6px; margin-bottom: 6px; }
  #market .searchrow .txt { flex: 1; }
  #market .searchrow select { width: 160px; }
  #market .btn {
    cursor: pointer; font: inherit; font-weight: 700; padding: 5px 10px; color: #eaf6f0;
    background: #50a978; border: 2px solid #294040; border-radius: 4px; white-space: nowrap;
  }
  #market .btn:hover:not(:disabled) { filter: brightness(1.1); }
  #market .btn:disabled { cursor: default; color: #a08a6a; background: #b79b74; border-color: #6b5433; }
  #market .btn.sm { padding: 4px 9px; font-size: 11px; }
  #market .btn.danger { background: #a4402f; }

  #market .lots { flex: 1; overflow-y: auto; }
  #market table { width: 100%; border-collapse: collapse; }
  #market th { text-align: left; font-size: 10px; color: #b8a284; text-transform: uppercase; padding: 4px 6px; position: sticky; top: 0; background: #241811; }
  #market td { padding: 5px 6px; border-top: 1px solid rgba(255,255,255,.05); vertical-align: middle; }
  #market tr:hover td { background: rgba(255,255,255,.04); }
  #market .itemcell { display: flex; align-items: center; gap: 8px; }
  #market .ico-wrap { width: 34px; height: 34px; flex: none; display: flex; align-items: center; justify-content: center;
    background: #cda677; border: 2px solid ${RARITY_COLOR.common}; border-radius: 3px; position: relative; }
  #market .ico-wrap.r-uncommon { border-color: ${RARITY_COLOR.uncommon}; }
  #market .ico-wrap.r-rare { border-color: ${RARITY_COLOR.rare}; }
  #market .ico-wrap.r-epic { border-color: ${RARITY_COLOR.epic}; }
  #market .ico-wrap .ico { transform: scale(1.5); }
  #market .ico-wrap .plus { position: absolute; bottom: -1px; right: 0; font-size: 9px; font-weight: 700; color: #fff; text-shadow: 1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000; }
  #market .nm { font-weight: 700; }
  #market .nm.r-common { color: #e8dcc0; } #market .nm.r-uncommon { color: #8ad46a; }
  #market .nm.r-rare { color: #7ab0e8; } #market .nm.r-epic { color: #c58ae8; }
  #market .sub { font-size: 10px; color: #9a835f; }
  #market .price { color: #ffcf5a; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  #market .empty { text-align: center; color: #9a835f; padding: 30px 10px; }

  #market .pager { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 0 0; font-size: 12px; }
  #market .pager .pg { cursor: pointer; padding: 3px 8px; border: 1px solid #5a4224; border-radius: 3px; color: #d8c0a0; }
  #market .pager .pg.on { background: #50a978; color: #eaf6f0; border-color: #294040; }
  #market .found { margin-left: auto; color: #9a835f; font-size: 11px; }

  #market .bag { display: grid; grid-template-columns: repeat(${BAG_COLS}, 1fr); gap: 4px; }
  #market .cell { position: relative; aspect-ratio: 1; background: #cda677; border: 2px solid ${RARITY_COLOR.common}; border-radius: 3px;
    display: flex; align-items: center; justify-content: center; cursor: default; }
  #market .cell.pick { cursor: pointer; }
  #market .cell.pick:hover { filter: brightness(1.1); outline: 2px solid #ffcf5a; }
  #market .cell.sel { outline: 3px solid #ffcf5a; }
  #market .cell.r-uncommon { border-color: ${RARITY_COLOR.uncommon}; } #market .cell.r-rare { border-color: ${RARITY_COLOR.rare}; } #market .cell.r-epic { border-color: ${RARITY_COLOR.epic}; }
  #market .cell .ico { transform: scale(1.6); }
  #market .cell .qty { position: absolute; right: 1px; bottom: 0; font-size: 10px; font-weight: 700; color: #fff; text-shadow: 1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000; }
  #market .cell .plus { position: absolute; left: 1px; bottom: 0; font-size: 9px; font-weight: 700; color: #ffcf5a; text-shadow: 1px 1px 0 #000; }

  #market .notice { min-height: 16px; font-size: 12px; text-align: center; margin: 4px 0 0; }
  #market .notice.ok { color: #8ad46a; } #market .notice.bad { color: #e0885a; }
  #market .footer { display: flex; gap: 18px; justify-content: center; font-size: 11px; color: #b8a284; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.06); margin-top: 4px; }

  /* Диалог создания лота. Предмет выбирается ДО открытия (кликом по сумке), поэтому
     диалог честно модальный: фон ловит клики (pointer-events:auto обязателен — .dlg
     сосед .win, а #market клики выключил) и закрывается кликом мимо карточки.
     Закрыть также можно кнопкой Cancel или Esc. */
  #market .dlg { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.5); z-index: 2; pointer-events: auto; }
  #market .dlg.open { display: flex; }
  #market .dlg .card { pointer-events: auto; width: 380px; padding: 14px; border-image: url(${UI}/window.png) 16 5 5 5 fill / ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px repeat;
    border-width: ${16 * S}px ${5 * S}px ${5 * S}px ${5 * S}px; border-style: solid; }
  #market .dlgerr { color: #e0885a; font-size: 11px; text-align: center; min-height: 14px; margin-top: 6px; }

  /* Панель характеристик выбранного предмета — под сумкой, над «Create Listing».
     Показывает то же, что тултип инвентаря: игрок должен видеть, ЧТО продаёт. */
  #market .details { display: flex; flex-direction: column; gap: 4px; }
  #market .details .head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  #market .details .kind { font-size: 10px; color: #9a835f; text-transform: uppercase; letter-spacing: .05em; }
  #market .details .ln { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #d8c0a0; }
  #market .details .ln b { color: #e8dcc0; font-variant-numeric: tabular-nums; }
  #market .details .ln b.plus { color: #8ad46a; }
  #market .details .ln b.minus { color: #e0885a; }
  #market .details .none { font-size: 11px; color: #9a835f; text-align: center; padding: 6px 4px; line-height: 1.4; }
  #market .dlg h3 { margin: 0 0 8px; text-align: center; color: #eaf6f0; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
  #market .dlg .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  #market .dlg .row label { width: 90px; font-size: 12px; color: #d8c0a0; }
  #market .dlg .row input { flex: 1; }
  #market .dlg .acts { display: flex; gap: 8px; margin-top: 12px; }
  #market .dlg .acts .btn { flex: 1; text-align: center; }
`;

export class MarketUi {
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private state: () => MarketView = () => ({ gold: 0, bag: [], unavailable: false, loading: false, browse: null, mine: [], history: [] });
  private actions: MarketActions = { onQuery: () => {}, onRefresh: () => {}, onBuy: () => {}, onList: () => {}, onCancel: () => {} };

  private tab: Tab = 'market';
  private filter: BrowseFilter = { category: 'all', search: '', rarity: 'any', sort: 'newest', page: 1 };
  private onlyAffordable = false;
  private key = '';
  /** id таймера обновления «Истекает», пока окно открыто. */
  private ticker?: number;
  /** Выбранный для выставления стак (индекс в сумке) и введённые цена/кол-во. */
  private pick: { index: number; qty: number; price: number } | null = null;

  constructor() {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);

    this.root = document.createElement('div');
    this.root.id = 'market';
    this.root.innerHTML = `
      <div class="win">
        <div class="gold"><i class="coin"></i><span class="goldv">0</span></div>
        <div class="title">Trading Market</div>
        <div class="close" title="Close (T)"></div>
        <div class="tabs">
          <div class="tab" data-tab="market">Market</div>
          <div class="tab" data-tab="mine">My Listings</div>
          <div class="tab" data-tab="history">History</div>
        </div>
        <div class="body">
          <div class="colL panel">
            <div class="phead">Categories</div>
            <div class="cats"></div>
            <label class="f">Rarity</label>
            <select class="rarity">
              <option value="any">Any</option>
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="epic">Epic</option>
            </select>
            <label class="chk"><input type="checkbox" class="afford"> Affordable only</label>
            <button class="reset">Reset</button>
          </div>
          <div class="colC">
            <div class="searchrow">
              <input class="txt search" placeholder="Search by name…">
              <select class="sort"></select>
              <button class="btn sm refresh" title="Refresh">↻</button>
            </div>
            <div class="lots panel"></div>
            <div class="pager"></div>
          </div>
          <div class="colR">
            <div class="panel" style="flex:1; overflow-y:auto">
              <div class="phead">Your Inventory</div>
              <div class="bag"></div>
            </div>
            <div class="panel details"></div>
            <button class="btn create">Create Listing</button>
          </div>
        </div>
        <div class="notice"></div>
        <div class="footer">
          <span>Buy and sell with other players</span>
          <span>Market fee: ${Math.round(MARKET_COMMISSION * 100)}% (on sale)</span>
          <span>Proceeds arrive by mail</span>
        </div>
      </div>
      <div class="dlg">
        <div class="card">
          <h3>Create Listing</h3>
          <div class="dlgbody"></div>
        </div>
      </div>
    `;
    document.body.append(this.root);

    (this.root.querySelector('.coin') as HTMLElement).append(this.iconEl(COIN as Icon, true));
    this.wire();
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private iconEl(icon: { x: number; y: number; sheet?: Icon['sheet']; w?: number; h?: number }, coin = false): HTMLElement {
    const el = document.createElement('i');
    el.className = 'ico';
    el.style.backgroundImage = `url(${coin ? ICONS : SHEETS[(icon.sheet ?? 'icons') as Icon['sheet']]})`;
    el.style.backgroundPosition = `-${icon.x}px -${icon.y}px`;
    el.style.width = `${icon.w ?? 16}px`;
    el.style.height = `${icon.h ?? 16}px`;
    return el;
  }

  private wire(): void {
    // Ввод в поля рынка не должен долетать до игры: иначе печатаешь «t» — окно
    // закрывается, цифры кастуют фаербол/жмут хотбар, wasd водят героя. Гасим
    // всплытие на корне окна (Phaser слушает клавиатуру на window).
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      // Esc закрывает диалог (если открыт) или само окно — фон диалога больше не ловит клики.
      if ((e as KeyboardEvent).key === 'Escape') {
        if (this.q('.dlg').classList.contains('open')) this.closeDialog();
        else this.close();
      }
    });

    this.q('.close').addEventListener('click', () => this.close());
    for (const t of this.root.querySelectorAll<HTMLElement>('.tab')) {
      t.addEventListener('click', () => {
        this.tab = t.dataset.tab as Tab;
        this.key = '';
        this.render();
        this.actions.onRefresh(this.tab); // свежие данные вкладки: чужие могли купить твой лот
      });
    }
    // Категории
    const cats = this.q('.cats');
    for (const c of MARKET_CATEGORIES) {
      const el = Object.assign(document.createElement('div'), { className: 'cat', textContent: c.label });
      el.dataset.cat = c.id;
      el.addEventListener('click', () => { this.filter.category = c.id; this.filter.page = 1; this.requery(); });
      cats.append(el);
    }
    // Сортировка
    const sort = this.q<HTMLSelectElement>('.sort');
    for (const s of SORTS) sort.append(Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }));
    sort.addEventListener('change', () => { this.filter.sort = sort.value as BrowseFilter['sort']; this.filter.page = 1; this.requery(); });

    this.q<HTMLSelectElement>('.rarity').addEventListener('change', (e) => {
      this.filter.rarity = (e.target as HTMLSelectElement).value as BrowseFilter['rarity']; this.filter.page = 1; this.requery();
    });
    const search = this.q<HTMLInputElement>('.search');
    // input держит фильтр в синхроне (чтобы обновление/сортировка учли набранное), Enter шлёт запрос.
    search.addEventListener('input', () => { this.filter.search = search.value.trim(); });
    search.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { this.filter.page = 1; this.requery(); } });
    this.q('.afford').addEventListener('change', (e) => { this.onlyAffordable = (e.target as HTMLInputElement).checked; this.filter.page = 1; this.requery(); });
    this.q('.refresh').addEventListener('click', () => { this.requery(); this.actions.onRefresh(this.tab); });
    this.q('.reset').addEventListener('click', () => {
      this.filter = { category: 'all', search: '', rarity: 'any', sort: 'newest', page: 1 };
      this.onlyAffordable = false;
      search.value = '';
      this.q<HTMLSelectElement>('.rarity').value = 'any';
      this.q<HTMLSelectElement>('.sort').value = 'newest';
      this.q<HTMLInputElement>('.afford').checked = false;
      this.requery();
    });
    this.q('.create').addEventListener('click', () => this.openDialog());
    // Клик мимо карточки закрывает диалог: выбор предмета к этому моменту уже сделан,
    // так что перехват кликов фоном ничему не мешает.
    this.q('.dlg').addEventListener('click', (e) => { if (e.target === this.q('.dlg')) this.closeDialog(); });
  }

  setState(get: () => MarketView): void { this.state = get; }
  setActions(a: MarketActions): void { this.actions = a; }

  get isOpen(): boolean { return this.root.classList.contains('open'); }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  open(): void {
    this.root.classList.add('open');
    this.key = '';
    this.requery();
    // Тикаем раз в 30 с, чтобы «Истекает» не застывало, пока окно открыто без действий.
    if (this.ticker === undefined) this.ticker = window.setInterval(() => { this.key = ''; this.render(); }, 30000);
  }

  close(): void {
    this.root.classList.remove('open');
    this.closeDialog();
    if (this.ticker !== undefined) { window.clearInterval(this.ticker); this.ticker = undefined; }
  }

  /** Попросить сцену обновить витрину под текущим фильтром, затем перерисовать. */
  private requery(): void {
    // «Только по карману» — серверный фильтр по актуальному золоту (чтобы страницы и счётчик не врали).
    this.filter.maxPrice = this.onlyAffordable ? this.state().gold : undefined;
    this.key = '';
    this.actions.onQuery({ ...this.filter });
    this.render();
  }

  /** Живое сообщение об итоге действия (куплено/выставлено/ошибка). */
  flash(text: string, ok = true): void {
    const el = this.q('.notice');
    el.textContent = text;
    el.className = `notice ${ok ? 'ok' : 'bad'}`;
  }

  render(): void {
    if (!this.isOpen) return;
    const v = this.state();

    this.q('.goldv').textContent = fmtGold(v.gold);
    for (const t of this.root.querySelectorAll<HTMLElement>('.tab')) t.classList.toggle('on', t.dataset.tab === this.tab);
    for (const c of this.root.querySelectorAll<HTMLElement>('.cat')) c.classList.toggle('on', c.dataset.cat === this.filter.category);

    // Снимок для сравнения — чтобы не перестраивать DOM каждый кадр.
    const sig = JSON.stringify({
      tab: this.tab, f: this.filter, aff: this.onlyAffordable, gold: v.gold,
      un: v.unavailable, ld: v.loading, busy: v.busy, notice: v.notice,
      browse: v.browse?.lots.map((l) => [l.id, l.price]), page: v.browse?.page, pages: v.browse?.pages, total: v.browse?.total,
      mine: v.mine.map((l) => [l.id, l.price, l.expiresAt]),
      hist: v.history.map((h) => [h.ts, h.itemId, h.price]),
      bag: v.bag.map((s) => (s ? [s.id, s.qty, s.sharpen ?? 0] : 0)),
      sel: this.pick?.index ?? -1, // выбор влияет на подсветку, характеристики и кнопку
    });
    if (sig === this.key) return;
    this.key = sig;

    if (v.notice) this.flash(v.notice.text, v.notice.ok);
    else this.q('.notice').textContent = '';

    this.renderBag(v);
    this.renderDetails(v);
    // Выставлять нечего, пока предмет не выбран (и пока идёт другая операция).
    const create = this.q<HTMLButtonElement>('.create');
    create.disabled = !this.pick || !!v.busy;
    create.title = this.pick ? 'Set a price and put it up for sale' : 'Pick an item in your inventory first';
    if (this.tab === 'market') this.renderMarket(v);
    else if (this.tab === 'mine') this.renderMine(v);
    else this.renderHistory(v);
  }

  private itemCell(item: TradeItem): HTMLElement {
    const def = ITEMS[item.id];
    const wrap = document.createElement('div');
    wrap.className = 'itemcell';
    const ico = document.createElement('div');
    ico.className = `ico-wrap r-${rarityOf(item.id)}`;
    if (def) ico.append(this.iconEl(def.icon));
    if (item.sharpen) ico.append(Object.assign(document.createElement('span'), { className: 'plus', textContent: `+${item.sharpen}` }));
    const info = document.createElement('div');
    const rar = rarityOf(item.id);
    info.innerHTML = `<div class="nm r-${rar}">${def?.name ?? item.id}${item.sharpen ? ` +${item.sharpen}` : ''}${item.qty > 1 ? ` ×${item.qty}` : ''}</div>` +
      `<div class="sub">${RARITY_NAME[rar]}</div>`;
    wrap.append(ico, info);
    return wrap;
  }

  private priceCell(gold: number): HTMLElement {
    const el = document.createElement('span');
    el.className = 'price';
    el.textContent = fmtGold(gold);
    el.append(this.iconEl(COIN as Icon, true));
    return el;
  }

  private renderMarket(v: MarketView): void {
    const box = this.q('.lots');
    const pager = this.q('.pager');
    box.innerHTML = '';
    pager.innerHTML = '';

    if (v.unavailable) {
      box.innerHTML = '<div class="empty">Market is available only when connected to the server.<br>Run the game via the dev server (npm run dev).</div>';
      return;
    }
    if (v.loading && !v.browse) { box.innerHTML = '<div class="empty">Loading…</div>'; return; }

    // «Только по карману» теперь серверный фильтр (страницы и счётчик честные) — клиентом не режем.
    const lots = v.browse?.lots ?? [];
    if (!lots.length) { box.innerHTML = '<div class="empty">Nothing found.</div>'; return; }

    const now = Date.now();
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Item</th><th>Price</th><th>Seller</th><th>Expires</th><th></th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const lot of lots) {
      const tr = document.createElement('tr');
      const tdItem = document.createElement('td'); tdItem.append(this.itemCell(lot.item));
      const tdPrice = document.createElement('td'); tdPrice.append(this.priceCell(lot.price));
      const tdSeller = document.createElement('td'); tdSeller.textContent = lot.sellerName;
      const tdLeft = document.createElement('td'); tdLeft.className = 'sub'; tdLeft.textContent = fmtLeft(lot.expiresAt - now);
      const tdBtn = document.createElement('td');
      const buy = Object.assign(document.createElement('button'), { className: 'btn sm', textContent: 'Buy' });
      buy.disabled = !!v.busy || lot.price > v.gold; // busy: не даём начать вторую покупку (гонка золота)
      buy.title = lot.price > v.gold ? 'Not enough gold' : '';
      buy.addEventListener('click', () => this.actions.onBuy(lot.id));
      tdBtn.append(buy);
      tr.append(tdItem, tdPrice, tdSeller, tdLeft, tdBtn);
      tb.append(tr);
    }
    table.append(tb);
    box.append(table);

    // Пагинация
    const pages = v.browse?.pages ?? 1;
    const cur = v.browse?.page ?? 1;
    const mk = (label: string, page: number, on = false, dis = false): HTMLElement => {
      const el = Object.assign(document.createElement('span'), { className: `pg${on ? ' on' : ''}`, textContent: label });
      if (dis) el.style.opacity = '.4';
      else el.addEventListener('click', () => { this.filter.page = page; this.requery(); });
      return el;
    };
    pager.append(mk('‹', Math.max(1, cur - 1), false, cur <= 1));
    for (let p = 1; p <= pages; p++) pager.append(mk(String(p), p, p === cur));
    pager.append(mk('›', Math.min(pages, cur + 1), false, cur >= pages));
    pager.append(Object.assign(document.createElement('span'), { className: 'found', textContent: `Found: ${v.browse?.total ?? 0}` }));
  }

  private renderMine(v: MarketView): void {
    const box = this.q('.lots');
    this.q('.pager').innerHTML = '';
    box.innerHTML = '';
    if (v.unavailable) { box.innerHTML = '<div class="empty">Market is unavailable without a server.</div>'; return; }
    if (!v.mine.length) { box.innerHTML = '<div class="empty">You have no active listings.<br>Click "Create Listing" on the right.</div>'; return; }

    const now = Date.now();
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Item</th><th>Price</th><th>Expires</th><th></th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const lot of v.mine) {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.append(this.itemCell(lot.item));
      const b = document.createElement('td'); b.append(this.priceCell(lot.price));
      const c = document.createElement('td'); c.className = 'sub'; c.textContent = fmtLeft(lot.expiresAt - now);
      const d = document.createElement('td');
      const cancel = Object.assign(document.createElement('button'), { className: 'btn sm danger', textContent: 'Cancel' });
      cancel.disabled = !!v.busy; // не даём запустить второе снятие во время текущего (гонка почты)
      cancel.addEventListener('click', () => this.actions.onCancel(lot.id));
      d.append(cancel);
      tr.append(a, b, c, d);
      tb.append(tr);
    }
    table.append(tb);
    box.append(table);
  }

  private renderHistory(v: MarketView): void {
    const box = this.q('.lots');
    this.q('.pager').innerHTML = '';
    box.innerHTML = '';
    if (v.unavailable) { box.innerHTML = '<div class="empty">Market is unavailable without a server.</div>'; return; }
    if (!v.history.length) { box.innerHTML = '<div class="empty">No trades yet.</div>'; return; }

    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Item</th><th>Price</th><th>Trade</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const h of v.history) {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.append(this.itemCell({ id: h.itemId, qty: h.qty }));
      const b = document.createElement('td'); b.append(this.priceCell(h.price));
      const c = document.createElement('td'); c.className = 'sub';
      c.textContent = h.sellerName && h.buyerName ? `${h.sellerName} → ${h.buyerName}` : '';
      tr.append(a, b, c);
      tb.append(tr);
    }
    table.append(tb);
    box.append(table);
  }

  private renderBag(v: MarketView): void {
    const bag = this.q('.bag');
    bag.innerHTML = '';
    v.bag.forEach((stack, i) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (stack) {
        const def = ITEMS[stack.id];
        cell.classList.add(`r-${rarityOf(stack.id)}`);
        if (def) cell.append(this.iconEl(def.icon));
        if (stack.qty > 1) cell.append(Object.assign(document.createElement('span'), { className: 'qty', textContent: String(stack.qty) }));
        if (stack.sharpen) cell.append(Object.assign(document.createElement('span'), { className: 'plus', textContent: `+${stack.sharpen}` }));
        cell.title = `${def?.name ?? stack.id}${stack.sharpen ? ` +${stack.sharpen}` : ''} — click to see stats and sell`;
        // Ячейка кликабельна всегда: сначала выбираем предмет и смотрим его
        // характеристики, и только потом жмём «Create Listing» и вводим цену.
        cell.classList.add('pick');
        if (this.pick?.index === i) cell.classList.add('sel');
        cell.addEventListener('click', () => this.selectItem(i));
      }
      bag.append(cell);
    });
  }

  // --- Диалог создания лота ---

  /** Открыть диалог цены. Предмет к этому моменту уже выбран кликом по сумке. */
  private openDialog(): void {
    if (!this.pick) { this.flash('Pick an item in your inventory first', false); return; }
    this.q('.dlg').classList.add('open');
    this.key = '';
    this.renderDialog();
    this.render();
  }

  /** Закрыть диалог. Выбор предмета НЕ сбрасываем: игрок мог просто передумать с ценой. */
  private closeDialog(): void {
    this.q('.dlg').classList.remove('open');
    this.key = '';
    this.render();
  }

  /** Клик по ячейке сумки: выбрать предмет (повторный клик по тому же — снять выбор). */
  private selectItem(index: number): void {
    const stack = this.state().bag[index];
    if (!stack) return;
    this.pick = this.pick?.index === index ? null : { index, qty: stack.qty, price: 0 };
    this.key = '';
    this.render();
  }

  /**
   * Характеристики выбранного предмета — под сумкой. Тот же набор строк, что в
   * тултипе инвентаря: игрок должен видеть, что именно выставляет (и с какой
   * заточкой), ДО того как назначит цену.
   */
  private renderDetails(v: MarketView): void {
    const box = this.q('.details');
    const stack = this.pick ? v.bag[this.pick.index] : null;
    if (!this.pick || !stack) {
      this.pick = null; // предмет пропал из сумки (продали/использовали) — снимаем выбор
      box.innerHTML = '<div class="none">Click an item in your inventory to see its stats and put it up for sale.</div>';
      return;
    }

    const def = ITEMS[stack.id];
    const rar = rarityOf(stack.id);
    const sharpen = stack.sharpen ?? 0;
    const isWeapon = def?.slot === 'weapon';
    const kind = MARKET_CATEGORIES.find((c) => c.id === marketCategory(stack.id))?.label ?? '';

    const rows: string[] = [];
    const row = (name: string, val: string, cls = ''): void => {
      rows.push(`<div class="ln"><span>${name}</span><b class="${cls}">${val}</b></div>`);
    };
    const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));

    if (def?.use?.hp) row('Restores', `+${def.use.hp} health`, 'plus');
    if (def?.use?.mp) row('Restores', `+${def.use.mp} mana`, 'plus');

    const b = def?.bonus;
    if (isWeapon) {
      row('Attack bonus', `+${(b?.dmg ?? 0) + sharpen}`, 'plus');
      if (sharpen > 0) row('Incl. sharpening', `+${sharpen}`, 'plus');
      if (def?.ranged) row('Combat', 'arrows, at range');
    } else if (b) {
      if (b.dmg) row('Attack', sign(b.dmg), b.dmg > 0 ? 'plus' : 'minus');
      if (b.def) row('Defense', sign(b.def), b.def > 0 ? 'plus' : 'minus');
      if (b.speed) row('Speed', sign(b.speed), b.speed > 0 ? 'plus' : 'minus');
      if (b.hp) row('Health', sign(b.hp), b.hp > 0 ? 'plus' : 'minus');
      if (b.mp) row('Mana', sign(b.mp), b.mp > 0 ? 'plus' : 'minus');
    }
    if (stack.qty > 1) row('In stack', String(stack.qty));

    box.innerHTML = `
      <div class="head">
        <div class="ico-wrap r-${rar}"></div>
        <div>
          <div class="nm r-${rar}">${def?.name ?? stack.id}${sharpen ? ` +${sharpen}` : ''}</div>
          <div class="kind">${RARITY_NAME[rar]}${kind ? ` · ${kind}` : ''}</div>
        </div>
      </div>
      ${rows.join('')}`;
    if (def) box.querySelector('.ico-wrap')!.append(this.iconEl(def.icon));
  }

  private renderDialog(): void {
    const body = this.q('.dlgbody');
    const stack = this.pick ? this.state().bag[this.pick.index] : null;
    // Сюда обычно не попадаем: диалог открывается только с выбранным предметом.
    // Страховка на случай, если предмет исчез из сумки, пока диалог был открыт.
    if (!this.pick || !stack) {
      body.innerHTML = '<div class="sub" style="text-align:center;padding:10px">That item is no longer in your bag.</div>' +
        '<div class="acts"><button class="btn cancel">Close</button></div>';
      body.querySelector('.cancel')!.addEventListener('click', () => this.closeDialog());
      return;
    }
    const def = ITEMS[stack.id];
    const maxQty = stack.qty;
    body.innerHTML = `
      <div class="row"><label>Item</label><b>${def?.name ?? stack.id}${stack.sharpen ? ` +${stack.sharpen}` : ''}</b></div>
      ${maxQty > 1 ? `<div class="row"><label>Quantity (1–${maxQty})</label><input class="txt qty" type="number" min="1" max="${maxQty}" value="${this.pick.qty}"></div>` : ''}
      <div class="row"><label>Price</label><input class="txt price" type="number" min="1" max="${MAX_PRICE}" value="${this.pick.price || ''}" placeholder="gold"></div>
      <div class="dlgerr"></div>
      <div class="acts">
        <button class="btn cancel danger">Cancel</button>
        <button class="btn go">List</button>
      </div>`;
    const qtyEl = body.querySelector<HTMLInputElement>('.qty');
    const priceEl = body.querySelector<HTMLInputElement>('.price')!;
    const errEl = body.querySelector<HTMLElement>('.dlgerr')!;
    body.querySelector('.cancel')!.addEventListener('click', () => this.closeDialog());
    body.querySelector('.go')!.addEventListener('click', () => {
      const qty = qtyEl ? Math.max(1, Math.min(maxQty, Math.floor(Number(qtyEl.value) || 1))) : 1;
      const raw = Math.floor(Number(priceEl.value) || 0);
      if (raw < 1) { errEl.textContent = 'Enter a price'; return; } // ошибку показываем в диалоге, а не в .notice под фоном
      const price = Math.min(MAX_PRICE, raw); // тот же потолок, что рисует input — не шлём заведомо отказную цену
      this.actions.onList({ id: stack.id, qty, ...(stack.sharpen ? { sharpen: stack.sharpen } : {}) }, price);
      this.pick = null; // предмет уходит на рынок — снимаем выбор, чтобы панель не показывала проданное
      this.closeDialog();
    });
  }

  destroy(): void {
    if (this.ticker !== undefined) window.clearInterval(this.ticker);
    this.root.remove();
    this.style.remove();
  }
}
