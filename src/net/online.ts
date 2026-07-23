/**
 * Клиент онлайна: соединение с /__ws, вход, позиции и чат.
 *
 * Чистая сеть без Phaser — сцена подписывается на колбэки и сама решает, как
 * рисовать. Протокол зеркален server/online.ts; предъявляем либо токен сессии
 * (аккаунт), либо гостевое имя — гостей пускает только дев-сервер.
 *
 * Обрывы — норма жизни (ноут уснул, Wi-Fi мигнул): переподключаемся сами, с
 * растущей паузой. Игра при этом продолжается — просто без чужих героев,
 * ровно как игралось до онлайна.
 */

/** Чужой герой, как его знает сервер. */
export interface RemoteRow {
  /** Стабильный ключ игрока: спрайт держится за него, а не за имя. */
  id: string;
  name: string;
  map: string;
  x: number;
  y: number;
  /** Ключ анимации целиком (`sw-walk-down`) — проигрывается как есть. */
  anim: string;
  helm: string | null;
  body: string | null;
  weapon: string | null;
}

export interface PosUpdate {
  map: string;
  x: number;
  y: number;
  anim: string;
  helm: string | null;
  body: string | null;
  weapon: string | null;
  /** Мёртвого героя серверные мобы не трогают. */
  dead: boolean;
}

/** Добыча на земле — общая: видят все, забирает первый дошедший. */
export interface LootRow {
  id: number;
  item: string;
  qty: number;
  x: number;
  y: number;
}

/**
 * Чужой боевой эффект: снаряд, вспышка, цифра урона. Чистая картинка — урон
 * никогда не считается по fx, только по hit/mobhit.
 */
export interface FxMsg {
  kind: string;
  x?: number;
  y?: number;
  angle?: number;
  dmg?: number;
  mobId?: number;
  crit?: boolean;
  heavy?: boolean;
}

/** Общий моб, каким его знает сервер (см. server/world.ts). */
export interface MobRow {
  id: number;
  /** Вид из ALL_CREATURES ('spider1') — по нему берутся статы и спрайты. */
  k: string;
  x: number;
  y: number;
  hp: number;
  /** Режим: idle | chase | leash | attack | dead. */
  m: string;
  /** Куда смотрит: down | left | right | up. */
  d: string;
}

type Auth = { token: string } | { guest: string };

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export class OnlineClient {
  /** Кто ещё на моей карте. Приходит ~10 раз в секунду. */
  onRoster: (ps: RemoteRow[]) => void = () => {};
  onChat: (from: string, text: string) => void = () => {};
  /** Онлайн появился/пропал — сцена пишет об этом в чат, чтобы было понятно. */
  onStatus: (online: boolean) => void = () => {};
  /** Мобы карты — общие для всех игроков. Приходят ~10 раз в секунду. */
  onMobs: (ms: MobRow[]) => void = () => {};
  /** Моб укусил МЕНЯ: сервер решил, клиент считает броню и показывает цифру. */
  onMobHit: (id: number, dmg: number) => void = () => {};
  /** Мой удар оказался смертельным: опыт мой (добыча уже лежит на земле у всех). */
  onKill: (id: number) => void = () => {};
  /** Добыча на земле — общая для всех на карте. */
  onLoot: (ls: LootRow[]) => void = () => {};
  /** Мой подбор удался: сервер отдал мне item×qty. */
  onTaken: (id: number, item: string, qty: number) => void = () => {};
  /** Чужой боевой эффект: нарисовать и забыть. */
  onFx: (fx: FxMsg) => void = () => {};

  private ws: WebSocket | null = null;
  private authed = false;
  private retryMs = RECONNECT_MIN_MS;
  private retryTimer = 0;
  private dead = false;
  private authOf: () => Auth | null;

  /**
   * Кем представляться, спрашиваем В МОМЕНТ отправки, а не при создании:
   * сцена заводит клиента раньше, чем узнаёт имя героя из сейва, — жёстко
   * запомненный auth уносил пустое имя и получал вечное «auth failed».
   * Null — представиться пока нечем: тихо ждём переподключения.
   */
  constructor(authOf: () => Auth | null) {
    this.authOf = authOf;
    this.connect();
  }

  private connect(): void {
    if (this.dead) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/__ws`);
    this.ws = ws;

    ws.onopen = () => {
      const auth = this.authOf();
      if (!auth) {
        ws.close(); // им ещё не назвались — попробуем следующим заходом
        return;
      }
      ws.send(JSON.stringify({ t: 'auth', ...auth }));
    };
    ws.onmessage = (e) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.t === 'ok') {
        this.authed = true;
        this.retryMs = RECONNECT_MIN_MS; // соединение состоялось — пауза с нуля
        this.onStatus(true);
      } else if (msg.t === 'roster' && Array.isArray(msg.ps)) {
        this.onRoster(msg.ps as RemoteRow[]);
      } else if (msg.t === 'mobs' && Array.isArray(msg.ms)) {
        this.onMobs(msg.ms as MobRow[]);
      } else if (msg.t === 'mobhit' && typeof msg.id === 'number' && typeof msg.dmg === 'number') {
        this.onMobHit(msg.id, msg.dmg);
      } else if (msg.t === 'kill' && typeof msg.id === 'number') {
        this.onKill(msg.id);
      } else if (msg.t === 'loot' && Array.isArray(msg.ls)) {
        this.onLoot(msg.ls as LootRow[]);
      } else if (msg.t === 'taken' && typeof msg.id === 'number' && typeof msg.item === 'string') {
        this.onTaken(msg.id, msg.item, Number(msg.qty) || 1);
      } else if (msg.t === 'fx' && typeof msg.kind === 'string') {
        this.onFx(msg as unknown as FxMsg);
      } else if (msg.t === 'chat' && typeof msg.from === 'string' && typeof msg.text === 'string') {
        this.onChat(msg.from, msg.text);
      }
    };
    ws.onclose = () => this.scheduleRetry();
    ws.onerror = () => ws.close();
  }

  private scheduleRetry(): void {
    if (this.ws) {
      this.ws = null;
      if (this.authed) this.onStatus(false);
      this.authed = false;
    }
    if (this.dead || this.retryTimer) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
  }

  /** Готов ли канал: до входа слать позиции некому. */
  get online(): boolean {
    return this.authed && this.ws?.readyState === WebSocket.OPEN;
  }

  sendPos(p: PosUpdate): void {
    if (this.online) this.ws!.send(JSON.stringify({ t: 'pos', ...p }));
  }

  sendChat(text: string): void {
    if (this.online) this.ws!.send(JSON.stringify({ t: 'chat', text }));
  }

  /** Я ударил моба id на dmg. Смертельный ли — решит сервер (придёт kill). */
  sendHit(id: number, dmg: number): void {
    if (this.online) this.ws!.send(JSON.stringify({ t: 'hit', id, dmg }));
  }

  /** Подбираю добычу id; влезает max. Ответ придёт событием taken (или никак). */
  sendTake(id: number, max: number): void {
    if (this.online) this.ws!.send(JSON.stringify({ t: 'take', id, max }));
  }

  /** Показать мой эффект остальным. Дешёвая картинка — шлём и забываем. */
  sendFx(fx: FxMsg): void {
    if (this.online) this.ws!.send(JSON.stringify({ t: 'fx', ...fx }));
  }

  destroy(): void {
    this.dead = true;
    window.clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }
}
