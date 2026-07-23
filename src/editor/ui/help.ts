/**
 * Справка редактора: все сочетания клавиш и мыши в одном месте. Открывается по
 * кнопке «?». Если добавляешь новый хоткей — впиши его сюда, иначе о нём никто
 * не узнает.
 */

interface Shortcut {
  keys: string;
  what: string;
}
interface Group {
  title: string;
  items: Shortcut[];
}

const GROUPS: Group[] = [
  {
    title: 'Painting',
    items: [
      { keys: 'LMB', what: 'Paint with the active brush' },
      { keys: 'RMB', what: 'Erase' },
      { keys: 'E', what: 'Toggle the eraser' },
    ],
  },
  {
    title: 'Pick as brush',
    items: [
      { keys: 'Shift + LMB', what: 'Pick one tile under the cursor (eyedropper)' },
      { keys: 'Alt + LMB', what: 'Pick the whole object under the cursor' },
      { keys: 'Alt + drag', what: 'Frame an area (or the "Select" button)' },
      { keys: 'drag in the palette', what: 'Pick a rectangle of tiles from the tileset' },
      { keys: 'Esc', what: 'Clear the selection' },
    ],
  },
  {
    title: 'Spawns',
    items: [
      { keys: 'Spawns / M', what: 'Marker mode: place where the player and monsters appear' },
      { keys: 'pick a kind', what: 'Player start (green), monsters (amber), bosses (red)' },
      { keys: 'LMB', what: 'Place the picked spawn on a tile' },
      { keys: 'RMB', what: 'Remove the spawn under the cursor' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: 'W A S D', what: 'Move the camera' },
      { keys: 'MMB / Space + LMB', what: 'Drag the map' },
      { keys: 'Wheel', what: 'Zoom in / out' },
      { keys: 'G', what: 'Grid on/off' },
      { keys: 'Dim', what: 'Dim every layer except the active one' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: 'Ctrl + Z', what: 'Undo' },
      { keys: 'Ctrl + Shift + Z', what: 'Redo' },
    ],
  },
  {
    title: 'Layers',
    items: [
      { keys: '＋', what: 'New layer above the active one' },
      { keys: 'Double click / ✎', what: 'Rename the layer' },
      { keys: '🗑', what: 'Delete the layer' },
      { keys: 'Drag a row', what: 'Change layer order (up/down)' },
      { keys: '👁', what: 'Hide the layer on screen (not written to the file)' },
    ],
  },
  {
    title: 'Map',
    items: [
      { keys: 'Ctrl + S', what: 'Save the map to a file' },
      { keys: 'Save as', what: 'Save to a new file under a different name' },
      { keys: 'Maps', what: 'Back to the map list: open another or create a new one' },
      { keys: 'Resize', what: 'Change the map size' },
    ],
  },
];

const CSS = `
  dialog#ed-help {
    border: none; border-radius: 6px; padding: 0; max-width: 480px; width: 92vw;
    background: #20272b; color: #cfd8dc; box-shadow: 0 12px 44px rgba(0,0,0,.55);
  }
  dialog#ed-help::backdrop { background: rgba(0,0,0,.55); }
  .hlp { font: 13px/1.5 system-ui, sans-serif; }
  .hlp h3 {
    margin: 0; padding: 11px 16px; font-size: 14px; font-weight: 600;
    border-bottom: 1px solid #0d1114; display: flex; justify-content: space-between; align-items: center;
  }
  .hlp .body { padding: 6px 16px 16px; max-height: 72vh; overflow-y: auto; }
  .hlp .grp { margin-top: 14px; }
  .hlp .grp:first-child { margin-top: 6px; }
  .hlp .grp h4 {
    margin: 0 0 3px; font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .06em; color: #7d8f99;
  }
  .hlp .row { display: grid; grid-template-columns: 180px 1fr; gap: 10px; padding: 2px 0; align-items: baseline; }
  .hlp .keys { font: 12px/1.4 ui-monospace, "SF Mono", Consolas, monospace; color: #e0b25a; }
  .hlp .what { color: #b7c2c9; }
  .hlp .x {
    font: inherit; background: #2f383e; color: inherit; border: 1px solid #0d1114;
    border-radius: 3px; padding: 3px 11px; cursor: pointer;
  }
  .hlp .x:hover { background: #3a464d; }
`;

/** Открывает модальное окно справки. Esc, клик по фону или «Закрыть» — закрывают. */
export function showHelp(): void {
  const dlg = document.createElement('dialog');
  dlg.id = 'ed-help';

  const style = document.createElement('style');
  style.textContent = CSS;

  const groupsHtml = GROUPS.map(
    (g) => `
      <div class="grp">
        <h4>${g.title}</h4>
        ${g.items
          .map((it) => `<div class="row"><span class="keys">${it.keys}</span><span class="what">${it.what}</span></div>`)
          .join('')}
      </div>`,
  ).join('');

  dlg.innerHTML = `
    <div class="hlp">
      <h3>Hotkeys <button class="x">Close</button></h3>
      <div class="body">${groupsHtml}</div>
    </div>`;
  dlg.prepend(style);

  dlg.querySelector<HTMLButtonElement>('.x')!.onclick = () => dlg.close();
  // Клик по затемнённому фону (событие приходит на сам dialog) — закрыть.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());

  document.body.append(dlg);
  dlg.showModal();
}
