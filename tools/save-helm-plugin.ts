/**
 * Ручка дев-сервера для редактора шлемов (?helm).
 *
 * Принимает нарисованную полосу 128x32 (четыре ячейки 32x32 по направлениям)
 * и пишет её в public/assets/helmets/<id>.png — оттуда игра штампует шлем на
 * голову героя. Заодно пересобирает manifest.json: по нему игра знает, какие
 * шлемы нарисованы, и не сыплет 404 по ненарисованным.
 *
 * Живёт только при `apply: 'serve'`, как и остальные дев-ручки.
 */

import { writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ITEMS } from '../src/game/items.ts';

const DIR = 'public/assets/helmets';
const BACKUP_DIR = '.map-backups/helmets';
const MAX_BODY = 256 * 1024;
/** Полоса шлема: 4 ячейки 32x32. */
const STRIP_W = 128;
const STRIP_H = 32;

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

/** PNG 128x32? Магия + размеры из IHDR, без полного разбора. */
function validPng(buf: Buffer): string | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return 'not a png';
  if (buf.readUInt32BE(16) !== STRIP_W || buf.readUInt32BE(20) !== STRIP_H) {
    return `strip must be ${STRIP_W}x${STRIP_H}, got ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  }
  return null;
}

export function saveHelmPlugin(): Plugin {
  return {
    name: 'save-helm',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const dir = resolve(root, DIR);
      const backups = resolve(root, BACKUP_DIR);

      server.middlewares.use('/__save-helm', (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'POST') return next();
        void (async () => {
          const send = (code: number, body: unknown): void => {
            res.statusCode = code;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(body));
          };

          let data: { id?: unknown; png?: unknown };
          try {
            data = JSON.parse(await readBody(req));
          } catch {
            return send(400, { ok: false, error: 'body could not be parsed as json' });
          }

          const { id, png } = data;
          // Шлем должен существовать как предмет: файл на чужое имя игра не подберёт.
          if (typeof id !== 'string' || ITEMS[id]?.slot !== 'helm') {
            return send(400, { ok: false, error: `${String(id)} is not a helm item` });
          }
          if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) {
            return send(400, { ok: false, error: 'png must be a png data url' });
          }
          const buf = Buffer.from(png.slice('data:image/png;base64,'.length), 'base64');
          const bad = validPng(buf);
          if (bad) return send(400, { ok: false, error: bad });

          // Прежняя версия — в копию: одно неудачное сохранение не должно
          // стоить нарисованного руками шлема.
          const file = resolve(dir, `${id}.png`);
          if (existsSync(file)) {
            mkdirSync(backups, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            copyFileSync(file, resolve(backups, `${id}.${stamp}.png`));
          }

          mkdirSync(dir, { recursive: true });
          writeFileSync(file, buf);

          // Манифест — с диска, а не из запроса: он обязан отражать файлы.
          const ids = readdirSync(dir)
            .filter((f) => f.endsWith('.png'))
            .map((f) => f.slice(0, -4))
            .sort();
          writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(ids, null, 1) + '\n');

          send(200, { ok: true });
        })().catch((e: Error) => {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        });
      });
    },
  };
}
