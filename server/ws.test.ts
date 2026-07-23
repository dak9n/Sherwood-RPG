import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptKey, encodeFrame, decodeFrame, OP_TEXT, OP_CONT, OP_PING, WsConn } from './ws.ts';
import { Duplex } from 'node:stream';

// Пример рукопожатия прямо из RFC 6455, §1.3 — если он сходится, sha1+base64
// склеены правильно.
test('acceptKey совпадает с примером из RFC 6455', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

/** Кадр «как из браузера»: с маской. Обратный путь к decodeFrame. */
function clientFrame(op: number, payload: Buffer, fin = true, mask = [1, 2, 3, 4]): Buffer {
  const n = payload.length;
  let head: Buffer;
  if (n < 126) head = Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | n]);
  else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = (fin ? 0x80 : 0) | op;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(n, 2);
  } else throw new Error('в тестах такие не нужны');
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([head, Buffer.from(mask), masked]);
}

test('кадр клиента расшифровывается: маска снята, длина верна', () => {
  const buf = clientFrame(OP_TEXT, Buffer.from('привет'));
  const f = decodeFrame(buf)!;
  assert.equal(f.op, OP_TEXT);
  assert.equal(f.fin, true);
  assert.equal(f.payload.toString('utf8'), 'привет');
  assert.equal(f.size, buf.length);
});

test('неполный кадр — null, ждём байтов', () => {
  const buf = clientFrame(OP_TEXT, Buffer.from('hello'));
  for (let cut = 0; cut < buf.length; cut++) {
    assert.equal(decodeFrame(buf.subarray(0, cut)), null, `cut=${cut}`);
  }
});

test('кадр без маски от клиента — ошибка протокола', () => {
  const server = encodeFrame(OP_TEXT, Buffer.from('hi')); // серверные кадры без маски
  assert.throws(() => decodeFrame(server), /masked/);
});

test('16-битная длина: 300 байт ходят туда и обратно', () => {
  const payload = Buffer.alloc(300, 0xab);
  const f = decodeFrame(clientFrame(OP_TEXT, payload))!;
  assert.equal(f.payload.length, 300);
  assert.deepEqual(f.payload, payload);
});

test('слишком большой кадр рвёт соединение, а не копит буфер', () => {
  const head = Buffer.from([0x81, 0x80 | 127, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4]);
  assert.throws(() => decodeFrame(head), /large/);
});

test('encodeFrame: короткая, 126+ и границы длин', () => {
  for (const n of [0, 125, 126, 65535, 65536]) {
    const buf = encodeFrame(OP_TEXT, Buffer.alloc(n, 7));
    // Серверный кадр обязан быть без маски: бит 0x80 второго байта снят.
    assert.equal(buf[1] & 0x80, 0, `n=${n}`);
  }
});

/** Пара труб: пишем в одну — читается из другой. Достаточно для WsConn. */
function fakeSocket(): { sock: Duplex; written: Buffer[] } {
  const written: Buffer[] = [];
  const sock = new Duplex({
    read() {},
    write(chunk: Buffer, _enc, cb) {
      written.push(Buffer.from(chunk));
      cb();
    },
  });
  return { sock, written };
}

test('WsConn собирает сообщение из TCP-кусков и фрагментов', () => {
  const { sock } = fakeSocket();
  const conn = new WsConn(sock);
  const got: string[] = [];
  conn.onMessage = (t) => got.push(t);

  // Сообщение двумя фрагментами, каждый порезан ещё и по-байтово.
  const f1 = clientFrame(OP_TEXT, Buffer.from('hel'), false);
  const f2 = clientFrame(OP_CONT, Buffer.from('lo'), true);
  for (const b of Buffer.concat([f1, f2])) sock.emit('data', Buffer.from([b]));

  assert.deepEqual(got, ['hello']);
});

test('WsConn отвечает pong на ping', () => {
  const { sock, written } = fakeSocket();
  new WsConn(sock);
  sock.emit('data', clientFrame(OP_PING, Buffer.from('hb')));
  const pong = written.at(-1)!;
  assert.equal(pong[0] & 0x0f, 0xa);
  assert.equal(pong.subarray(2).toString(), 'hb');
});

test('WsConn: мусор в протоколе закрывает соединение ровно один раз', () => {
  const { sock } = fakeSocket();
  const conn = new WsConn(sock);
  let closes = 0;
  conn.onClose = () => closes++;
  sock.emit('data', encodeFrame(OP_TEXT, Buffer.from('unmasked'))); // без маски
  sock.emit('data', Buffer.from([1, 2, 3]));
  assert.equal(closes, 1);
});
