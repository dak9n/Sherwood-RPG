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
