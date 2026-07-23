/**
 * Интеграция онлайна ЦЕЛИКОМ: настоящий node:http сервер, настоящий WebSocket
 * из Node (тот же RFC 6455, что в браузере) — и наши ws.ts + online.ts между
 * ними. Если эти тесты зелёные, «двое видят друг друга и переписываются»
 * доказано без браузера.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { attachOnline, type OnlineHandle } from './online.ts';

/** Поднять сервер онлайна на свободном порту. Гостей пускаем — токены тут не нужны. */
function boot(): Promise<{ server: Server; handle: OnlineHandle; url: string }> {
  return new Promise((ok) => {
    const server = createServer((_req, res) => res.end('hi'));
    // Аккаунтов в этом тесте нет: auth отвергает любой токен, вход только гостям.
    const handle = attachOnline(server, {
      auth: { keyOf: () => null, whoami: () => null },
      now: () => Date.now(),
      allowGuests: true,
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      ok({ server, handle, url: `ws://127.0.0.1:${addr.port}/__ws` });
    });
  });
}

/** Клиент теста: браузерный API WebSocket есть и в Node. */
function connect(url: string, guest: string): Promise<{ ws: WebSocket; inbox: unknown[] }> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(url);
    const inbox: unknown[] = [];
    ws.onmessage = (e) => inbox.push(JSON.parse(String(e.data)));
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', guest }));
    const t = setInterval(() => {
      if (inbox.some((m) => (m as { t: string }).t === 'ok')) {
        clearInterval(t);
        ok({ ws, inbox });
      }
    }, 10);
    ws.onerror = () => fail(new Error('ws error'));
    setTimeout(() => fail(new Error('auth timeout')), 3000).unref();
  });
}

/** Подождать, пока в ящике появится сообщение с предикатом (ростер ходит раз в 100 мс). */
function waitFor<T>(inbox: unknown[], pick: (m: unknown) => T | null, ms = 2000): Promise<T> {
  return new Promise((ok, fail) => {
    const t = setInterval(() => {
      for (const m of inbox) {
        const hit = pick(m);
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

type Roster = { t: string; ps: { id: string; name: string; x: number; anim: string }[] };

const ctx = await boot();
after(() => {
  ctx.handle.close();
  ctx.server.close();
});

test('двое на одной карте видят друг друга, третий на другой — никого', async () => {
  const a = await connect(ctx.url, 'Робин');
  const b = await connect(ctx.url, 'Мэриан');
  const c = await connect(ctx.url, 'Отшельник');

  a.ws.send(JSON.stringify({ t: 'pos', map: 'forest', x: 10, y: 20, anim: 'sw-idle-down', helm: null, body: null }));
  b.ws.send(JSON.stringify({ t: 'pos', map: 'forest', x: 30, y: 40, anim: 'sw-walk-left', helm: 'helm1', body: null }));
  c.ws.send(JSON.stringify({ t: 'pos', map: 'macos', x: 5, y: 5, anim: 'sw-idle-down', helm: null, body: null }));

  // А видит ровно Мэриан — с её позицией и анимацией.
  const seenByA = await waitFor(a.inbox, (m) => {
    const r = m as Roster;
    return r.t === 'roster' && r.ps.length ? r : null;
  });
  assert.deepEqual(seenByA.ps.map((p) => p.name), ['Мэриан']);
  assert.equal(seenByA.ps[0].x, 30);
  assert.equal(seenByA.ps[0].anim, 'sw-walk-left');

  // Отшельник на другой карте: его ростер пуст, самого его в лесу нет.
  assert.equal(seenByA.ps.some((p) => p.name === 'Отшельник'), false);
  const seenByC = await waitFor(c.inbox, (m) => {
    const r = m as Roster;
    return r.t === 'roster' ? r : null;
  });
  assert.equal(seenByC.ps.length, 0);

  // Чат: Робин говорит — слышит Мэриан, но не Отшельник и не сам Робин.
  a.ws.send(JSON.stringify({ t: 'chat', text: 'Привет, лес!' }));
  const heard = await waitFor(b.inbox, (m) => {
    const r = m as { t: string; from?: string; text?: string };
    return r.t === 'chat' ? r : null;
  });
  assert.equal(heard.from, 'Робин');
  assert.equal(heard.text, 'Привет, лес!');
  assert.equal(a.inbox.some((m) => (m as { t: string }).t === 'chat'), false);

  // Уход: Мэриан закрывает вкладку — лес для Робина пустеет.
  b.ws.close();
  await waitFor(a.inbox, (m) => {
    const r = m as Roster;
    return r.t === 'roster' && r.ps.length === 0 ? r : null;
  });

  a.ws.close();
  c.ws.close();
});

test('без auth первым сообщением соединение рвётся', async () => {
  const ws = new WebSocket(ctx.url);
  const closed = new Promise<void>((ok) => { ws.onclose = () => ok(); });
  ws.onopen = () => ws.send(JSON.stringify({ t: 'pos', map: 'forest', x: 1, y: 1 }));
  await closed; // не дождались бы — тест упал по таймауту
});

test('кривой токен без гостевого имени получает отказ', async () => {
  const ws = new WebSocket(ctx.url);
  const inbox: unknown[] = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(String(e.data)));
  const closed = new Promise<void>((ok) => { ws.onclose = () => ok(); });
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: 'фальшивка' }));
  await closed;
  assert.deepEqual(inbox, [{ t: 'err', error: 'auth failed' }]);
});
