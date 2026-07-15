import type { EditorState } from '../state';
import { layerNameError, reorderTarget } from '../../map/layers';

/**
 * Что панель слоёв умеет делать снаружи. Переименование, удаление и перестановка
 * меняют структуру карты, поэтому исполняет их mount (там есть сцена для
 * пересборки), а панель только собирает UI и зовёт эти колбэки.
 */
export interface LayerListOps {
  onDelete: (index: number) => void;
  onRename: (index: number, name: string) => void;
  onReorder: (from: number, to: number) => void;
}

/**
 * Список слоёв. Показан в обратном порядке — верхний слой карты сверху,
 * как в любом графическом редакторе.
 *
 * «Глаз» здесь скрывает слой только на экране и в документ не пишет. Поле
 * visible — часть формата, игра его читает: если гасить слой в файле, чтобы
 * заглянуть под него, и нажать сохранение, друг получит карту без объектов.
 *
 * Двойной клик по имени переименовывает слой, 🗑 — удаляет.
 */
export function buildLayers(host: HTMLElement, state: EditorState, ops: LayerListOps): () => void {
  const rows: HTMLDivElement[] = [];
  /** Индекс слоя, который сейчас тащат (null — не тащим). */
  let dragFrom: number | null = null;

  function clearDropMarks(): void {
    for (const r of rows) r.classList.remove('drop-above', 'drop-below');
  }

  /** Инлайн-редактор имени. Проверку уникальности держим здесь: только тут видно поле ввода, куда вернуть фокус при ошибке. */
  function startRename(index: number, nameEl: HTMLSpanElement): void {
    // Draggable-строка мешает ставить каретку и выделять текст в поле — гасим на время правки.
    const row = nameEl.closest('.ed-layer') as HTMLElement | null;
    if (row) row.draggable = false;

    const input = document.createElement('input');
    input.className = 'rn';
    input.value = state.doc.layers[index].name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    // Успешный commit зовёт onRename → перерисовку → input исчезает и стреляет blur.
    // Флаг гасит это повторное срабатывание.
    let closed = false;

    const cancel = (): void => {
      if (closed) return;
      closed = true;
      render(); // вернуть подпись
    };

    const commit = (): void => {
      if (closed) return;
      const value = input.value.trim();
      if (value === state.doc.layers[index].name) return cancel(); // без изменений — просто закрыть, не пачкая dirty
      const err = layerNameError(state.doc.map, index, value);
      if (err) {
        input.classList.add('bad');
        input.title = err;
        return; // остаёмся в поле — пусть поправят
      }
      closed = true; // до onRename: он перерисует список и уберёт input
      ops.onRename(index, value);
    };

    input.onkeydown = (e: KeyboardEvent): void => {
      // Иначе Ctrl+Z, E, G и прочие хоткеи редактора сработают прямо во время ввода имени.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    // Клик мимо принимает годное имя, а негодное молча откатывает — держать
    // невидимое поле в фокусе с ошибкой хуже, чем потерять недопечатанное имя.
    input.onblur = (): void => {
      const value = input.value.trim();
      if (value !== state.doc.layers[index].name && !layerNameError(state.doc.map, index, value)) {
        if (closed) return;
        closed = true;
        ops.onRename(index, value);
      } else {
        cancel();
      }
    };
    input.onmousedown = (e: MouseEvent): void => e.stopPropagation(); // клик в поле не выбирает слой
  }

  function render(): void {
    host.textContent = '';
    rows.length = 0;

    const canDelete = state.doc.layers.length > 1; // последний слой удалять нельзя — карта станет невалидной

    for (let i = state.doc.layers.length - 1; i >= 0; i--) {
      const layer = state.doc.layers[i];
      const row = document.createElement('div');
      row.className = 'ed-layer';
      // Зачёркнутое имя ставим при отрисовке, а не только по клику: список
      // перерисовывается на каждую правку, и пометка иначе слетала бы.
      if (state.isHidden(i)) row.classList.add('hidden');
      row.dataset.index = String(i);

      // Перетаскивание строки меняет порядок (z-order) слоёв. Список показан
      // в обратном порядке, поэтому итоговый индекс считает reorderTarget.
      row.draggable = true;
      row.ondragstart = (e) => {
        dragFrom = i;
        row.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(i)); // без данных Firefox не начнёт перетаскивание
        }
      };
      row.ondragover = (e) => {
        if (dragFrom === null) return;
        e.preventDefault(); // без этого drop не сработает
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const below = e.clientY - rect.top > rect.height / 2;
        clearDropMarks();
        row.classList.add(below ? 'drop-below' : 'drop-above');
      };
      row.ondrop = (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const below = e.clientY - rect.top > rect.height / 2;
        const to = reorderTarget(dragFrom, i, below, state.doc.layers.length);
        const from = dragFrom;
        dragFrom = null;
        clearDropMarks();
        ops.onReorder(from, to); // перерисует список
      };
      row.ondragend = () => {
        dragFrom = null;
        clearDropMarks();
        row.classList.remove('dragging');
      };

      const eye = document.createElement('span');
      eye.className = 'eye';
      // Спрашиваем состояние, а не Phaser: слои Phaser пересоздаются при
      // добавлении слоя и ресайзе, и приходят видимыми — скрытие живёт в state.
      eye.textContent = state.isHidden(i) ? '·' : '👁';
      eye.title = 'Скрыть слой только на экране (в файл не пишется)';
      eye.onclick = (e) => {
        e.stopPropagation();
        const visible = state.toggleHidden(i);
        eye.textContent = visible ? '👁' : '·';
        row.classList.toggle('hidden', !visible);
      };

      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = layer.name;
      name.title = 'Двойной клик — переименовать';
      name.ondblclick = (e) => {
        e.stopPropagation();
        startRename(i, name);
      };

      const count = document.createElement('span');
      count.className = 'ct';
      count.textContent = String(state.doc.countFilled(i));

      const edit = document.createElement('span');
      edit.className = 'edit';
      edit.textContent = '✎';
      edit.title = 'Переименовать слой';
      edit.onclick = (e) => {
        e.stopPropagation();
        startRename(i, name);
      };

      row.append(eye, name, count, edit);

      if (canDelete) {
        const del = document.createElement('span');
        del.className = 'del';
        del.textContent = '🗑';
        del.title = 'Удалить слой';
        del.onclick = (e) => {
          e.stopPropagation();
          ops.onDelete(i);
        };
        row.append(del);
      }

      row.onclick = () => state.setActiveLayer(i);
      host.append(row);
      rows.push(row);
    }
    highlight();
  }

  function highlight(): void {
    for (const row of rows) {
      const i = Number(row.dataset.index);
      row.setAttribute('aria-selected', String(i === state.activeLayer));
    }
  }

  render();
  return render;
}
