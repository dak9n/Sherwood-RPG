const CSS = `
  /* minmax(0, 1fr), а не 1fr: иначе колонка не сожмётся меньше канваса,
     который держит свою ширину атрибутом, и панель уедет за край экрана. */
  body.editing { display: grid; grid-template-columns: minmax(0, 1fr) 300px; }
  body.editing #game { width: 100%; height: 100vh; min-width: 0; }

  #editor {
    height: 100vh; overflow: hidden; display: flex; flex-direction: column;
    background: #20272b; color: #cfd8dc; border-left: 1px solid #0d1114;
    font: 12px/1.45 system-ui, sans-serif; user-select: none;
  }
  #editor h2 {
    margin: 0; padding: 7px 10px; font-size: 11px; font-weight: 600;
    letter-spacing: .06em; text-transform: uppercase; color: #7d8f99;
    background: #1a2024; border-bottom: 1px solid #0d1114;
  }
  #editor button {
    font: inherit; color: inherit; background: #2f383e; border: 1px solid #0d1114;
    border-radius: 3px; padding: 3px 8px; cursor: pointer;
  }
  #editor button:hover { background: #3a464d; }
  #editor button[aria-pressed="true"] { background: #4a7a3f; border-color: #63a354; }
  #editor button:disabled { opacity: .4; cursor: default; }

  #ed-tools { display: flex; gap: 4px; padding: 8px; flex-wrap: wrap; border-bottom: 1px solid #0d1114; }

  #ed-layers { overflow-y: auto; max-height: 34vh; border-bottom: 1px solid #0d1114; }
  .ed-layer {
    display: flex; align-items: center; gap: 6px; padding: 2px 8px; cursor: pointer;
  }
  .ed-layer:hover { background: #2a3237; }
  .ed-layer[aria-selected="true"] { background: #33505e; }
  .ed-layer .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ed-layer .ct { color: #6b7c85; font-variant-numeric: tabular-nums; }
  .ed-layer .eye { width: 18px; text-align: center; opacity: .75; }
  .ed-layer .eye:hover { opacity: 1; }
  .ed-layer.hidden .nm { opacity: .4; text-decoration: line-through; }

  #ed-palette { flex: 1; overflow-y: auto; }
  .ed-ts-head {
    display: flex; justify-content: space-between; padding: 4px 8px; cursor: pointer;
    background: #262e33; border-top: 1px solid #0d1114; color: #9fb0ba;
  }
  .ed-ts-head:hover { color: #fff; }
  .ed-ts-body { padding: 4px; background: #14181b; overflow: auto; max-height: 260px; }
  .ed-ts-body img { image-rendering: pixelated; display: block; cursor: crosshair; }
  .ed-ts-wrap { position: relative; display: inline-block; }
  .ed-sel {
    position: absolute; border: 1px solid #7cf; background: rgba(120,200,255,.25);
    pointer-events: none;
  }

  #ed-status {
    padding: 5px 8px; background: #1a2024; border-top: 1px solid #0d1114;
    display: flex; justify-content: space-between; gap: 8px;
    font-variant-numeric: tabular-nums; color: #8a9aa4;
  }
  #ed-status .save-ok { color: #7fc26f; }
  #ed-status .save-dirty { color: #d8b45a; }
  #ed-status .save-err { color: #e2705f; font-weight: 600; }
`;

export interface Shell {
  tools: HTMLDivElement;
  layers: HTMLDivElement;
  palette: HTMLDivElement;
  setStatus(left: string, right: string, cls?: string): void;
}

export function buildShell(): Shell {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  document.body.classList.add('editing');

  const root = document.createElement('div');
  root.id = 'editor';
  root.innerHTML = `
    <div id="ed-tools"></div>
    <h2>Слои</h2>
    <div id="ed-layers"></div>
    <h2>Тайлы</h2>
    <div id="ed-palette"></div>
    <div id="ed-status"><span id="ed-status-left"></span><span id="ed-status-right"></span></div>
  `;
  document.body.append(root);

  const left = root.querySelector<HTMLSpanElement>('#ed-status-left')!;
  const right = root.querySelector<HTMLSpanElement>('#ed-status-right')!;

  return {
    tools: root.querySelector<HTMLDivElement>('#ed-tools')!,
    layers: root.querySelector<HTMLDivElement>('#ed-layers')!,
    palette: root.querySelector<HTMLDivElement>('#ed-palette')!,
    setStatus(l, r, cls = '') {
      left.textContent = l;
      right.textContent = r;
      right.className = cls;
    },
  };
}
