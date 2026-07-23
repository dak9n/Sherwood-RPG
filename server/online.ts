/**
 * Онлайн: игроки видят друг друга. Склейка WebSocket (ws.ts) и присутствия
 * (presence-store.ts) — та самая надстройка, ради которой server/main.ts
 * поднимался на голом node:http.
 *
 * Протокол — JSON-текст, сообщения от клиента:
 *   {t:'auth', token}            — первым сообщением; в dev можно {t:'auth', guest:'Имя'}
 *   {t:'pos', map,x,y,anim,helm,body,dead} — «я тут», шлётся на ходу ~10 раз/с
 *   {t:'chat', text}             — сказать всем на своей карте
 *   {t:'hit', id, dmg}           — я ударил моба id на dmg
 * И от сервера:
 *   {t:'ok', name}               — вход принят
 *   {t:'roster', ps:[...]}       — кто ещё на этой карте (каждые 100 мс)
 *   {t:'mobs', ms:[...]}         — мобы карты: у ВСЕХ одни и те же (каждые 100 мс)
 *   {t:'chat', from, text}
 *   {t:'mobhit', id, dmg}        — моб id укусил ТЕБЯ
 *   {t:'kill', id}               — твой удар был смертельным: забирай опыт и добычу
 *
 * Мобами владеет сервер (world.ts): он их расселяет, водит и хоронит. Клиент
 * присылает только урон — сколько именно, считает клиент (криты, заточка), а
 * сервер лишь не верит в невозможное.
 *
 * Токен ходит в СООБЩЕНИИ, не в query: адреса запросов оседают в логах, а
 * токен сессии в логах — это почти пароль в логах.
 *
 * Личность игрока определяет сервер по токену, а не клиент по полю name:
 * иначе любой мог бы писать в чат от чужого имени.
 */

import type { Server } from 'node:http';
import { attachWs, type WsConn } from './ws.ts';
import { PresenceStore, type RosterRow } from './presence-store.ts';
import { loadWorld } from './world-load.ts';
import type { MapWorld } from './world.ts';

/** Что онлайну нужно от аккаунтов. Структурно, чтобы не тянуть весь AuthStore. */
export interface OnlineAuth {
  keyOf(token: unknown, now: number): string | null;
  whoami(token: unknown, now: number): string | null;
}

export interface OnlineOptions {
  auth: OnlineAuth;
  now: () => number;
  /**
   * Корень проекта — там лежат public/assets/maps и каталог тайлсетов. По ним
   * строятся серверные миры мобов. Не задан — онлайн живёт без мобов (тесты).
   */
  root?: string;
  /**
   * Пускать гостей по одному имени, без аккаунта. ТОЛЬКО дев-сервер Vite:
   * там же живёт ?guest. Боевой сервер (main.ts) гостей не знает — иначе
   * любой аноним писал бы в чат под любым именем.
   */
  allowGuests?: boolean;
}

/** Как часто рассылается ростер. 10 раз в секунду хватает: клиент дотягивает движением. */
const ROSTER_MS = 100;
/** Ping и prune — раз в 5 секунд, чтобы NAT не забывал соединение. */
const KEEPALIVE_TICKS = 50;
/** Не назвался за это время — до свидания: слот не для молчунов. */
const AUTH_TIMEOUT_MS = 5000;
const MAX_CHAT = 200;
const MAX_NAME = 24;

/** Управляющие символы вон: NUL в имени и перевод строки в чате ломают вёрстку. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

interface Client {
  conn: WsConn;
  key: string;
  name: string;
  map: string;
}

export interface OnlineHandle {
  close(): void;
  /** Сколько игроков в мире — для лога и тестов. */
  size(): number;
}

export function attachOnline(server: Server, opts: OnlineOptions): OnlineHandle {
  const presence = new PresenceStore();
  const clients = new Map<string, Client>(); // ключ аккаунта -> живое соединение
  let guestSeq = 0;

  const sendTo = (c: Client, msg: unknown): void => c.conn.send(JSON.stringify(msg));

  /**
   * Миры мобов — лениво, по одному на карту: собирать все карты на старте
   * значило бы платить за миры, в которые никто не заходил. null — карта не
   * собралась (нет файла, битый JSON): запоминаем, чтобы не читать диск на
   * каждый pos.
   */
  const worlds = new Map<string, MapWorld | null>();
  const worldOf = (map: string): MapWorld | null => {
    if (!opts.root) return null;
    let w = worlds.get(map);
    if (w === undefined) {
      w = loadWorld(opts.root, map);
      worlds.set(map, w);
    }
    return w;
  };

  attachWs(server, '/__ws', (conn) => {
    let me: Client | null = null;

    // Не назвался вовремя — обрыв. Таймер снимается при auth и при close.
    const authTimer = setTimeout(() => {
      if (!me) conn.destroy();
    }, AUTH_TIMEOUT_MS);
    authTimer.unref?.();

    conn.onMessage = (text) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        conn.destroy(); // не-JSON здесь не ходит; чинить нечего
        return;
      }

      if (!me) {
        if (msg.t !== 'auth') {
          conn.destroy();
          return;
        }
        const now = opts.now();
        let key: string | null = null;
        let name: string | null = null;
        if (typeof msg.token === 'string') {
          key = opts.auth.keyOf(msg.token, now);
          name = opts.auth.whoami(msg.token, now);
        } else if (opts.allowGuests && typeof msg.guest === 'string') {
          // Гость: имя чистится, ключ уникален на соединение — двойник не нужен.
          const clean = msg.guest.replace(CONTROL, '').trim().slice(0, MAX_NAME);
          if (clean) {
            key = `guest#${++guestSeq}`;
            name = clean;
          }
        }
        if (!key || !name) {
          conn.send(JSON.stringify({ t: 'err', error: 'auth failed' }));
          conn.destroy();
          return;
        }
        clearTimeout(authTimer);
        // Тот же аккаунт со второй вкладки: старое соединение уступает новому,
        // иначе два «я» дерутся за одну запись присутствия.
        clients.get(key)?.conn.destroy();
        me = { conn, key, name, map: '' };
        clients.set(key, me);
        sendTo(me, { t: 'ok', name });
        return;
      }

      if (msg.t === 'pos') {
        if (typeof msg.map !== 'string' || !msg.map) return;
        me.map = msg.map;
        worldOf(msg.map); // первый гость на карте будит её мир
        presence.upsert(me.key, {
          name: me.name,
          map: msg.map,
          x: Number(msg.x),
          y: Number(msg.y),
          anim: typeof msg.anim === 'string' ? msg.anim.slice(0, 40) : '',
          helm: typeof msg.helm === 'string' ? msg.helm.slice(0, 40) : null,
          body: typeof msg.body === 'string' ? msg.body.slice(0, 40) : null,
          dead: msg.dead === true,
          ts: opts.now(),
        });
        return;
      }

      if (msg.t === 'hit') {
        // Удар по мобу. Сервер применяет урон к ОБЩЕМУ мобу; смертельный удар
        // возвращается убийце событием kill — опыт и добычу начисляет он сам.
        const world = me.map ? worldOf(me.map) : null;
        if (!world || typeof msg.id !== 'number') return;
        if (world.hit(msg.id, Number(msg.dmg), me.key, opts.now()) === 'dead') {
          sendTo(me, { t: 'kill', id: msg.id });
        }
        return;
      }

      if (msg.t === 'chat') {
        if (typeof msg.text !== 'string') return;
        const text = msg.text.replace(CONTROL, ' ').trim().slice(0, MAX_CHAT);
        if (!text || !me.map) return;
        for (const c of clients.values()) {
          if (c !== me && c.map === me.map) sendTo(c, { t: 'chat', from: me.name, text });
        }
        return;
      }
      // Неизвестный тип — молча мимо: старый сервер не должен рвать новый клиент.
    };

    conn.onClose = () => {
      clearTimeout(authTimer);
      if (me && clients.get(me.key)?.conn === conn) {
        clients.delete(me.key);
        presence.remove(me.key);
      }
    };
  });

  // Один общий пульс: миры и ростер каждые 100 мс, ping и чистка — каждые 5 с.
  let tick = 0;
  let lastTickAt = opts.now();
  const timer = setInterval(() => {
    tick++;
    const now = opts.now();
    const dt = Math.min(1000, now - lastTickAt); // после зависания не прыгаем на минуту
    lastTickAt = now;

    if (tick % KEEPALIVE_TICKS === 0) {
      for (const key of presence.prune(now)) {
        clients.get(key)?.conn.destroy();
      }
      for (const c of clients.values()) c.conn.ping();
    }

    // Миры живут, даже когда все ушли: мобы должны догулять домой и воскреснуть
    // к возвращению игроков. Укусы уходят адресно — тому, кого укусили.
    for (const [map, world] of worlds) {
      if (!world) continue;
      for (const ev of world.tick(now, dt, presence.playersFor(map))) {
        const victim = clients.get(ev.player);
        if (victim) sendTo(victim, { t: 'mobhit', id: ev.mobId, dmg: ev.dmg });
      }
    }

    if (!clients.size) return;
    for (const c of clients.values()) {
      if (!c.map) continue;
      const ps: RosterRow[] = presence.listFor(c.map, c.key);
      sendTo(c, { t: 'roster', ps });
      const world = worlds.get(c.map);
      if (world) sendTo(c, { t: 'mobs', ms: world.snapshot() });
    }
  }, ROSTER_MS);
  timer.unref?.();

  return {
    close: () => {
      clearInterval(timer);
      for (const c of clients.values()) c.conn.destroy();
    },
    size: () => clients.size,
  };
}
