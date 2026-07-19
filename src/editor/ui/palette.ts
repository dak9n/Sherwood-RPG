import type { Tileset } from '../../map/types';
import type { Brush, EditorState } from '../state';
import { applySizes, dragSize, sizes, MIN_TILES } from './sizes';

const ZOOM = 2;
const TILE = 16;

/**
 * Палитра — это сами картинки тайлсетов, а не сетка из тысяч элементов:
 * тайлов 10686, и рисовать их по одному нечем и незачем. Раскладку не трогаем —
 * художник рисовал её в PSD и узнаёт в лицо.
 *
 * Выделение протяжкой даёт кисть-штамп: дерево 5x5 из Objects ставится одним
 * движением, иначе «дорисовать втрое большую площадь» — это тысячи кликов.
 */
/** Сколько места под превью есть на самом деле. 40px — заголовок тайлсета и тяга. */
const roomFor = (host: HTMLElement): number => Math.max(MIN_TILES, host.clientHeight - 40);

export function buildPalette(host: HTMLElement, state: EditorState): void {
  for (const ts of state.doc.map.tilesets) {
    host.append(tilesetBlock(ts, state, host));
  }
}

function tilesetBlock(ts: Tileset, state: EditorState, host: HTMLElement): HTMLElement {
  const block = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'ed-ts-head';
  head.innerHTML = `<span>${ts.name}</span><span>${ts.tileCount}</span>`;

  const body = document.createElement('div');
  body.className = 'ed-ts-body';
  body.hidden = true;

  const wrap = document.createElement('div');
  wrap.className = 'ed-ts-wrap';

  const img = document.createElement('img');
  img.src = `assets/tilesets/${ts.image}`;
  // Размер задаётся в пикселях, а не через transform: scale — иначе координаты
  // клика придут в нетрансформированном пространстве, и до правой нижней части
  // тайлсета будет не дотянуться.
  img.style.width = `${ts.imageWidth * ZOOM}px`;
  img.style.height = `${ts.imageHeight * ZOOM}px`;
  img.draggable = false;

  const sel = document.createElement('div');
  sel.className = 'ed-sel';
  sel.hidden = true;

  wrap.append(img, sel);
  body.append(wrap);

  // Тяга высоты превью. У каждого тайлсета своя, но размер общий: настраивать
  // высоту заново на каждом из 39 тайлсетов — то же мучение, от которого мы
  // избавлялись, когда запоминали размеры панели.
  const grip = document.createElement('div');
  grip.className = 'ed-ts-grip';
  grip.title = 'Drag down to see more tiles, up to see fewer';
  grip.hidden = true;

  dragSize(grip, { rows: true }, (e) => {
    const top = body.getBoundingClientRect().top;
    // Выше видимой части палитры растягивать нечего: больше тайлов всё равно не
    // покажется — превью просто начало бы прокручиваться ещё и снаружи.
    sizes.tilesH = Math.max(MIN_TILES, Math.min(e.clientY - top, roomFor(host)));
  });

  head.onclick = () => {
    body.hidden = !body.hidden;
    // Тяга без открытого превью тянула бы пустоту.
    grip.hidden = body.hidden;
    if (body.hidden) return;

    // Подрезаем высоту под то, что реально помещается — именно здесь, а не при
    // сборке палитры: там панель ещё не разложена и меряется неверно. Иначе
    // первая же протяжка ужимала бы превью вместо того, чтобы растить.
    sizes.tilesH = Math.min(sizes.tilesH, roomFor(host));
    applySizes();
  };

  const cellAt = (e: MouseEvent) => ({
    x: Math.floor(e.offsetX / ZOOM / TILE),
    y: Math.floor(e.offsetY / ZOOM / TILE),
  });

  let anchor: { x: number; y: number } | null = null;

  const paint = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x) + 1;
    const h = Math.abs(a.y - b.y) + 1;

    sel.hidden = false;
    sel.style.left = `${x0 * TILE * ZOOM}px`;
    sel.style.top = `${y0 * TILE * ZOOM}px`;
    sel.style.width = `${w * TILE * ZOOM}px`;
    sel.style.height = `${h * TILE * ZOOM}px`;
    return { x0, y0, w, h };
  };

  img.onmousedown = (e) => {
    e.preventDefault();
    anchor = cellAt(e);
    paint(anchor, anchor);
  };

  img.onmousemove = (e) => {
    if (!anchor) return;
    paint(anchor, cellAt(e));
  };

  const finish = (e: MouseEvent) => {
    if (!anchor) return;
    const { x0, y0, w, h } = paint(anchor, cellAt(e));
    anchor = null;

    const raws: number[] = [];
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const localId = y * ts.columns + x;
        raws.push(localId < ts.tileCount ? ts.firstId + localId : 0);
      }
    }
    state.setBrush({ w, h, raws });

    // Выделение остаётся только у активного тайлсета.
    for (const other of document.querySelectorAll<HTMLElement>('.ed-sel')) {
      if (other !== sel) other.hidden = true;
    }
  };

  img.onmouseup = finish;
  img.onmouseleave = () => {
    anchor = null;
  };

  block.append(head, body, grip);
  return block;
}

/** Показать в палитре тайл, взятый пипеткой: раскрыть его тайлсет и подсветить клетку. */
export function revealBrush(host: HTMLElement, state: EditorState, brush: Brush): void {
  const gid = brush.raws[0] & 0x1fffffff;
  if (!gid) return;

  const tilesets = state.doc.map.tilesets;
  const tsIndex = tilesets.findIndex((t) => gid >= t.firstId && gid < t.firstId + t.tileCount);
  if (tsIndex === -1) return;

  const ts = tilesets[tsIndex];
  const blocks = host.children;
  const body = blocks[tsIndex]?.querySelector<HTMLElement>('.ed-ts-body');
  const sel = blocks[tsIndex]?.querySelector<HTMLElement>('.ed-sel');
  if (!body || !sel) return;

  body.hidden = false;
  const localId = gid - ts.firstId;
  const x = localId % ts.columns;
  const y = Math.floor(localId / ts.columns);

  sel.hidden = false;
  sel.style.left = `${x * TILE * ZOOM}px`;
  sel.style.top = `${y * TILE * ZOOM}px`;
  sel.style.width = `${TILE * ZOOM}px`;
  sel.style.height = `${TILE * ZOOM}px`;
  sel.scrollIntoView({ block: 'nearest' });
}
