import type { EditorState } from '../state';

/**
 * Список слоёв. Показан в обратном порядке — верхний слой карты сверху,
 * как в любом графическом редакторе.
 *
 * «Глаз» здесь скрывает слой только на экране и в документ не пишет. Поле
 * visible — часть формата, игра его читает: если гасить слой в файле, чтобы
 * заглянуть под него, и нажать сохранение, друг получит карту без объектов.
 */
export function buildLayers(host: HTMLElement, state: EditorState): () => void {
  const rows: HTMLDivElement[] = [];

  function render(): void {
    host.textContent = '';
    rows.length = 0;

    for (let i = state.doc.layers.length - 1; i >= 0; i--) {
      const layer = state.doc.layers[i];
      const row = document.createElement('div');
      row.className = 'ed-layer';
      row.dataset.index = String(i);

      const eye = document.createElement('span');
      eye.className = 'eye';
      eye.textContent = state.view.layers[i].visible ? '👁' : '·';
      eye.title = 'Скрыть слой только на экране (в файл не пишется)';
      eye.onclick = (e) => {
        e.stopPropagation();
        const next = !state.view.layers[i].visible;
        state.view.layers[i].setVisible(next);
        eye.textContent = next ? '👁' : '·';
        row.classList.toggle('hidden', !next);
      };

      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = layer.name;

      const count = document.createElement('span');
      count.className = 'ct';
      count.textContent = String(state.doc.countFilled(i));

      row.append(eye, name, count);
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
