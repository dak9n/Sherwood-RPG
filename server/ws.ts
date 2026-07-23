/**
 * WebSocket-сервер без зависимостей: рукопожатие и кадры RFC 6455 руками.
 *
 * Почему не пакет `ws`: у сервера ноль внешних зависимостей — аккаунты на
 * scrypt из node:crypto, роутер и статика свои. Нам от протокола нужно
 * немногое: текстовые сообщения браузера туда и обратно, ping и close. Это
 * ~200 строк честного кода, а кодек кадров — чистые функции, покрытые тестами.
 *
 * Ограничения сознательные: бинарные кадры не принимаем (протокол игры —
 * JSON-текст), сообщение больше 64 КиБ рвёт соединение (позициям и чату
 * столько не нужно, а копить мегабайты от клиента — путь к OOM).
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';

/** Магическая строка рукопожатия — константа из RFC 6455, §1.3. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Ключ ответа Sec-WebSocket-Accept. Отдельно — проверяется тестом по примеру из RFC. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64');
}

export const OP_CONT = 0x0;
export const OP_TEXT = 0x1;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** Максимум собранного сообщения. Больше — обрыв: клиент игры столько не шлёт. */
const MAX_MESSAGE = 64 * 1024;

/** Кадр сервера: без маски (сервер по RFC маскировать не должен). */
export function encodeFrame(op: number, payload: Buffer): Buffer {
  const n = payload.length;
  let head: Buffer;
  if (n < 126) {
    head = Buffer.from([0x80 | op, n]);
  } else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | op;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | op;
    head[1] = 127;
    // Верхние 4 байта нулевые: больше 4 ГиБ мы не шлём по определению.
    head.writeUInt32BE(0, 2);
    head.writeUInt32BE(n, 6);
  }
  return Buffer.concat([head, payload]);
}

export interface Frame {
  fin: boolean;
  op: number;
  payload: Buffer;
  /** Сколько байт кадр занял во входном буфере. */
  size: number;
}

/**
 * Разобрать ОДИН кадр из начала буфера. null — байтов пока мало, ждём ещё.
 * Бросает на нарушениях протокола (нет маски от клиента, безразмерный кадр):
 * такой сокет чинить нечем, соединение закрывается.
 */
export function decodeFrame(buf: Buffer): Frame | null {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  if (buf[0] & 0x70) throw new Error('reserved bits set');
  const op = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  // Клиент ОБЯЗАН маскировать (RFC 6455, §5.1) — немаскированный кадр это
  // либо не браузер, либо прокси-мусор. И то и другое — до свидания.
  if (!masked) throw new Error('client frame must be masked');

  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const hi = buf.readUInt32BE(2);
    const lo = buf.readUInt32BE(6);
    if (hi !== 0 || lo > MAX_MESSAGE) throw new Error('frame too large');
    len = lo;
    off = 10;
  }
  if (len > MAX_MESSAGE) throw new Error('frame too large');

  if (buf.length < off + 4 + len) return null;
  const mask = buf.subarray(off, off + 4);
  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) payload[i] = buf[off + 4 + i] ^ mask[i % 4];
  return { fin, op, payload, size: off + 4 + len };
}

/**
 * Одно соединение: собирает кадры из TCP-кусков, склеивает фрагменты,
 * отвечает на ping и отдаёт наружу готовые текстовые сообщения.
 */
export class WsConn {
  /** Пришло текстовое сообщение целиком. */
  onMessage: (text: string) => void = () => {};
  /** Соединение умерло — по close, ошибке или обрыву. Зовётся ровно один раз. */
  onClose: () => void = () => {};

  // Явная аннотация: alloc(0) выводится как Buffer<ArrayBuffer>, а subarray
  // возвращает Buffer<ArrayBufferLike> — без неё присваивание не типизируется.
  private buf: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private partsLen = 0;
  private closed = false;
  private socket: Duplex;

  // Не parameter property: сервер работает под `node --experimental-strip-types`,
  // а strip-режим такой синтаксис не понимает.
  constructor(socket: Duplex) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      try {
        this.feed(chunk);
      } catch {
        this.destroy(); // мусор в протоколе — соединение не лечится
      }
    });
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());
  }

  private feed(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const f = decodeFrame(this.buf);
      if (!f) return;
      this.buf = this.buf.subarray(f.size);
      this.handle(f);
      if (this.closed) return;
    }
  }

  private handle(f: Frame): void {
    if (f.op === OP_CLOSE) {
      // Вежливый выход: эхо close и обрыв. Повторно slать нечего.
      this.socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
      this.destroy();
      return;
    }
    if (f.op === OP_PING) {
      this.socket.write(encodeFrame(OP_PONG, f.payload));
      return;
    }
    if (f.op === OP_PONG) return; // ответ на наш ping — жив, и ладно

    if (f.op === OP_TEXT || f.op === OP_CONT) {
      // Фрагментацию браузеры для мелких сообщений не используют, но RFC её
      // разрешает — собираем честно, с тем же потолком размера.
      if (f.op === OP_TEXT && this.parts.length) throw new Error('nested fragments');
      if (f.op === OP_CONT && !this.parts.length) throw new Error('continuation without start');
      this.parts.push(f.payload);
      this.partsLen += f.payload.length;
      if (this.partsLen > MAX_MESSAGE) throw new Error('message too large');
      if (!f.fin) return;
      const whole = Buffer.concat(this.parts);
      this.parts = [];
      this.partsLen = 0;
      this.onMessage(whole.toString('utf8'));
      return;
    }
    throw new Error(`unsupported opcode ${f.op}`); // бинарные кадры игре не нужны
  }

  /** Отправить текстовое сообщение. Молча глотает, если сокет уже мёртв. */
  send(text: string): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(OP_TEXT, Buffer.from(text, 'utf8')));
    } catch {
      this.destroy();
    }
  }

  ping(): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(OP_PING, Buffer.alloc(0)));
    } catch {
      this.destroy();
    }
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onClose();
  }
}

/**
 * Повесить обработчик upgrade на http-сервер: путь `path` — наш, остальные не
 * трогаем (у Vite на том же сервере живёт свой WebSocket для HMR).
 */
export function attachWs(
  server: Server,
  path: string,
  onConnection: (conn: WsConn, req: IncomingMessage) => void,
): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== path) return; // чужой upgrade (HMR) — пусть берут другие

    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    const conn = new WsConn(socket);
    // Байты, пришедшие вместе с рукопожатием, — уже кадры клиента.
    if (head.length) socket.emit('data', head);
    onConnection(conn, req);
  });
}
