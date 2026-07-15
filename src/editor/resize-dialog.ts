import { resizeMap, type Deltas } from '../map/resize';
import type { MapDoc } from '../map/doc';

/** Выше этого числа клеток Phaser начинает заметно тяжелеть — предупреждаем. */
const WARN_CELLS = 96 * 64;
const HEAVY_CELLS = 192 * 128;

export interface ResizeRequest {
  deltas: Deltas;
  dropped: number;
  droppedByLayer: Record<string, number>;
}

/**
 * Спрашивает, на сколько тайлов вырастить карту с каждой стороны.
 *
 * Спрашиваем именно дельты, а не новые ширину и высоту: рост влево и вверх —
 * это единственный неочевидный случай (карта сдвигается), и дельты называют
 * его прямо, вместо того чтобы заставлять считать смещение в уме.
 */
export function askResize(doc: MapDoc): Promise<ResizeRequest | null> {
  return new Promise((done) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <style>
        dialog::backdrop { background: rgba(0,0,0,.55); }
        .rz { font: 13px/1.5 system-ui, sans-serif; color: #dfe7eb; }
        .rz h3 { margin: 0 0 10px; font-size: 14px; }
        .rz .grid { display: grid; grid-template-columns: repeat(3, 62px); gap: 6px; justify-content: center; margin: 12px 0; }
        .rz input { width: 100%; font: inherit; padding: 4px; text-align: center;
          background: #12171a; color: inherit; border: 1px solid #3a464d; border-radius: 3px; }
        .rz .lbl { text-align: center; color: #8a9aa4; font-size: 11px; }
        .rz .info { color: #8a9aa4; margin: 8px 0; }
        .rz .warn { color: #d8b45a; }
        .rz .danger { color: #e2705f; font-weight: 600; }
        .rz .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; }
        .rz button { font: inherit; padding: 5px 12px; border-radius: 3px; cursor: pointer;
          background: #2f383e; color: #dfe7eb; border: 1px solid #0d1114; }
        .rz button.go { background: #4a7a3f; border-color: #63a354; }
      </style>
      <form method="dialog" class="rz">
        <h3>Размер карты</h3>
        <div class="info">Сейчас ${doc.width}×${doc.height}. Сколько тайлов добавить с каждой стороны? Отрицательное число обрежет.</div>
        <div class="grid">
          <div></div><div><input name="top" type="number" value="0"><div class="lbl">сверху</div></div><div></div>
          <div><input name="left" type="number" value="0"><div class="lbl">слева</div></div>
          <div></div>
          <div><input name="right" type="number" value="0"><div class="lbl">справа</div></div>
          <div></div><div><input name="bottom" type="number" value="0"><div class="lbl">снизу</div></div><div></div>
        </div>
        <div class="info" id="rz-preview"></div>
        <div class="row">
          <button value="cancel">Отмена</button>
          <button value="ok" class="go" id="rz-ok">Изменить</button>
        </div>
      </form>
    `;
    document.body.append(dlg);

    const get = (n: string) => Number((dlg.querySelector(`[name=${n}]`) as HTMLInputElement).value) || 0;
    const deltas = (): Deltas => ({ left: get('left'), right: get('right'), top: get('top'), bottom: get('bottom') });

    const preview = dlg.querySelector<HTMLElement>('#rz-preview')!;
    const okBtn = dlg.querySelector<HTMLButtonElement>('#rz-ok')!;

    const refresh = (): void => {
      const d = deltas();
      const w = doc.width + d.left + d.right;
      const h = doc.height + d.top + d.bottom;

      if (w <= 0 || h <= 0) {
        preview.className = 'info danger';
        preview.textContent = `Так карта станет ${w}×${h} — этого не бывает.`;
        okBtn.disabled = true;
        return;
      }

      // Считаем потери ДО применения: спрашивать «потерять N тайлов?» после
      // того, как они потеряны, бессмысленно.
      const { dropped, droppedByLayer } = resizeMap(doc.map, d);
      const cells = w * h;
      const parts = [`Станет ${w}×${h} (${w * 16}×${h * 16} px).`];
      let cls = 'info';

      if (dropped > 0) {
        const where = Object.entries(droppedByLayer)
          .map(([n, c]) => `${n}: ${c}`)
          .join(', ');
        parts.push(`Будет потеряно ${dropped} тайлов — ${where}.`);
        cls = 'info danger';
      }
      if (cells > HEAVY_CELLS) {
        parts.push(`${cells} клеток — Phaser создаст ${cells * doc.layers.length} объектов тайлов на 26 слоёв. Будет тяжело.`);
        cls = 'info danger';
      } else if (cells > WARN_CELLS) {
        parts.push(`${cells} клеток на 26 слоёв — карта станет заметно тяжелее.`);
        if (cls === 'info') cls = 'info warn';
      }

      preview.className = cls;
      preview.textContent = parts.join(' ');
      okBtn.disabled = false;
    };

    dlg.addEventListener('input', refresh);
    refresh();

    dlg.addEventListener('close', () => {
      const value = dlg.returnValue;
      const d = deltas();
      dlg.remove();

      if (value !== 'ok' || (!d.left && !d.right && !d.top && !d.bottom)) return done(null);
      const { dropped, droppedByLayer } = resizeMap(doc.map, d);
      done({ deltas: d, dropped, droppedByLayer });
    });

    dlg.showModal();
  });
}
