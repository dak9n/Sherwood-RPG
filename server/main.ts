/**
 * Игровой сервер. Отдельный процесс, живущий без Vite.
 *
 * Запуск:
 *   npm run build && npm run serve
 *
 * До сих пор сервера у игры не было вовсе: ручки аккаунтов жили внутри плагина
 * дев-сервера с `apply: 'serve'`, то есть в собранной игре отсутствовали. Играть
 * вдвоём было физически негде — второй человек получал index.html и надпись
 * «Authorization server unavailable».
 *
 * Здесь только сокет и склейка: сначала пробуем ручки (server/http/router.ts),
 * потом статику из dist/ (server/http/static.ts). Порядок именно такой, потому
 * что все ручки начинаются с '/__', а такого файла в сборке быть не может.
 *
 * Дальше сюда добавится обработчик upgrade — рукопожатие WebSocket. Ради него
 * сервер и поднимается на голом node:http, а не отдаётся какому-нибудь готовому
 * раздатчику статики: апгрейд соединения нужен на том же порту, что и страница.
 */

import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { handleApi } from './http/router.ts';
import { serveStatic } from './http/static.ts';
import { send } from './http/body.ts';
import { buildDeps } from './deps.ts';
import { ENABLE_MARKET } from './flags.ts';
import { attachOnline } from './online.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

/** Порт из окружения: на хостинге его назначают снаружи. 5174 — чтобы не спорить с `vite dev` на 5173. */
const PORT = Number(process.env.PORT ?? 5174);
/**
 * По умолчанию слушаем все интерфейсы, иначе с другого компьютера в той же сети
 * не зайти — а ровно за этим сервер и написан. HOST=127.0.0.1 сужает обратно.
 */
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  if (!existsSync(DIST)) {
    console.error(`Нет папки ${DIST}. Сначала соберите игру: npm run build`);
    process.exit(1);
  }

  const deps = await buildDeps(ROOT);

  const server = createServer((req, res) => {
    void (async () => {
      if (await handleApi(req, res, deps)) return;
      if (serveStatic(req, res, DIST)) return;
      send(res, 404, { error: 'not found' });
    })().catch((e: Error) => {
      // Сюда доходит только то, что не поймал сам роутер: например, обрыв связи
      // на середине чтения тела. Ронять процесс из-за одного запроса нельзя —
      // вместе с ним вылетят все, кто сейчас играет.
      console.error('запрос упал:', e.message);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  });

  // Тот самый обещанный upgrade: онлайн живёт на том же порту, что страница.
  // Гостей боевой сервер не пускает — только аккаунты. root — для миров мобов:
  // сервер читает карты и расселяет общих на всех монстров.
  attachOnline(server, { auth: deps.store, now: deps.now, root: ROOT });

  server.listen(PORT, HOST, () => {
    console.log(`Sherwood RPG: http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') console.log('  в локальной сети — по адресу этого компьютера на том же порту');
    console.log(`  рынок: ${ENABLE_MARKET ? 'ВКЛЮЧЁН' : 'закрыт (сервер ещё не проверяет предметы и золото)'}`);
    console.log('  онлайн: игроки видят друг друга (WebSocket /__ws)');
  });

  // Ctrl+C и `kill` от супервизора: даём дочитать текущие ответы, а не рвём их.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log('\nостанавливаюсь…');
      server.close(() => process.exit(0));
      // Если кто-то держит соединение (а с WebSocket это станет нормой) — не ждём вечно.
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

void main();
