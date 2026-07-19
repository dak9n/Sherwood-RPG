/**
 * Ручка дев-сервера для редактора анимации оружия (?anim).
 *
 * Пишет src/game/weapon-anchors.json — таблицу поз оружия по кадрам. Ту же
 * таблицу умеет считать tools/weapon-anchors.mjs, но автоматика знает лишь то,
 * что нарисовано; последнее слово за глазом художника, поэтому позы правятся
 * руками и сохраняются сюда.
 *
 * Живёт только при `apply: 'serve'` — как и сохранение карт: в собранной игре
 * никаких записей на диск нет.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const FILE = 'src/game/weapon-anchors.json';
const BACKUP_DIR = '.map-backups/anchors';
const MAX_BODY = 512 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

/** Беглая проверка формы: пускать в файл что попало нельзя — по нему рисуется игра. */
function validate(data: unknown): string | null {
  const d = data as { bladeLen?: unknown; anims?: Record<string, unknown> };
  if (!d || typeof d !== 'object') return 'not an object';
  if (typeof d.bladeLen !== 'number' || !(d.bladeLen > 0)) return 'bladeLen must be a positive number';
  if (!d.anims || typeof d.anims !== 'object') return 'anims missing';

  for (const [key, raw] of Object.entries(d.anims)) {
    const a = raw as { cols?: unknown; rows?: unknown; frames?: unknown };
    if (!Number.isInteger(a.cols) || !Number.isInteger(a.rows)) return `${key}: cols/rows must be integers`;
    if (!Array.isArray(a.frames)) return `${key}: frames must be an array`;
    if (a.frames.length !== (a.cols as number) * (a.rows as number)) {
      return `${key}: ${a.frames.length} frames instead of ${(a.cols as number) * (a.rows as number)}`;
    }
    for (const f of a.frames) {
      if (f === null) continue;
      const p = f as Record<string, unknown>;
      for (const n of ['x', 'y', 'angle', 'len']) {
        if (typeof p[n] !== 'number' || !Number.isFinite(p[n])) return `${key}: frame field ${n} must be a number`;
      }
    }
  }
  return null;
}

export function saveAnchorsPlugin(): Plugin {
  return {
    name: 'save-anchors',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const file = resolve(root, FILE);
      const backups = resolve(root, BACKUP_DIR);

      server.middlewares.use('/__save-anchors', (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') return next();
        void (async () => {
          const send = (code: number, body: unknown): void => {
            res.statusCode = code;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(body));
          };

          if (!req.headers['content-type']?.includes('application/json')) {
            return send(415, { ok: false, error: 'content-type: application/json required' });
          }

          let data: unknown;
          try {
            data = JSON.parse(await readBody(req));
          } catch {
            return send(400, { ok: false, error: 'body could not be parsed as json' });
          }

          const bad = validate(data);
          if (bad) return send(400, { ok: false, error: bad });

          // Копия прежней версии: правки поз легко испортить одним неудачным
          // перетаскиванием, а откатиться должно быть можно без git.
          if (existsSync(file)) {
            mkdirSync(backups, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            copyFileSync(file, resolve(backups, `weapon-anchors.${stamp}.json`));
          }

          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
          send(200, { ok: true });
        })().catch((e: Error) => {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        });
      });

      // Текущая таблица: редактор читает её при открытии.
      server.middlewares.use('/__anchors', (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('content-type', 'application/json');
        res.end(existsSync(file) ? readFileSync(file, 'utf8') : '{}');
      });
    },
  };
}
