/**
 * Поиск пути для монстров.
 *
 * Раньше паук просто разворачивался носом к игроку и шёл напролом: дерево или
 * пруд между ними — и он упирался в препятствие, толкая его до бесконечности.
 *
 * ПОЧЕМУ ВОЛНА, А НЕ ПОИСК ПУТИ НА КАЖДОГО. Цель у всех одна — игрок. Значит
 * дешевле один раз пустить волну ОТ игрока по всем проходимым клеткам и дать
 * каждому пауку читать из неё готовый ответ, чем гонять по поиску на каждого из
 * шестнадцати. Волна по карте 90x70 — это 6300 клеток, считается за доли
 * миллисекунды, и пересчитывать её надо, только когда игрок перешёл в другую
 * клетку. Паук потом смотрит одно число у соседей — это O(1).
 *
 * Логика чистая: ни Phaser, ни DOM — поэтому проверяется тестами.
 */

/** Клетка недостижима: до игрока отсюда не дойти. */
export const UNREACHABLE = -1;

/**
 * Волна от цели: в каждой клетке — сколько шагов до неё. UNREACHABLE, если пути
 * нет вовсе (островок за водой, замурованный угол).
 *
 * Шаги считаем по четырём сторонам, а не по восьми: волна по диагонали
 * просачивалась бы сквозь щель между двумя углами стен, и паук вечно тыкался бы
 * в эту щель. Идти по диагонали ему это не мешает — см. nextStep.
 */
export function buildFlow(
  width: number,
  height: number,
  walkable: (index: number) => boolean,
  target: number,
): Int32Array {
  const dist = new Int32Array(width * height).fill(UNREACHABLE);
  if (target < 0 || target >= dist.length || !walkable(target)) return dist;

  dist[target] = 0;
  // Обычный массив как очередь: клеток тысячи, а shift() на таком размере
  // заметно дороже указателя.
  const queue = new Int32Array(width * height);
  queue[0] = target;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const at = queue[head++];
    const x = at % width;
    const y = (at / width) | 0;
    const next = dist[at] + 1;

    // Влево, вправо, вверх, вниз. Проверка x нужна, иначе шаг влево с левого
    // края «перепрыгнул» бы на правый край строки выше.
    if (x > 0) push(at - 1);
    if (x < width - 1) push(at + 1);
    if (y > 0) push(at - width);
    if (y < height - 1) push(at + width);

    function push(to: number): void {
      if (dist[to] !== UNREACHABLE || !walkable(to)) return;
      dist[to] = next;
      queue[tail++] = to;
    }
  }

  return dist;
}

/**
 * Куда шагнуть из клетки from, чтобы приблизиться к цели. UNREACHABLE, если
 * идти некуда или мы уже пришли.
 *
 * Смотрим все восемь соседей: так паук режет углы и идёт по диагонали, а не
 * лесенкой. Но по диагонали пускаем, ТОЛЬКО если проходимы обе смежные клетки —
 * иначе он попытается просочиться между углами двух стен и застрянет в щели,
 * которой нет.
 */
export function nextStep(dist: Int32Array, width: number, height: number, from: number): number {
  if (from < 0 || from >= dist.length) return UNREACHABLE;
  const here = dist[from];
  if (here === UNREACHABLE || here === 0) return UNREACHABLE;

  const x = from % width;
  const y = (from / width) | 0;

  let best = UNREACHABLE;
  let bestDist = here;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const to = ny * width + nx;
      if (dist[to] === UNREACHABLE || dist[to] >= bestDist) continue;

      // Наискось — только если обход по стороне тоже открыт.
      if (dx && dy) {
        if (dist[y * width + nx] === UNREACHABLE || dist[ny * width + x] === UNREACHABLE) continue;
      }

      best = to;
      bestDist = dist[to];
    }
  }

  return best;
}
