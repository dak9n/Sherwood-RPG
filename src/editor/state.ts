import { MapDoc } from '../map/doc';
import { applyCell, type MapView } from '../map/view';
import { applyToDoc, reverse, type CellEdit } from './edit';
export type { CellEdit };

/**
 * Скрытые «глазом» слои запоминаются в браузере — по имени карты, отдельно для
 * каждой. Это личная настройка вида, а не данные карты: в файл писать нельзя
 * (там visible читает игра), а держать только в памяти мало — скрытие слетало
 * бы на F5. Поэтому localStorage, как и размеры панелей.
 */
const HIDDEN_KEY = 'editor-hidden-layers';
/** Скрытые «глазом» группы и свёрнутые группы — те же правила, что и у слоёв. */
const HIDDEN_GROUPS_KEY = 'editor-hidden-groups';
const COLLAPSED_GROUPS_KEY = 'editor-collapsed-groups';

function loadNames(key: string, mapName: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? '{}');
    const names = all?.[mapName];
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return []; // приватный режим или битые данные — просто ничего не скрываем
  }
}

function saveNames(key: string, mapName: string, names: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
    if (names.length) all[mapName] = names;
    else delete all[mapName]; // не копим пустышки по картам без скрытых слоёв
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    // Приватный режим или переполненное хранилище — скрытие просто не запомнится.
  }
}


/** Кисть — всегда прямоугольник; одна клетка это просто 1x1. */
export interface Brush {
  w: number;
  h: number;
  raws: number[];
}

type Listener = () => void;

const MAX_HISTORY = 200;

export class EditorState {
  activeLayer: number;
  brush: Brush = { w: 1, h: 1, raws: [0] };
  dirty = false;
  baseRevision = '';

  /** Правки, уже применённые: каждый элемент — один штрих. */
  private undoStack: CellEdit[][] = [];
  private redoStack: CellEdit[][] = [];
  private listeners: Listener[] = [];

  /**
   * Слои, скрытые «глазом», — по ИМЕНИ, а не по номеру.
   *
   * Номера сдвигаются, стоит вставить или удалить слой, и скрытие переехало бы
   * на соседа. Имена уникальны — это проверяет формат.
   *
   * Скрытие живёт только здесь и в файл не пишется: visible — поле формата,
   * игра его читает. Погасил слой, чтобы заглянуть под него, сохранил — и друг
   * получил бы карту без объектов.
   */
  private hidden = new Set<string>();

  /**
   * Группы, скрытые «глазом» на заголовке, и группы, свёрнутые в панели.
   * По имени группы, только на экране, в файл не пишутся — те же правила,
   * что у скрытых слоёв. Скрытие группы НЕ трогает «глаза» её слоёв: показал
   * группу обратно — и личные глаза слоёв остались как были (как в Photoshop).
   */
  private hiddenGroups = new Set<string>();
  private collapsedGroups = new Set<string>();

  /**
   * Кому сказать, что проходимость клетки изменилась, — накладке в редакторе.
   * Ставит mount. Здесь, а не внутри apply: state не знает про Phaser.
   */
  onPass: ((x: number, y: number, pass: number) => void) | null = null;

  constructor(
    public doc: MapDoc,
    public view: MapView,
    /** Имя открытой карты (файл <mapName>.json). Ctrl+S пишет именно в него. */
    public mapName: string,
  ) {
    this.activeLayer = doc.layers.length - 1;
    // Возвращаем скрытие прошлой сессии. Слои Phaser только что созданы и все
    // видимые, а «глаз» — запомненная настройка вида: без этого спрятанные слои
    // проявлялись бы при каждой перезагрузке вкладки.
    for (const name of loadNames(HIDDEN_KEY, mapName)) this.hidden.add(name);
    for (const name of loadNames(HIDDEN_GROUPS_KEY, mapName)) this.hiddenGroups.add(name);
    for (const name of loadNames(COLLAPSED_GROUPS_KEY, mapName)) this.collapsedGroups.add(name);
    this.applyHidden();
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Единственный вход на правку карты. Всё, что меняет тайлы, идёт сюда:
   * иначе документ, экран и история разъедутся.
   */
  apply(edits: CellEdit[], { record = true } = {}): void {
    const real = edits.filter((e) => e.before !== e.after);
    if (real.length === 0) return;

    for (const e of real) {
      applyToDoc(this.doc, e);
      // Экран обновляем здесь: edit.ts намеренно не знает про Phaser.
      if (e.kind === 'pass') this.onPass?.(e.x, e.y, e.after);
      else applyCell(this.view, e.layerIndex, e.x, e.y, e.after);
    }

    if (record) {
      this.undoStack.push(real);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack.length = 0;
    }

    this.dirty = true;
    this.emit();
  }

  /**
   * Кладёт готовый штрих в историю. Во время рисования правки применяются без
   * записи, а сюда попадают одним куском: Ctrl+Z должен отменять мазок целиком,
   * а не по клетке.
   */
  pushHistory(batch: CellEdit[]): void {
    if (batch.length === 0) return;
    this.undoStack.push(batch);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): boolean {
    const batch = this.undoStack.pop();
    if (!batch) return false;

    const reversed = batch.map(reverse);
    this.apply(reversed, { record: false });
    this.redoStack.push(batch);
    return true;
  }

  redo(): boolean {
    const batch = this.redoStack.pop();
    if (!batch) return false;
    this.apply(batch, { record: false });
    this.undoStack.push(batch);
    return true;
  }

  /**
   * Пересобрать состояние на новую пару doc/view после структурной правки —
   * ресайза, добавления или удаления слоя. История клеточных правок при этом
   * бессмысленна: её координаты и номера слоёв указывают в старую сетку, поэтому
   * стек чистится целиком.
   */
  relayer(doc: MapDoc, view: MapView, activeLayer: number): void {
    this.doc = doc;
    this.view = view;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.activeLayer = Math.max(0, Math.min(activeLayer, doc.layers.length - 1));
    this.dirty = true;
    // Пересборка отдала новые слои Phaser, и все они видимые: возвращаем скрытие,
    // иначе спрятанные «глазом» слои проявлялись бы после каждого добавления слоя.
    this.applyHidden();
    this.emit();
  }

  /** Скрыт ли слой ЕГО СОБСТВЕННЫМ «глазом» (скрытие группы сюда не входит). */
  isHidden(index: number): boolean {
    return this.hidden.has(this.doc.layers[index]?.name);
  }

  /** Скрыт ли слой на экране с учётом всего: своего глаза И глаза его группы. */
  private effectivelyHidden(layer: { name: string; group?: string }): boolean {
    return this.hidden.has(layer.name) || (!!layer.group && this.hiddenGroups.has(layer.group));
  }

  /** Виден ли слой на экране: по формату, по своему «глазу» и по «глазу» группы. */
  isVisible(index: number): boolean {
    const layer = this.doc.layers[index];
    return !!layer && layer.visible && !this.effectivelyHidden(layer);
  }

  /**
   * Верхний ВИДИМЫЙ слой с тайлом в клетке. -1, если брать нечего.
   *
   * Пипетка обязана спрашивать это, а не doc.topLayerAt: тот смотрит в данные
   * карты и не знает про «глаз». Спрятал дерево, ткнул в траву под ним — и
   * пипетка возвращала дерево, потому что оно всё ещё лежит сверху в файле.
   * Брать надо то, что видно.
   */
  topVisibleLayerAt(x: number, y: number): number {
    for (let i = this.doc.layers.length - 1; i >= 0; i--) {
      if (this.isVisible(i) && this.doc.getRaw(i, x, y)) return i;
    }
    return -1;
  }

  /** Спрятать или показать слой на экране. В файл это не пишется. */
  toggleHidden(index: number): boolean {
    const name = this.doc.layers[index]?.name;
    if (!name) return false;

    if (this.hidden.has(name)) this.hidden.delete(name);
    else this.hidden.add(name);

    this.applyHidden();
    this.persistHidden(); // чтобы скрытие пережило перезагрузку вкладки
    return !this.hidden.has(name);
  }

  /**
   * Приводит видимость слоёв Phaser в соответствие с документом и «глазом».
   *
   * Слой виден, только если он видим по формату И не спрятан глазом: это два
   * разных выключателя, и путать их нельзя.
   */
  applyHidden(): void {
    for (let i = 0; i < this.doc.layers.length; i++) {
      const layer = this.doc.layers[i];
      this.view.layers[i]?.setVisible(layer.visible && !this.effectivelyHidden(layer));
    }
  }

  /**
   * Запоминает набор скрытых слоёв в браузере — по имени текущей карты. В список
   * кладём только существующие слои: имена удалённых незачем тащить в хранилище.
   */
  persistHidden(): void {
    const alive = new Set(this.doc.layers.map((l) => l.name));
    saveNames(HIDDEN_KEY, this.mapName, [...this.hidden].filter((n) => alive.has(n)));
  }

  // --- Группы (папки панели слоёв) ---

  /** Скрыта ли группа «глазом» на её заголовке. */
  isGroupHidden(name: string): boolean {
    return this.hiddenGroups.has(name);
  }

  /** Спрятать или показать всю группу на экране. В файл это не пишется. */
  toggleGroupHidden(name: string): boolean {
    if (this.hiddenGroups.has(name)) this.hiddenGroups.delete(name);
    else this.hiddenGroups.add(name);
    this.applyHidden();
    this.persistGroups();
    return !this.hiddenGroups.has(name);
  }

  /** Свёрнута ли группа в панели (слои спрятаны под заголовком). */
  isGroupCollapsed(name: string): boolean {
    return this.collapsedGroups.has(name);
  }

  /** Свернуть/развернуть группу в панели. Чисто вид панели, карты не касается. */
  toggleGroupCollapsed(name: string): boolean {
    if (this.collapsedGroups.has(name)) this.collapsedGroups.delete(name);
    else this.collapsedGroups.add(name);
    this.persistGroups();
    return this.collapsedGroups.has(name);
  }

  /**
   * Пометить слой группой (или снять метку — null) БЕЗ перестановки. Как
   * переименование: не структурно, история и проекция Phaser живут дальше.
   * Перестановку к группе (если нужна) делает mount через withLayerGrouped.
   */
  setLayerGroupLabel(index: number, group: string | null): void {
    const layer = this.doc.map.layers[index];
    if (!layer) return;
    if (group === null) delete layer.group;
    else layer.group = group;
    this.dirty = true;
    this.applyHidden(); // слой мог войти в скрытую группу — экран обязан совпасть
    this.emit();
  }

  /** Переименовать группу у всех слоёв. Экранные пометки переезжают на новое имя. */
  renameGroup(from: string, to: string): void {
    for (const layer of this.doc.map.layers) {
      if (layer.group === from) layer.group = to;
    }
    if (this.hiddenGroups.delete(from)) this.hiddenGroups.add(to);
    if (this.collapsedGroups.delete(from)) this.collapsedGroups.add(to);
    this.persistGroups();
    this.dirty = true;
    this.emit();
  }

  /** Распустить группу: слои на местах, метки сняты, экранные пометки забыты. */
  disbandGroup(name: string): void {
    for (const layer of this.doc.map.layers) {
      if (layer.group === name) delete layer.group;
    }
    this.hiddenGroups.delete(name);
    this.collapsedGroups.delete(name);
    this.persistGroups();
    this.applyHidden(); // группа могла быть скрытой — слои обязаны проявиться
    this.dirty = true;
    this.emit();
  }

  /** Запоминает скрытые и свёрнутые группы в браузере, отбрасывая исчезнувшие. */
  private persistGroups(): void {
    const alive = new Set<string>();
    for (const l of this.doc.layers) if (l.group) alive.add(l.group);
    saveNames(HIDDEN_GROUPS_KEY, this.mapName, [...this.hiddenGroups].filter((n) => alive.has(n)));
    saveNames(COLLAPSED_GROUPS_KEY, this.mapName, [...this.collapsedGroups].filter((n) => alive.has(n)));
  }

  /** После смены размера активный слой сохраняем, лишь поджимая под новый список. */
  resetAfterResize(doc: MapDoc, view: MapView): void {
    this.relayer(doc, view, this.activeLayer);
  }

  /**
   * Переименование — не структурная правка: номера слоёв и клетки на месте,
   * поэтому история переживает его, а проекцию Phaser пересобирать не нужно —
   * имя лишь подпись, на экране его нет.
   */
  renameLayer(index: number, name: string): void {
    const old = this.doc.map.layers[index].name;
    this.doc.map.layers[index].name = name;

    // Скрытие помнится по имени — переносим его на новое, иначе слой проявится.
    if (this.hidden.delete(old)) {
      this.hidden.add(name);
      this.persistHidden(); // в localStorage тоже уже новое имя
    }

    this.dirty = true;
    this.emit();
  }

  markSaved(revision: string): void {
    this.dirty = false;
    this.baseRevision = revision;
    this.emit();
  }

  setActiveLayer(index: number): void {
    // Клик по уже активному слою не должен гонять полную перерисовку списка:
    // она рвёт двойной клик по имени (элемент заменяется между кликами).
    if (index === this.activeLayer) return;
    this.activeLayer = index;
    this.emit();
  }

  setBrush(brush: Brush): void {
    this.brush = brush;
    this.emit();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
