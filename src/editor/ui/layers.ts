import type { EditorState } from '../state';
import { layerNameError, reorderTarget, layerRuns, groupNames, groupNameError } from '../../map/layers';

/**
 * Что панель слоёв умеет делать снаружи. Переименование, удаление и перестановка
 * меняют структуру карты, поэтому исполняет их mount (там есть сцена для
 * пересборки), а панель только собирает UI и зовёт эти колбэки.
 */
export interface LayerListOps {
  onDelete: (index: number) => void;
  onRename: (index: number, name: string) => void;
  onReorder: (from: number, to: number) => void;
  /** Положить слой в группу (null — вынуть из группы). */
  onAssignGroup: (index: number, group: string | null) => void;
  onRenameGroup: (from: string, to: string) => void;
  /** Распустить группу: слои остаются, папка исчезает. */
  onDisbandGroup: (name: string) => void;
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

  /** Спросить группу для слоя: пусто — вынуть из группы, Отмена — ничего. */
  function promptAssign(index: number): void {
    const groups = groupNames(state.doc.map);
    const current = state.doc.layers[index].group ?? '';
    const hint = groups.length
      ? `Группа для слоя (пусто — без группы).\nСуществующие: ${groups.join(', ')}`
      : 'Название новой группы (пусто — без группы):';
    const v = window.prompt(hint, current);
    if (v === null) return;
    const name = v.trim();
    if (name === (state.doc.layers[index].group ?? '')) return; // без изменений
    ops.onAssignGroup(index, name || null);
  }

  /** Переименовать группу. Слить две группы одним именем нельзя: пачки бы разорвало. */
  function promptRenameGroup(name: string): void {
    const v = window.prompt(`Новое имя группы «${name}»:`, name);
    if (v === null) return;
    const next = v.trim();
    if (!next || next === name) return;
    if (groupNameError(next)) return;
    if (groupNames(state.doc.map).includes(next)) {
      alert(`Группа «${next}» уже есть — выбери другое имя.`);
      return;
    }
    ops.onRenameGroup(name, next);
  }

  /** Заголовок группы: ▸/▾ сворачивание, глаз всей группы, счётчик, ✎ и 🗑. */
  function groupHeader(group: string, indices: number[]): HTMLDivElement {
    const head = document.createElement('div');
    head.className = 'ed-group';
    const off = state.isGroupHidden(group);
    if (off) head.classList.add('off');
    const collapsed = state.isGroupCollapsed(group);

    const tri = document.createElement('span');
    tri.className = 'tri';
    tri.textContent = collapsed ? '▸' : '▾';

    const eye = document.createElement('span');
    eye.className = 'eye';
    eye.textContent = off ? '·' : '👁';
    eye.title = 'Скрыть всю группу только на экране (в файл не пишется)';
    eye.onclick = (e) => {
      e.stopPropagation();
      state.toggleGroupHidden(group);
      render(); // пометки на заголовке и слоях группы должны обновиться разом
    };

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = group;
    nm.title = 'Клик — свернуть/развернуть, двойной — переименовать группу';
    nm.ondblclick = (e) => {
      e.stopPropagation();
      promptRenameGroup(group);
    };

    const ct = document.createElement('span');
    ct.className = 'ct';
    ct.textContent = String(indices.reduce((n, i) => n + state.doc.countFilled(i), 0));

    const edit = document.createElement('span');
    edit.className = 'edit';
    edit.textContent = '✎';
    edit.title = 'Переименовать группу';
    edit.onclick = (e) => {
      e.stopPropagation();
      promptRenameGroup(group);
    };

    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '🗑';
    del.title = 'Распустить группу (слои останутся)';
    del.onclick = (e) => {
      e.stopPropagation();
      ops.onDisbandGroup(group);
    };

    head.append(tri, eye, nm, ct, edit, del);

    // Клик по заголовку сворачивает/разворачивает — как папка в Photoshop.
    head.onclick = () => {
      state.toggleGroupCollapsed(group);
      render();
    };

    // Бросок строки слоя на заголовок кладёт слой в группу (даже свёрнутую).
    head.ondragover = (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      head.classList.add('drop-into');
    };
    head.ondragleave = () => head.classList.remove('drop-into');
    head.ondrop = (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      const from = dragFrom;
      dragFrom = null;
      head.classList.remove('drop-into');
      clearDropMarks();
      ops.onAssignGroup(from, group);
    };

    return head;
  }

  function render(): void {
    host.textContent = '';
    rows.length = 0;

    const canDelete = state.doc.layers.length > 1; // последний слой удалять нельзя — карта станет невалидной

    // Отрезки групп поверх плоского списка: панель рисует сверху вниз, поэтому
    // отрезки и слои внутри отрезка идут в обратном порядке массива.
    const runs = layerRuns(state.doc.layers);
    for (let r = runs.length - 1; r >= 0; r--) {
      const run = runs[r];
      if (run.group !== null) {
        host.append(groupHeader(run.group, run.indices));
        if (state.isGroupCollapsed(run.group)) continue; // свёрнута — слои под заголовком
        for (let k = run.indices.length - 1; k >= 0; k--) layerRow(run.indices[k], run.group);
      } else {
        layerRow(run.indices[0], null);
      }
    }
    highlight();

    function layerRow(i: number, group: string | null): void {
      const layer = state.doc.layers[i];
      const row = document.createElement('div');
      row.className = 'ed-layer';
      // Зачёркнутое имя ставим при отрисовке, а не только по клику: список
      // перерисовывается на каждую правку, и пометка иначе слетала бы.
      if (state.isHidden(i)) row.classList.add('hidden');
      if (group !== null) {
        row.classList.add('in-grp'); // отступ: слой лежит в папке
        if (state.isGroupHidden(group)) row.classList.add('grp-off'); // группа спрятана — слои притушены
      }
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

      // Папка: положить слой в группу или вынуть. Перетаскивание на заголовок
      // группы делает то же самое — кнопка нужна, чтобы создать ПЕРВУЮ группу.
      const grp = document.createElement('span');
      grp.className = 'grp';
      grp.textContent = '📁';
      grp.title = group ? `Группа «${group}» — сменить или убрать` : 'Положить слой в группу';
      grp.onclick = (e) => {
        e.stopPropagation();
        promptAssign(i);
      };

      row.append(eye, name, count, grp, edit);

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
