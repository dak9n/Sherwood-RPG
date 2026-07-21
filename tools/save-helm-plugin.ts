/**
 * Ручка дев-сервера для редактора брони (?helm).
 *
 * Принимает нарисованную полосу 128x32 (четыре ячейки 32x32 по направлениям)
 * и пишет её в public/assets/worn/<id>.png — оттуда игра штампует шлем на
 * голову героя, а нагрудник на корпус. Заодно пересобирает manifest.json: по
 * нему игра знает, какие спрайты нарисованы, и не сыплет 404 по остальным.
 *
 * Живёт только при `apply: 'serve'`, как и остальные дев-ручки.
 */

import { writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ITEMS } from '../src/game/items.ts';

const DIR = 'public/assets/worn';
/**
 * Маски волос: та же полоса 128x32, но закрашенное в ней значит «здесь голову
 * не рисовать». Лежат в подпапке, а не рядом, намеренно — манифест собирается
 * обходом *.png в DIR, и файл mask рядом попал бы в него как несуществующий
 * предмет.
 */
const MASK_DIR = 'public/assets/worn/mask';
/** Покадровые поправки посадки: лист -> номер кадра -> [dx, dy]. */
const OFFSET_DIR = 'public/assets/worn/offset';
const BACKUP_DIR = '.map-backups/worn';
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

          let data: { id?: unknown; png?: unknown; mask?: unknown; offsets?: unknown };
          try {
            data = JSON.parse(await readBody(req));
          } catch {
            return send(400, { ok: false, error: 'body could not be parsed as json' });
          }

          const { id, png, mask, offsets } = data;
          // Предмет должен существовать и быть шлемом или нагрудником: файл на
          // чужое имя игра не подберёт, а другие слоты на герое не рисуются.
          const slot = typeof id === 'string' ? ITEMS[id]?.slot : undefined;
          if (typeof id !== 'string' || (slot !== 'helm' && slot !== 'body')) {
            return send(400, { ok: false, error: `${String(id)} is not a helm or body item` });
          }
          if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) {
            return send(400, { ok: false, error: 'png must be a png data url' });
          }
          const buf = Buffer.from(png.slice('data:image/png;base64,'.length), 'base64');
          const bad = validPng(buf);
          if (bad) return send(400, { ok: false, error: bad });

          // Маску проверяем ДО первой записи на диск.
          //
          // Раньше порядок был обратный: шлем уже лежал на диске, резервная
          // копия израсходована, — и только потом выяснялось, что маска битая, и
          // запрос падал с 400. Манифест при этом не пересобирался, и выходило
          // худшее из состояний: «сохранил, а в игре нет».
          const maskDir = resolve(root, MASK_DIR);
          const maskFile = resolve(maskDir, `${id}.png`);
          let mbuf: Buffer | null = null;
          if (typeof mask === 'string') {
            if (!mask.startsWith('data:image/png;base64,')) {
              return send(400, { ok: false, error: 'mask must be a png data url' });
            }
            mbuf = Buffer.from(mask.slice('data:image/png;base64,'.length), 'base64');
            const mbad = validPng(mbuf);
            if (mbad) return send(400, { ok: false, error: `mask: ${mbad}` });
          }

          // Прежняя версия — в копию: одно неудачное сохранение не должно
          // стоить нарисованного руками шлема.
          const file = resolve(dir, `${id}.png`);
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          if (existsSync(file)) {
            mkdirSync(backups, { recursive: true });
            copyFileSync(file, resolve(backups, `${id}.${stamp}.png`));
          }

          mkdirSync(dir, { recursive: true });
          writeFileSync(file, buf);

          // Маска: пришла — пишем, пришёл null — удаляем. Второе и есть
          // «Clear hair + Save»: маски у этого шлема больше нет.
          //
          // Удаляем ТОЖЕ через копию. Маска рисуется руками и стоит не меньше
          // самого шлема, а прийти null может не только по воле владельца: не
          // догрузился файл маски — редактор увидел пустые слои и честно послал
          // «маски нет». Без копии это стирало бы работу безвозвратно.
          if (mbuf) {
            mkdirSync(maskDir, { recursive: true });
            if (existsSync(maskFile)) {
              mkdirSync(backups, { recursive: true });
              copyFileSync(maskFile, resolve(backups, `${id}.mask.${stamp}.png`));
            }
            writeFileSync(maskFile, mbuf);
          } else if (mask === null && existsSync(maskFile)) {
            mkdirSync(backups, { recursive: true });
            copyFileSync(maskFile, resolve(backups, `${id}.mask.${stamp}.png`));
            rmSync(maskFile);
          }

          // Поправки кадров: пришли — пишем, пришёл null — удаляем.
          //
          // Проверяем форму на входе: файл читает игра, и мусор в нём сдвинул бы
          // броню в случайную сторону на случайном кадре — искать такое потом
          // пришлось бы глазами по всем 132 кадрам.
          const offDir = resolve(root, OFFSET_DIR);
          const offFile = resolve(offDir, `${id}.json`);
          if (offsets && typeof offsets === 'object') {
            for (const [sheet, frames] of Object.entries(offsets as Record<string, unknown>)) {
              if (!frames || typeof frames !== 'object') {
                return send(400, { ok: false, error: `offsets.${sheet} is not an object` });
              }
              for (const [fr, pair] of Object.entries(frames as Record<string, unknown>)) {
                if (!Number.isInteger(Number(fr))) return send(400, { ok: false, error: `offsets.${sheet}: frame "${fr}" is not a number` });
                if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((v) => Number.isInteger(v))) {
                  return send(400, { ok: false, error: `offsets.${sheet}[${fr}] must be [dx, dy] of whole pixels` });
                }
              }
            }
            mkdirSync(offDir, { recursive: true });
            writeFileSync(offFile, JSON.stringify(offsets, null, 1) + '\n');
          } else if (offsets === null && existsSync(offFile)) {
            rmSync(offFile);
          }

          mkdirSync(offDir, { recursive: true });
          const offIds = readdirSync(offDir)
            .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
            .map((f) => f.slice(0, -5))
            .sort();
          writeFileSync(resolve(offDir, 'manifest.json'), JSON.stringify(offIds, null, 1) + '\n');

          // Манифест — с диска, а не из запроса: он обязан отражать файлы.
          // Подпапку mask сюда не пускаем: это не предмет.
          const ids = readdirSync(dir)
            .filter((f) => f.endsWith('.png'))
            .map((f) => f.slice(0, -4))
            .sort();
          writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(ids, null, 1) + '\n');

          // У масок свой манифест: игра грузит только те, что есть, иначе 404
          // на каждый шлем без маски.
          mkdirSync(maskDir, { recursive: true });
          const maskIds = readdirSync(maskDir)
            .filter((f) => f.endsWith('.png'))
            .map((f) => f.slice(0, -4))
            .sort();
          writeFileSync(resolve(maskDir, 'manifest.json'), JSON.stringify(maskIds, null, 1) + '\n');

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
