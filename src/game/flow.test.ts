import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlow, nextStep, UNREACHABLE } from './flow.ts';

/**
 * Карта рисуется строками: '.' — пройти можно, '#' — стена.
 * Так тест читается как картинка, а не как список индексов.
 */
function parse(rows: string[]): { width: number; height: number; walkable: (i: number) => boolean } {
  const width = rows[0].length;
  const cells = rows.join('');
  return { width, height: rows.length, walkable: (i) => cells[i] === '.' };
}

const flow = (rows: string[], target: number) => {
  const { width, height, walkable } = parse(rows);
  return { dist: buildFlow(width, height, walkable, target), width, height };
};

test('в чистом поле шаги считаются по прямой', () => {
  const { dist, width } = flow(['....', '....'], 0);
  assert.equal(dist[0], 0, 'сама цель');
  assert.equal(dist[3], 3, 'три шага вправо');
  assert.equal(dist[width], 1, 'клетка под целью');
});

test('стена не пропускает волну сквозь себя', () => {
  //  . # .
  //  . # .
  // Дойти справа налево можно только в обход, а обхода нет — стена во всю высоту.
  const { dist } = flow(['.#.', '.#.'], 0);
  assert.equal(dist[2], UNREACHABLE, 'за стеной пути нет');
  assert.equal(dist[1], UNREACHABLE, 'сама стена непроходима');
});

test('волна обходит препятствие', () => {
  // Стена с проходом снизу: путь длиннее прямой, но он есть.
  const rows = [
    '.#..',
    '.#..',
    '....',
  ];
  const { dist } = flow(rows, 0);
  assert.notEqual(dist[2], UNREACHABLE, 'за стену можно попасть в обход');
  assert.ok(dist[2] > 2, `в обход дольше прямой: ${dist[2]}`);
});

test('шаг ведёт к цели, а не от неё', () => {
  const rows = ['....', '....'];
  const { dist, width, height } = flow(rows, 0);

  const from = 3; // дальний угол строки
  const step = nextStep(dist, width, height, from);
  assert.notEqual(step, UNREACHABLE);
  assert.ok(dist[step] < dist[from], 'следующая клетка ближе к цели');
});

test('паук идёт вокруг стены, а не в неё', () => {
  // Тот самый случай со скрина: между пауком и игроком препятствие.
  //  И # П      И — игрок (цель), П — паук
  //  . # .
  //  . . .
  const rows = [
    '.#.',
    '.#.',
    '...',
  ];
  const { dist, width, height } = flow(rows, 0);

  let at = 2; // паук справа сверху
  const path = [at];
  for (let i = 0; i < 20 && dist[at] !== 0; i++) {
    at = nextStep(dist, width, height, at);
    assert.notEqual(at, UNREACHABLE, 'путь оборвался');
    path.push(at);
  }

  assert.equal(dist[at], 0, 'паук дошёл до игрока');
  assert.ok(!path.some((i) => i === 1 || i === 4), 'ни разу не пошёл в стену');
});

test('до островка за водой пути нет', () => {
  // Раньше паук с островка вечно тыкался бы в берег.
  const rows = [
    '.##.',
    '.##.',
  ];
  const { dist, width, height } = flow(rows, 0);
  assert.equal(dist[3], UNREACHABLE);
  assert.equal(nextStep(dist, width, height, 3), UNREACHABLE, 'идти некуда — пусть стоит');
});

test('стоя на цели, никуда не идём', () => {
  const { dist, width, height } = flow(['...'], 0);
  assert.equal(nextStep(dist, width, height, 0), UNREACHABLE);
});

test('наискось мимо угла стены не срезаем', () => {
  // Тонкий случай, ради которого и стоит проверка смежных клеток.
  //   0  1  2  3
  //   4  #  #  7
  //   8  #  10 11
  // Паук в клетке 10, цель — 0. Клетка 7 ближе (4 шага против 6), и соблазн
  // шагнуть в неё наискось есть. Но между 10 и 7 угол стены 6: протиснуться
  // мимо него нельзя, паук упрётся. Идти надо в 11 — длиннее, зато пройдёт.
  const rows = [
    '....',
    '.##.',
    '.#..',
  ];
  const { dist, width, height } = flow(rows, 0);

  assert.equal(dist[10], 6, 'паук в шести шагах');
  assert.equal(dist[7], 4, 'клетка наискось ближе — потому и соблазн');
  assert.equal(dist[6], UNREACHABLE, 'а между ними угол стены');

  assert.equal(nextStep(dist, width, height, 10), 11, 'пошёл в обход, а не сквозь угол');
});

test('до островка за водой пути нет, наискось тоже', () => {
  //  . #
  //  # .
  // Волна по сторонам туда не доходит вовсе — паук должен стоять, а не тыкаться.
  const rows = ['.#', '#.'];
  const { dist, width, height } = flow(rows, 0);

  assert.equal(dist[3], UNREACHABLE);
  assert.equal(nextStep(dist, width, height, 3), UNREACHABLE);
});

test('наискось идём, когда обход по стороне открыт', () => {
  const rows = ['..', '..'];
  const { dist, width, height } = flow(rows, 0);
  // Из дальнего угла (3) шаг наискось в цель (0) разрешён: обе смежные открыты.
  assert.equal(nextStep(dist, width, height, 3), 0, 'режем угол по диагонали');
});

test('цель в стене — волны нет', () => {
  // Не должно падать: игрок теоретически может оказаться в клетке, которую
  // разметили стеной уже после его появления.
  const { dist } = flow(['#..'], 0);
  assert.ok(dist.every((v) => v === UNREACHABLE));
});

test('шаг с левого края не перепрыгивает на правый', () => {
  // Классическая ошибка волны на плоском массиве: сосед «слева» у клетки с x=0
  // это конец предыдущей строки.
  const rows = [
    '..',
    '..',
  ];
  const { dist } = flow(rows, 0);
  assert.equal(dist[2], 1, 'под целью — один шаг');
  assert.equal(dist[1], 1, 'справа от цели — один шаг');
  assert.equal(dist[3], 2, 'по диагонали — два шага по сторонам');
});

test('волна по большой карте считается и не врёт', () => {
  // 90x70 — размер леса. Проверяем, что размеры не путаются местами.
  const width = 90;
  const height = 70;
  const dist = buildFlow(width, height, () => true, 0);
  assert.equal(dist[0], 0);
  assert.equal(dist[width - 1], width - 1, 'правый край первой строки');
  assert.equal(dist[(height - 1) * width], height - 1, 'левый край последней строки');
  assert.ok(dist.every((v) => v !== UNREACHABLE), 'в чистом поле достижимо всё');
});
