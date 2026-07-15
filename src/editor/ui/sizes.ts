/**
 * Размеры панели редактора и тяги, которыми их двигают.
 *
 * Вынесено из shell.ts, потому что тяг стало три и живут они в разных местах:
 * ширина и дележ слоёв/тайлов — в каркасе, высота превью тайлсета — в палитре.
 * Хранить размеры в каркасе и тянуть их оттуда в палитру значило бы связать
 * два модуля ради одного числа.
 *
 * Размеры помним между заходами: настраивать их заново каждый раз — мучение.
 */

const KEY = 'editor-sizes';

export const MIN_PANEL = 220;
export const MIN_SECTION = 80;
/** Ниже этого превью бесполезно: не видно и двух рядов тайлов. */
export const MIN_TILES = 64;

export interface Sizes {
  panelW: number;
  layersH: number;
  /** Высота превью тайлсета. Общая для всех: разнобой пришлось бы настраивать 39 раз. */
  tilesH: number;
}

const fallback = (): Sizes => ({
  panelW: 300,
  layersH: Math.round(window.innerHeight * 0.34),
  // Половина экрана: тайлсеты высокие (у деревни 1152px), и в прежние 260px
  // не влезала даже четверть картинки.
  tilesH: Math.round(window.innerHeight * 0.5),
});

function load(): Sizes {
  const def = fallback();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved) return def;
    return {
      panelW: saved.panelW ?? def.panelW,
      layersH: saved.layersH ?? def.layersH,
      tilesH: saved.tilesH ?? def.tilesH,
    };
  } catch {
    // Испорченная запись не должна мешать открыть редактор.
    return def;
  }
}

export const sizes: Sizes = load();

export function applySizes(): void {
  document.body.style.setProperty('--panel-w', `${sizes.panelW}px`);
  document.body.style.setProperty('--layers-h', `${sizes.layersH}px`);
  document.body.style.setProperty('--tiles-h', `${sizes.tilesH}px`);
}

export function saveSizes(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  } catch {
    // Приватный режим или переполненное хранилище — размеры просто не запомнятся.
  }
}

interface DragOptions {
  /** Курсор и подсветка: тянем по вертикали. */
  rows?: boolean;
  /**
   * Сообщить игре о смене размера. Нужно только тягам, которые двигают КАНВАС:
   * Phaser следит за окном, а не за разметкой. Высота превью канваса не касается,
   * и дёргать пересчёт камеры на каждый пиксель протяжки было бы впустую.
   */
  notifyGame?: boolean;
}

/** Вешает на тягу протяжку. onMove решает, какой размер и как поменять. */
export function dragSize(
  grip: HTMLElement,
  { rows = false, notifyGame = false }: DragOptions,
  onMove: (e: PointerEvent) => void,
): void {
  grip.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    // Захват указателя: иначе, стоит увести мышь за пределы тяги, она «отцепится».
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    document.body.classList.add('ed-resizing');
    if (rows) document.body.classList.add('rows');

    const move = (ev: PointerEvent): void => {
      onMove(ev);
      applySizes();
      if (notifyGame) window.dispatchEvent(new Event('resize'));
    };
    const up = (): void => {
      grip.classList.remove('dragging');
      document.body.classList.remove('ed-resizing', 'rows');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      saveSizes();
    };

    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
}
