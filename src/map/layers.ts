import type { GameMap, Layer } from './types';

/** Пустой слой ровно по размеру карты — иначе не пройдёт validateMap. */
export function emptyLayer(map: GameMap, name: string): Layer {
  return { name, visible: true, data: new Array<number>(map.width * map.height).fill(0) };
}

/**
 * Свободное имя для нового слоя: «Слой N», где N растёт, пока не найдётся
 * незанятое (имена слоёв уникальны, см. validateMap). Спрашивать имя при каждом
 * добавлении — лишний шаг; проще дать рабочее имя сразу, а переименовать потом.
 */
export function suggestLayerName(map: GameMap): string {
  const taken = new Set(map.layers.map((l) => l.name));
  for (let n = map.layers.length + 1; ; n++) {
    const name = `Слой ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Проверяет имя слоя, возвращая текст ошибки или null. Не бросает: имя вводит
 * человек, пустое или занятое — ожидаемый ввод, а не сбой.
 *
 * index — слой, которому имя присваивается: его прежнее имя занятым не считается,
 * иначе «переименование в то же самое» ругалось бы. Для нового слоя это -1.
 */
export function layerNameError(map: GameMap, index: number, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'имя не может быть пустым';
  if (map.layers.some((l, i) => i !== index && l.name === trimmed)) return `слой «${trimmed}» уже есть`;
  return null;
}

/**
 * Вставляет новый пустой слой на позицию insertAt (0 — под всеми, layers.length —
 * над всеми). Чистая: исходную карту не трогает. Редактор пересобирает проекцию
 * Phaser с нуля из результата, а общий с прежней картой массив слоёв разошёлся бы
 * с историей правок.
 */
export function withLayerAdded(map: GameMap, name: string, insertAt: number): GameMap {
  const layers = map.layers.slice();
  layers.splice(insertAt, 0, emptyLayer(map, name));
  return { ...map, layers };
}

/** Удаляет слой index. Чистая. Бросает на последнем: карта без слоёв невалидна. */
export function withLayerRemoved(map: GameMap, index: number): GameMap {
  if (map.layers.length <= 1) throw new Error('нельзя удалить последний слой');
  const layers = map.layers.slice();
  layers.splice(index, 1);
  return { ...map, layers };
}

/**
 * Переставляет слой с позиции from на позицию to (итоговый индекс в массиве).
 * Чистая. Порядок слоёв в массиве — это z-order: 0 снизу, последний сверху.
 */
export function withLayerMoved(map: GameMap, from: number, to: number): GameMap {
  const layers = map.layers.slice();
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  return { ...map, layers };
}

/**
 * Куда встанет перетаскиваемый слой. Панель показывает слои в обратном порядке
 * (верх списка — верхний слой карты, то есть наибольший индекс), поэтому считаем
 * в «экранных» позициях сверху вниз и переводим результат обратно в индекс массива.
 *
 * from — индекс взятого слоя; over — индекс слоя, на который бросают;
 * insertBelow — курсор в нижней половине строки (визуально ниже over);
 * n — всего слоёв. Бросок на самого себя даёт from (перестановки нет).
 */
export function reorderTarget(from: number, over: number, insertBelow: boolean, n: number): number {
  const vFrom = n - 1 - from;
  const vOver = n - 1 - over;
  const vInsert = vOver + (insertBelow ? 1 : 0);
  // При переносе вниз по списку изъятие сдвигает всё выше — компенсируем.
  const vTo = vInsert > vFrom ? vInsert - 1 : vInsert;
  return n - 1 - vTo;
}

// --- Группы слоёв (как папки в Photoshop) ---
//
// Группа — это метка Layer.group, отдельного списка групп нет: группа существует,
// пока на неё ссылается хоть один слой. Слои одной группы держатся в массиве
// подряд (withLayerGrouped ставит слой вплотную к группе, а при перетаскивании
// членство диктует строка-цель), поэтому панель может нарисовать их одной пачкой
// под общим заголовком, не соврав про z-order. Игра поле group не читает вовсе.

/** Отрезок панели: подряд идущие слои одной группы (или один слой без группы). */
export interface LayerRun {
  /** null — слой вне групп. */
  group: string | null;
  /** Индексы слоёв отрезка по возрастанию (порядок массива, снизу вверх). */
  indices: number[];
}

/**
 * Разбивает слои на отрезки для панели: подряд идущие слои одной группы — один
 * отрезок, слой без группы — отрезок сам по себе. Если слои группы почему-то
 * оказались разорваны (старый файл, ручная правка), каждая непрерывная часть
 * станет своим отрезком — панель честно покажет разрыв, а не соврёт про порядок.
 */
export function layerRuns(layers: Layer[]): LayerRun[] {
  const runs: LayerRun[] = [];
  for (let i = 0; i < layers.length; i++) {
    const group = layers[i].group ?? null;
    const last = runs[runs.length - 1];
    if (group !== null && last && last.group === group) last.indices.push(i);
    else runs.push({ group, indices: [i] });
  }
  return runs;
}

/** Имена групп карты в порядке первого появления (снизу вверх). */
export function groupNames(map: GameMap): string[] {
  const names: string[] = [];
  for (const l of map.layers) {
    if (l.group && !names.includes(l.group)) names.push(l.group);
  }
  return names;
}

/** Проверка имени группы: пустое — ошибка. Тёзки слоёв не мешают: пространства имён разные. */
export function groupNameError(name: string): string | null {
  return name.trim() ? null : 'имя группы не может быть пустым';
}

/**
 * Свободное имя для новой группы: «Группа N». Как suggestLayerName — кнопка
 * «📁+» даёт рабочее имя сразу, а переименовать можно потом двойным кликом.
 */
export function suggestGroupName(map: GameMap): string {
  const taken = new Set(groupNames(map));
  for (let n = 1; ; n++) {
    const name = `Группа ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Кладёт слой в группу (group) или убирает из группы (null). Чистая.
 *
 * Если в группе уже есть слои, слой ПЕРЕЕЗЖАЕТ в массиве вплотную к ним — поверх
 * верхнего члена группы, как это делает Photoshop при перетаскивании в папку:
 * иначе группа была бы разорвана и панель не смогла бы показать её одной пачкой.
 * Возвращает также новый индекс слоя.
 */
export function withLayerGrouped(map: GameMap, index: number, group: string | null): { map: GameMap; index: number } {
  const layers = map.layers.slice();
  const strip = ({ group: _g, ...rest }: Layer): Layer => rest;

  if (group === null) {
    layers[index] = strip(layers[index]);
    return { map: { ...map, layers }, index };
  }

  const topMember = layers.reduce((top, l, i) => (i !== index && l.group === group ? i : top), -1);
  if (topMember < 0) {
    // Группа новая (или пустая): слой остаётся на месте и открывает её собой.
    layers[index] = { ...strip(layers[index]), group };
    return { map: { ...map, layers }, index };
  }

  const [moved] = layers.splice(index, 1);
  // splice выше сдвинул индексы: если слой стоял ниже верхнего члена, тот съехал на 1.
  const to = index < topMember ? topMember : topMember + 1;
  layers.splice(to, 0, { ...strip(moved), group });
  return { map: { ...map, layers }, index: to };
}

/** Переименовывает группу у всех её слоёв. Чистая. */
export function withGroupRenamed(map: GameMap, from: string, to: string): GameMap {
  const layers = map.layers.map((l) => (l.group === from ? { ...l, group: to } : l));
  return { ...map, layers };
}

/** Распускает группу: слои остаются на местах, метка снимается. Чистая. */
export function withGroupDisbanded(map: GameMap, name: string): GameMap {
  const layers = map.layers.map((l) => {
    if (l.group !== name) return l;
    const { group: _g, ...rest } = l;
    return rest;
  });
  return { ...map, layers };
}

/**
 * Сменить метку группы слоя НЕ двигая его: null снимает поле совсем. Чистая.
 *
 * Этим завершается перестановка перетаскиванием: членство диктует строка, НА
 * которую бросили (в папке она или нет), — панель передаёт его явно. Угадывать
 * группу по соседям нельзя: слой, брошенный вплотную к своей папке, «прилипал»
 * бы к ней обратно, и вытащить его перетаскиванием было бы невозможно.
 */
export function withGroupLabelAt(map: GameMap, index: number, group: string | null): GameMap {
  const layers = map.layers.slice();
  if (group === null) {
    const { group: _g, ...rest } = layers[index];
    layers[index] = rest;
  } else {
    layers[index] = { ...layers[index], group };
  }
  return { ...map, layers };
}

