import { MapDoc } from '../map/doc';
import { applyCell, type MapView } from '../map/view';

/** Одна изменённая клетка. before/after — значения формата (0 = пусто). */
export interface CellEdit {
  layerIndex: number;
  x: number;
  y: number;
  before: number;
  after: number;
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

  constructor(
    public doc: MapDoc,
    public view: MapView,
  ) {
    this.activeLayer = doc.layers.length - 1;
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
      this.doc.setRaw(e.layerIndex, e.x, e.y, e.after);
      applyCell(this.view, e.layerIndex, e.x, e.y, e.after);
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

    const reverse = batch.map((e) => ({ ...e, before: e.after, after: e.before }));
    this.apply(reverse, { record: false });
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
   * После смены размера карты история клеточных правок бессмысленна: старые
   * координаты указывают в другую сетку. Стек чистится целиком.
   */
  resetAfterResize(doc: MapDoc, view: MapView): void {
    this.doc = doc;
    this.view = view;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.activeLayer = Math.min(this.activeLayer, doc.layers.length - 1);
    this.dirty = true;
    this.emit();
  }

  markSaved(revision: string): void {
    this.dirty = false;
    this.baseRevision = revision;
    this.emit();
  }

  setActiveLayer(index: number): void {
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
