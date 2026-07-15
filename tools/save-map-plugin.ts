import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateMap } from '../src/map/validate.ts';
import { serialize } from '../src/map/format.ts';
import type { GameMap } from '../src/map/types.ts';

const MAP_PATH = 'public/assets/maps/forest.json';
/** Бэкапы и временный файл — вне public/: оттуда всё уезжает в сборку и вотчится. */
const BACKUP_DIR = '.map-backups';
const KEEP_BACKUPS = 20;
const MAX_BODY = 32 * 1024 * 1024;

/** Ревизия — это хеш того, что сейчас на диске. По ней ловим правку файла в обход редактора. */
function revisionOf(path: string): string {
  if (!existsSync(path)) return 'none';
  return createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 12);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('тело запроса больше 32 МБ'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    // Склеиваем буферы и только потом декодируем: кириллица рвётся на границе чанков.
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function backup(mapPath: string, backupDir: string): string | null {
  if (!existsSync(mapPath)) return null;
  mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `forest-${stamp}.json`;
  copyFileSync(mapPath, resolve(backupDir, name));

  const old = readdirSync(backupDir)
    .filter((f) => f.startsWith('forest-') && f.endsWith('.json'))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) unlinkSync(resolve(backupDir, f));

  return name;
}

/** Пишем во временный файл и переименовываем: прерванная запись не должна оставить обрубок карты. */
function writeAtomic(path: string, text: string, tmpDir: string): void {
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(path), { recursive: true });

  const tmp = resolve(tmpDir, 'forest.tmp.json');
  writeFileSync(tmp, text, 'utf8');

  const fd = openSync(tmp, 'r');
  fsyncSync(fd);
  closeSync(fd);

  renameSync(tmp, path);
}

/**
 * Приём карты из редактора. Живёт только на дев-сервере: в собранной игре ручки,
 * перезаписывающей файлы, не существует даже теоретически.
 */
export function saveMapPlugin(): Plugin {
  return {
    name: 'save-map',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const mapPath = resolve(root, MAP_PATH);
      const backupDir = resolve(root, BACKUP_DIR);

      server.middlewares.use('/__map-meta', (req, res, next) => {
        if (req.method !== 'GET') return next();
        send(res, 200, { revision: revisionOf(mapPath) });
      });

      server.middlewares.use('/__save-map', (req, res, next) => {
        // Роутить по req.url тут нельзя: connect срезает префикс при mount,
        // и внутри обработчика url всегда '/'.
        if (req.method !== 'POST') return next();

        // Требование json-тела — это и есть защита от чужой вкладки: такой запрос
        // перестаёт быть простым, и браузер сначала спросит preflight, который
        // чужой origin не пройдёт.
        if (!req.headers['content-type']?.includes('application/json')) {
          return send(res, 415, { error: 'нужен content-type: application/json' });
        }

        readBody(req)
          .then((raw) => {
            let payload: { baseRevision?: string; force?: boolean; map?: GameMap };
            try {
              payload = JSON.parse(raw);
            } catch (e) {
              return send(res, 400, { error: `тело не разобралось как json: ${(e as Error).message}` });
            }

            const errors = validateMap(payload.map);
            if (errors.length) return send(res, 422, { error: 'карта не прошла проверку', errors });

            const revision = revisionOf(mapPath);
            if (!payload.force && payload.baseRevision !== revision) {
              // Файл поменялся в обход редактора — не затираем молча.
              return send(res, 409, {
                error: 'файл на диске изменился с момента загрузки',
                revision,
              });
            }

            const text = serialize(payload.map as GameMap);
            try {
              JSON.parse(text); // контрольная проверка до того, как трогаем настоящий файл
            } catch (e) {
              return send(res, 500, { error: `сериализация дала битый json: ${(e as Error).message}` });
            }

            const saved = backup(mapPath, backupDir);
            writeAtomic(mapPath, text, backupDir);

            send(res, 200, { revision: revisionOf(mapPath), backup: saved });
          })
          .catch((e: Error) => send(res, 400, { error: e.message }));
      });
    },
  };
}
