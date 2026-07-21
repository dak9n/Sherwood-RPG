/**
 * Те же серверные ручки, но на дев-сервере Vite.
 *
 * Раньше здесь лежали и сами ручки — двести строк, существовавшие только под
 * `vite dev`. Комментарий над ними это признавал: «Для настоящего онлайна тот же
 * AuthStore нужно поднять отдельным сервером». Теперь он поднят — server/main.ts,
 * — а тела ручек переехали в server/http/router.ts.
 *
 * От файла осталось то, чем он и должен быть: переходник между цепочкой
 * middleware у Vite и общим роутером. Это не уборка ради уборки. Пока копии
 * кода было две, «на деве работает, в проде нет» оставалось вопросом времени —
 * а прод у игры теперь есть.
 */

import type { Plugin, ViteDevServer } from 'vite';
import { handleApi } from './http/router.ts';
import { buildDeps } from './deps.ts';

export function authPlugin(): Plugin {
  return {
    name: 'auth',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // Состояние готовится асинхронно (пустышка для защиты от тайминга считается
      // тем же scrypt, что и настоящие пароли), поэтому ждём его в каждом запросе,
      // а не задерживаем старт дев-сервера.
      const ready = buildDeps(server.config.root);

      server.middlewares.use((req, res, next) => {
        void ready
          .then((deps) => handleApi(req, res, deps))
          .then((handled) => {
            // Не наш путь — отдаём дальше по цепочке: там статика, HMR и редактор.
            if (!handled) next();
          })
          .catch(next);
      });
    },
  };
}
