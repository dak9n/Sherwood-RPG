import { createHash } from 'node:crypto';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateMap } from '../src/map/validate.ts';
import { serialize } from '../src/map/format.ts';
import { isSafeMapName } from '../src/map/name.ts';
import type { GameMap } from '../src/map/types.ts';

const MAPS_DIR = 'public/assets/maps';
/** Карта по умолчанию: запрос без имени бьёт в forest.json — так старый клиент работает без правок. */
const DEFAULT_MAP = 'forest';
/** Бэкапы и временный файл — вне public/: оттуда всё уезжает в сборку и вотчится. */
const BACKUP_DIR = '.map-backups';
const KEEP_BACKUPS = 20;
const MAX_BODY = 32 * 1024 * 1024;

/**
 * Единственный контроль безопасности имён. isSafeMapName (тот же, что у клиента)
 * пропускает лишь буквы/цифры/дефис/подчёркивание — значит '.', '/', '\\', ':' и
 * пробелы невыразимы, поэтому '..', расширения, абсолютные и UNC-пути, диски и
 * виндовые устройства (CON, NUL…) отсеиваются здесь.
 */
function safeName(raw: unknown): string | null {
  return typeof raw === 'string' && isSafeMapName(raw) ? raw : null;
}

/** Путь к файлу карты + защита в глубину: даже при будущем ослаблении регэкспа файл не уедет из maps/. */
function mapPathFor(mapsDir: string, name: string): string {
  const p = resolve(mapsDir, name + '.json');
  if (!p.startsWith(mapsDir + sep)) throw new Error(`имя «${name}» выходит за пределы папки карт`);
  return p;
}

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

/**
 * Бэкап в подпапку своей карты: .map-backups/<name>/<stamp>.json. Подпапки, а не
 * префикс имени — иначе прунинг «forest» по startsWith('forest-') сожрал бы
 * бэкапы «forest-old» (дефис в именах разрешён). Каждая карта чистит только себя.
 */
function backup(mapPath: string, backupDir: string, name: string): string | null {
  if (!existsSync(mapPath)) return null;
  const dir = resolve(backupDir, name);
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = `${stamp}.json`;
  copyFileSync(mapPath, resolve(dir, file));

  const old = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const f of old) unlinkSync(resolve(dir, f));

  return `${name}/${file}`;
}

/** Пишем во временный файл и переименовываем: прерванная запись не должна оставить обрубок карты. */
function writeAtomic(path: string, text: string, tmpDir: string, name: string): void {
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(path), { recursive: true });

  // Имя и pid в temp: сохранения разных карт (или два процесса) не топчут общий файл.
  const tmp = resolve(tmpDir, `${name}.${process.pid}.tmp.json`);
  // Пишем и fsync-аем через один дескриптор: fsync по 'r'-дескриптору
  // на Windows падает с EPERM — FlushFileBuffers требует права записи.
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(tmp, path);
}

/** Имя карты из query-строки; DEFAULT_MAP, если не задано. null — имя небезопасно. */
function nameFromQuery(req: IncomingMessage): string | null {
  const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name');
  return safeName(raw ?? DEFAULT_MAP);
}

/**
 * Приём и раздача карт из редактора. Живёт только на дев-сервере: в собранной
 * игре ручки, перезаписывающей файлы, не существует даже теоретически.
 */
export function saveMapPlugin(): Plugin {
  return {
    name: 'save-map',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const mapsDir = resolve(root, MAPS_DIR);
      const backupDir = resolve(root, BACKUP_DIR);

      // Список карт для стартового экрана. Только .json-файлы с безопасным именем —
      // чужое и небезопасное редактор всё равно не откроет.
      server.middlewares.use('/__maps', (req, res, next) => {
        if (req.method !== 'GET') return next();
        if (!existsSync(mapsDir)) return send(res, 200, { maps: [] });
        const maps = readdirSync(mapsDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.slice(0, -'.json'.length))
          .filter((n) => safeName(n) !== null && statSync(resolve(mapsDir, n + '.json')).isFile());
        send(res, 200, { maps });
      });

      server.middlewares.use('/__map-meta', (req, res, next) => {
        if (req.method !== 'GET') return next();
        const name = nameFromQuery(req);
        if (name === null) return send(res, 400, { error: 'недопустимое имя карты' });
        send(res, 200, { name, revision: revisionOf(mapPathFor(mapsDir, name)) });
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
            let payload: { name?: string; baseRevision?: string; force?: boolean; map?: GameMap };
            try {
              payload = JSON.parse(raw);
            } catch (e) {
              return send(res, 400, { error: `тело не разобралось как json: ${(e as Error).message}` });
            }

            const name = safeName(payload.name ?? DEFAULT_MAP);
            if (name === null) return send(res, 400, { error: 'недопустимое имя карты' });
            const mapPath = mapPathFor(mapsDir, name);

            const errors = validateMap(payload.map);
            if (errors.length) return send(res, 422, { error: 'карта не прошла проверку', errors });

            const revision = revisionOf(mapPath);
            if (!payload.force && payload.baseRevision !== revision) {
              // Файл поменялся в обход редактора (или карта с таким именем уже есть) — не затираем молча.
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

            const saved = backup(mapPath, backupDir, name);
            writeAtomic(mapPath, text, backupDir, name);

            send(res, 200, { name, revision: revisionOf(mapPath), backup: saved });
          })
          .catch((e: Error) => send(res, 400, { error: e.message }));
      });
    },
  };
}
