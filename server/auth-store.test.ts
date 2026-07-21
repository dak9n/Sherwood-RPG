import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore, type UserRecord, type SessionRecord } from './auth-store.ts';

/** Хранилище с болванкой persist: проверяем логику, а не диск. */
const make = async (initial: UserRecord[] = []) => {
  const saved: UserRecord[][] = [];
  const store = await AuthStore.create(initial, (u) => saved.push(u));
  return { store, saved };
};

const T0 = 1_000_000;

test('регистрация создаёт аккаунт и сразу впускает', async () => {
  const { store, saved } = await make();
  const r = await store.register('Геко', 'secret123', T0);

  assert.equal(r.ok, true);
  assert.equal(r.name, 'Геко', 'имя показываем как ввели');
  assert.match(r.token!, /^[0-9a-f]{64}$/, 'выдан токен сессии');
  assert.equal(saved.length, 1, 'записали на диск один раз');
  assert.equal(saved[0][0].hash.includes('secret123'), false, 'пароль в записи не открытым текстом');
});

test('второй раз то же имя не занять — и регистр не спасает', async () => {
  const { store } = await make();
  await store.register('geko', 'secret123', T0);

  assert.equal((await store.register('geko', 'other123', T0)).ok, false, 'ровно то же');
  const dup = await store.register('  GEKO ', 'other123', T0);
  assert.equal(dup.ok, false, 'другой регистр и пробелы — тот же игрок');
  assert.match(dup.error!, /taken/);
});

test('слабое имя или пароль не регистрируются', async () => {
  const { store, saved } = await make();
  assert.equal((await store.register('ab', 'secret123', T0)).ok, false, 'имя короткое');
  assert.equal((await store.register('нормально', '123', T0)).ok, false, 'пароль короткий');
  assert.equal(saved.length, 0, 'ничего не записали');
});

test('вход: верный пароль впускает, неверный — нет', async () => {
  const { store } = await make();
  await store.register('geko', 'correct-pw', T0);

  const ok = await store.login('geko', 'correct-pw', T0);
  assert.equal(ok.ok, true);
  assert.equal(ok.name, 'geko');

  const bad = await store.login('geko', 'wrong-pw', T0);
  assert.equal(bad.ok, false);
});

test('ошибка входа общая — не выдаёт, какое имя существует', async () => {
  // Раздельные «нет имени» / «пароль не тот» — подсказка взломщику.
  const { store } = await make();
  await store.register('geko', 'correct-pw', T0);

  const нетИмени = await store.login('никто', 'что-угодно', T0);
  const неТотПароль = await store.login('geko', 'wrong-pw', T0);
  assert.equal(нетИмени.error, неТотПароль.error, 'формулировки должны совпадать');
});

test('сессия узнаёт вошедшего по токену', async () => {
  const { store } = await make();
  const r = await store.register('Ден', 'secret123', T0);

  assert.equal(store.whoami(r.token, T0), 'Ден');
  assert.equal(store.whoami('чужой-токен', T0), null);
  assert.equal(store.whoami(undefined, T0), null);
});

test('протухшая сессия больше не пускает', async () => {
  const { store } = await make();
  const r = await store.register('Ден', 'secret123', T0);

  const месяц = 30 * 24 * 60 * 60 * 1000;
  assert.equal(store.whoami(r.token, T0 + месяц - 1), 'Ден', 'ещё жива');
  assert.equal(store.whoami(r.token, T0 + месяц + 1), null, 'протухла');
});

test('выход гасит токен', async () => {
  const { store } = await make();
  const r = await store.register('Ден', 'secret123', T0);

  store.logout(r.token, T0);
  assert.equal(store.whoami(r.token, T0), null, 'после выхода токен мёртв');
});

test('сессии переживают перезапуск процесса', async () => {
  // Ради этого сервер и стал отдельным процессом: игрок не должен вылетать из
  // игры оттого, что автор поправил файл и дев-сервер перечитал конфиг.
  const saved: SessionRecord[][] = [];
  const sessions = { initial: [] as SessionRecord[], persist: (s: SessionRecord[]) => saved.push(s) };

  const first = await AuthStore.create([], () => {}, sessions);
  const r = await first.register('Ден', 'secret123', T0);
  assert.equal(saved.at(-1)!.length, 1, 'выдачу токена записали');

  // Новый процесс: те же пользователи, те же сессии с диска.
  const users: UserRecord[] = [
    { name: 'Ден', nameKey: 'ден', hash: 'неважно', createdAt: T0 },
  ];
  const second = await AuthStore.create(users, () => {}, { initial: saved.at(-1)!, persist: () => {} });
  assert.equal(second.whoami(r.token, T0), 'Ден', 'старый токен всё ещё пускает');
});

test('протухшие сессии на диск не уезжают', async () => {
  const saved: SessionRecord[][] = [];
  const store = await AuthStore.create([], () => {}, {
    initial: [{ token: 'старый', nameKey: 'кто-то', expiresAt: T0 - 1 }],
    persist: (s) => saved.push(s),
  });

  await store.register('Ден', 'secret123', T0);
  assert.equal(
    saved.at(-1)!.some((s) => s.token === 'старый'),
    false,
    'мёртвая сессия не воскресает при следующей записи',
  );
});

test('перебор пароля запирает имя, верный пароль до запирания — впускает', async () => {
  const { store } = await make();
  await store.register('geko', 'correct-pw', T0);

  // 7 промахов — ещё пускает попытки
  for (let i = 0; i < 7; i++) await store.login('geko', 'wrong', T0);
  assert.equal((await store.login('geko', 'correct-pw', T0)).ok, true, 'до предела верный пароль работает');
});

test('после предела промахов имя заперто даже с верным паролем', async () => {
  const { store } = await make();
  await store.register('geko', 'correct-pw', T0);

  for (let i = 0; i < 8; i++) await store.login('geko', 'wrong', T0);
  const locked = await store.login('geko', 'correct-pw', T0);
  assert.equal(locked.ok, false, 'заперто');
  assert.match(locked.error!, /attempts/);

  // Через 5 минут отпускает.
  const ok = await store.login('geko', 'correct-pw', T0 + 5 * 60 * 1000 + 1);
  assert.equal(ok.ok, true, 'после паузы снова можно');
});

test('загруженные с диска пользователи входят', async () => {
  // Первый запуск создал аккаунт, сервер перезапустился, запись прочли с диска.
  const first = await make();
  const r = await first.store.register('geko', 'my-password', T0);
  assert.equal(r.ok, true);
  const onDisk = first.saved.at(-1)!;

  const second = await make(onDisk);
  assert.equal((await second.store.login('geko', 'my-password', T0)).ok, true);
});

test('keyOf отдаёт ключ аккаунта по токену, без регистра', async () => {
  const { store } = await make();
  const r = await store.register('Геко', 'secret123', T0);

  assert.equal(store.keyOf(r.token, T0), 'геко', 'нормализованный ключ, а не показное имя');
  assert.equal(store.keyOf('чужой', T0), null);
  assert.equal(store.keyOf(undefined, T0), null);

  const месяц = 30 * 24 * 60 * 60 * 1000;
  assert.equal(store.keyOf(r.token, T0 + месяц + 1), null, 'протухшая сессия ключа не даёт');
});

test('параллельный перебор НЕ обходит защиту (гонка TOCTOU)', async () => {
  // Дыра: 200 одновременных /__login проскакивали ворота до первого noteFail.
  // Очередь делает вход последовательным — после 8 промахов остальное заперто.
  const { store } = await make();
  await store.register('victim', 'correct-pw', T0);

  const попытки = await Promise.all(
    Array.from({ length: 200 }, (_, i) => store.login('victim', `guess-${i}`, T0)),
  );
  const впустили = попытки.filter((r) => r.ok).length;
  const заперто = попытки.filter((r) => /attempts/.test(r.error ?? '')).length;

  assert.equal(впустили, 0, 'ни один неверный пароль не должен впустить');
  assert.ok(заперто >= 190, `почти все должны упереться в замок, а заперто ${заперто}`);
});

test('параллельная регистрация одного имени создаёт ровно один аккаунт', async () => {
  // Гонка: два /__register одним именем оба проскакивали проверку занятости.
  const { store } = await make();
  const оба = await Promise.all([
    store.register('geko', 'pw-one-123', T0),
    store.register('geko', 'pw-two-123', T0),
  ]);
  assert.equal(оба.filter((r) => r.ok).length, 1, 'ровно один успех');
  assert.equal(оба.filter((r) => !r.ok).length, 1, 'второй — отказ «занято»');
});
