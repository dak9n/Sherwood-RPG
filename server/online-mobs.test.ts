/**
 * Интеграция общих мобов: настоящий http-сервер, настоящая карта forest с
 * диска, два WebSocket-клиента. Если эти тесты зелёные, «у всех одни и те же
 * мобы, и убить можно одного и того же» доказано без браузера.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachOnline, type OnlineHandle } from './online.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function boot(): Promise<{ server: Server; handle: OnlineHandle; url: string }> {
  return new Promise((ok) => {
    const server = createServer((_req, res) => res.end('hi'));
    const handle = attachOnline(server, {
      auth: { keyOf: () => null, whoami: () => null },
      now: () => Date.now(),
      root: ROOT, // настоящие карты проекта — мир forest собирается с диска
      allowGuests: true,
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      ok({ server, handle, url: `ws://127.0.0.1:${addr.port}/__ws` });
    });
  });
}

interface Sock {
  ws: WebSocket;
  inbox: Record<string, unknown>[];
}

function connect(url: string, guest: string): Promise<Sock> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(url);
    const inbox: Record<string, unknown>[] = [];
    ws.onmessage = (e) => inbox.push(JSON.parse(String(e.data)) as Record<string, unknown>);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', guest }));
    const t = setInterval(() => {
      if (inbox.some((m) => m.t === 'ok')) {
        clearInterval(t);
        ok({ ws, inbox });
      }
    }, 10);
    ws.onerror = () => fail(new Error('ws error'));
    setTimeout(() => fail(new Error('auth timeout')), 3000).unref();
  });
}

/** Последнее сообщение типа t, удовлетворяющее pick. Ждём: снимки ходят раз в 100 мс. */
function waitFor<T>(inbox: Record<string, unknown>[], pick: (m: Record<string, unknown>) => T | null, ms = 4000): Promise<T> {
  return new Promise((ok, fail) => {
    const t = setInterval(() => {
      for (let i = inbox.length - 1; i >= 0; i--) {
        const hit = pick(inbox[i]);
        if (hit !== null) {
          clearInterval(t);
          ok(hit);
          return;
        }
      }
    }, 10);
    setTimeout(() => {
      clearInterval(t);
      fail(new Error('нужное сообщение так и не пришло'));
    }, ms).unref();
  });
}

type Mob = { id: number; k: string; x: number; y: number; hp: number; m: string };
const mobsOf = (m: Record<string, unknown>): Mob[] | null => (m.t === 'mobs' ? (m.ms as Mob[]) : null);

const pos = (x: number, y: number) =>
  JSON.stringify({ t: 'pos', map: 'forest', x, y, anim: 'sw-idle-down', helm: null, body: null, dead: false });

const ctx = await boot();
after(() => {
  ctx.handle.close();
  ctx.server.close();
});

test('двое на forest видят ОДНИХ и тех же мобов, урон и смерть общие', async () => {
  const a = await connect(ctx.url, 'Робин');
  const b = await connect(ctx.url, 'Мэриан');
  a.ws.send(pos(100, 100));
  b.ws.send(pos(120, 100));

  const seenByA = await waitFor(a.inbox, mobsOf);
  const seenByB = await waitFor(b.inbox, mobsOf);
  assert.ok(seenByA.length > 0, 'на карте есть мобы');
  // Одинаковые: те же id, виды и дома. Позиции могли сдвинуться между
  // снимками — сверяем состав, а не пиксели.
  assert.deepEqual(seenByA.map((m) => [m.id, m.k]), seenByB.map((m) => [m.id, m.k]));

  // А бьёт первого моба — health падает У ОБОИХ.
  const target = seenByA[0];
  a.ws.send(JSON.stringify({ t: 'hit', id: target.id, dmg: 5 }));
  const afterHit = await waitFor(b.inbox, (m) => {
    const ms = mobsOf(m);
    const hit = ms?.find((x) => x.id === target.id);
    return hit && hit.hp === target.hp - 5 ? hit : null;
  });
  assert.equal(afterHit.hp, target.hp - 5);

  // Добивает — kill приходит ему и только ему, моб мёртв у обоих.
  a.ws.send(JSON.stringify({ t: 'hit', id: target.id, dmg: 999 }));
  const kill = await waitFor(a.inbox, (m) => (m.t === 'kill' ? m : null));
  assert.equal(kill.id, target.id);
  await waitFor(b.inbox, (m) => {
    const ms = mobsOf(m);
    const dead = ms?.find((x) => x.id === target.id);
    return dead && dead.m === 'dead' ? dead : null;
  });
  assert.equal(b.inbox.some((m) => m.t === 'kill'), false, 'kill получает только убийца');

  a.ws.close();
  b.ws.close();
});

test('моб гонится за близким игроком и кусает его — событие mobhit жертве', async () => {
  const c = await connect(ctx.url, 'Приманка');
  // Встаём прямо на первого моба: сервер начнёт замах и укусит.
  const first = await (async () => {
    c.ws.send(pos(0, 0));
    const ms = await waitFor(c.inbox, mobsOf);
    return ms.find((m) => m.m !== 'dead')!;
  })();

  const stand = setInterval(() => c.ws.send(pos(first.x, first.y)), 100);
  try {
    const bite = await waitFor(c.inbox, (m) => (m.t === 'mobhit' ? m : null), 6000);
    assert.ok((bite.dmg as number) > 0);
  } finally {
    clearInterval(stand);
    c.ws.close();
  }
});
