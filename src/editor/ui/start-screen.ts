import { mapNameError } from '../../map/name';
import { deleteMap } from '../save';

export type StartChoice =
  | { kind: 'open'; name: string }
  | { kind: 'new'; name: string; width: number; height: number };

/** Тот же предел, что в validate.ts: больше — точно опечатка. */
const MAX_CELLS = 1_000_000;
const WARN_CELLS = 96 * 64;

const CSS = `
  dialog.mm { border:none; border-radius:6px; padding:0; max-width:420px; width:92vw;
    background:#20272b; color:#cfd8dc; box-shadow:0 12px 44px rgba(0,0,0,.55); }
  dialog.mm::backdrop { background:rgba(0,0,0,.6); }
  .mm .in { font:13px/1.5 system-ui, sans-serif; padding:16px; }
  .mm h3 { margin:0 0 10px; font-size:15px; }
  .mm .lead { color:#8a9aa4; margin:0 0 12px; }
  .mm .list { display:flex; flex-direction:column; gap:3px; max-height:46vh; overflow-y:auto; margin-bottom:12px; }
  .mm .item { text-align:left; font:inherit; color:inherit; background:#2a3237; border:1px solid #0d1114;
    border-radius:3px; padding:7px 10px; cursor:pointer; }
  .mm .item:hover { background:#33505e; }
  .mm .empty { color:#7d8f99; padding:6px 2px; }
  .mm .map-row { display:flex; gap:4px; }
  .mm .map-row .item { flex:1; }
  .mm .map-del { font:inherit; background:#2a3237; color:#cfd8dc; border:1px solid #0d1114;
    border-radius:3px; padding:0 9px; cursor:pointer; }
  .mm .map-del:hover { background:#5a2f2f; color:#fff; }
  .mm label { display:block; margin:8px 0 2px; color:#8a9aa4; font-size:12px; }
  .mm input { width:100%; box-sizing:border-box; font:inherit; padding:5px 7px; background:#12171a;
    color:#dfe7eb; border:1px solid #3a464d; border-radius:3px; }
  .mm input.bad { border-color:#e2705f; }
  .mm .sizes { display:flex; gap:10px; }
  .mm .sizes > div { flex:1; }
  .mm .err { color:#e2705f; font-size:12px; min-height:16px; margin-top:3px; }
  .mm .info { color:#8a9aa4; font-size:12px; margin-top:8px; min-height:16px; }
  .mm .info.warn { color:#d8b45a; }
  .mm .info.danger { color:#e2705f; }
  .mm .row { display:flex; gap:6px; justify-content:flex-end; margin-top:14px; }
  .mm button.b { font:inherit; background:#2f383e; color:#dfe7eb; border:1px solid #0d1114;
    border-radius:3px; padding:5px 12px; cursor:pointer; }
  .mm button.b:hover { background:#3a464d; }
  .mm button.go { background:#4a7a3f; border-color:#63a354; }
  .mm button.go:disabled { opacity:.45; cursor:default; }
`;

function makeDialog(): HTMLDialogElement {
  const dlg = document.createElement('dialog');
  dlg.className = 'mm';
  const style = document.createElement('style');
  style.textContent = CSS;
  dlg.append(style);
  return dlg;
}

/**
 * Стартовый экран: открыть существующую карту или создать новую. Закрыть просто
 * так нельзя (cancel гасится) — редактору нечего показывать без карты.
 */
export function startScreen(maps: string[]): Promise<StartChoice> {
  return new Promise((resolve) => {
    const dlg = makeDialog();
    const done = (choice: StartChoice): void => {
      dlg.remove();
      resolve(choice);
    };

    const wrap = document.createElement('div');
    wrap.className = 'in';
    wrap.innerHTML = `<h3>Карта</h3><p class="lead">Открой существующую или создай новую.</p>`;

    const list = document.createElement('div');
    list.className = 'list';
    const current = [...maps]; // меняется при удалении — список перерисовываем

    function renderList(): void {
      list.textContent = '';
      if (current.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Пока нет ни одной карты.';
        list.append(empty);
        return;
      }
      for (const name of current) {
        const mapRow = document.createElement('div');
        mapRow.className = 'map-row';

        const open = document.createElement('button');
        open.className = 'item';
        open.textContent = name;
        open.onclick = () => done({ kind: 'open', name });
        mapRow.append(open);

        // forest — карта игры, её удалять нельзя (сервер тоже откажет).
        if (name !== 'forest') {
          const del = document.createElement('button');
          del.className = 'map-del';
          del.textContent = '🗑';
          del.title = `Удалить карту «${name}»`;
          del.onclick = async () => {
            if (!confirm(`Удалить карту «${name}»?\nФайл уйдёт в .map-backups — восстановить можно.`)) return;
            const res = await deleteMap(name);
            if (!res.ok) return void alert(`Не удалось удалить: ${res.error ?? ''}`);
            const at = current.indexOf(name);
            if (at !== -1) current.splice(at, 1);
            renderList();
          };
          mapRow.append(del);
        }
        list.append(mapRow);
      }
    }
    renderList();
    wrap.append(list);

    const row = document.createElement('div');
    row.className = 'row';
    const newBtn = document.createElement('button');
    newBtn.className = 'b go';
    newBtn.textContent = 'Новая карта';
    newBtn.onclick = async () => {
      const made = await askNewMap(current); // current учитывает удаления
      if (made) done({ kind: 'new', ...made });
    };
    row.append(newBtn);
    wrap.append(row);

    dlg.append(wrap);
    dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc не закрывает: карту выбрать обязательно
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Диалог новой карты: имя + размер, с живой проверкой. null — отмена (назад к списку). */
export function askNewMap(existing: string[]): Promise<{ name: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const dlg = makeDialog();
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'in';
    form.innerHTML = `
      <h3>Новая карта</h3>
      <label>Имя</label>
      <input name="name" autocomplete="off" placeholder="например, town" />
      <div class="err" id="err"></div>
      <div class="sizes">
        <div><label>Ширина, тайлов</label><input name="w" type="number" value="40" min="1" /></div>
        <div><label>Высота, тайлов</label><input name="h" type="number" value="30" min="1" /></div>
      </div>
      <div class="info" id="prev"></div>
      <div class="row">
        <button class="b" type="button" id="cancel">Отмена</button>
        <button class="b go" id="ok" disabled>Создать</button>
      </div>`;
    dlg.append(form);

    const nameI = form.querySelector('[name=name]') as HTMLInputElement;
    const wI = form.querySelector('[name=w]') as HTMLInputElement;
    const hI = form.querySelector('[name=h]') as HTMLInputElement;
    const err = form.querySelector('#err') as HTMLElement;
    const prev = form.querySelector('#prev') as HTMLElement;
    const ok = form.querySelector('#ok') as HTMLButtonElement;
    const intOf = (i: HTMLInputElement): number => Math.floor(Number(i.value)) || 0;

    const refresh = (): void => {
      const ne = mapNameError(existing, nameI.value);
      const typed = nameI.value.trim() !== '';
      nameI.classList.toggle('bad', ne !== null && typed);
      err.textContent = typed ? (ne ?? '') : '';

      const w = intOf(wI);
      const h = intOf(hI);
      let sizeOk = true;
      if (w <= 0 || h <= 0) {
        prev.textContent = 'размер должен быть больше нуля';
        prev.className = 'info danger';
        sizeOk = false;
      } else if (w * h > MAX_CELLS) {
        prev.textContent = `${w}×${h} — это ${w * h} клеток, слишком много`;
        prev.className = 'info danger';
        sizeOk = false;
      } else {
        prev.textContent = `${w}×${h} (${w * 16}×${h * 16} px)`;
        prev.className = w * h > WARN_CELLS ? 'info warn' : 'info';
      }
      ok.disabled = ne !== null || !sizeOk;
    };
    form.addEventListener('input', refresh);
    refresh();

    const done = (v: { name: string; width: number; height: number } | null): void => {
      dlg.remove();
      resolve(v);
    };
    (form.querySelector('#cancel') as HTMLButtonElement).onclick = () => done(null);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ok.disabled) done({ name: nameI.value.trim(), width: intOf(wI), height: intOf(hI) });
    });

    document.body.append(dlg);
    dlg.showModal();
    nameI.focus();
  });
}

/** Диалог одного имени (для «Сохранить как»). null — отмена. */
export function askMapName(existing: string[], title: string, okLabel: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = makeDialog();
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'in';
    form.innerHTML = `
      <h3></h3>
      <label>Имя карты</label>
      <input name="name" autocomplete="off" />
      <div class="err" id="err"></div>
      <div class="row">
        <button class="b" type="button" id="cancel">Отмена</button>
        <button class="b go" id="ok" disabled></button>
      </div>`;
    // textContent, а не в innerHTML: title/okLabel — свои строки, но привычка безопаснее.
    (form.querySelector('h3') as HTMLElement).textContent = title;
    dlg.append(form);

    const nameI = form.querySelector('[name=name]') as HTMLInputElement;
    const err = form.querySelector('#err') as HTMLElement;
    const ok = form.querySelector('#ok') as HTMLButtonElement;
    ok.textContent = okLabel;

    const refresh = (): void => {
      const ne = mapNameError(existing, nameI.value);
      const typed = nameI.value.trim() !== '';
      nameI.classList.toggle('bad', ne !== null && typed);
      err.textContent = typed ? (ne ?? '') : '';
      ok.disabled = ne !== null;
    };
    form.addEventListener('input', refresh);
    refresh();

    const done = (v: string | null): void => {
      dlg.remove();
      resolve(v);
    };
    (form.querySelector('#cancel') as HTMLButtonElement).onclick = () => done(null);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ok.disabled) done(nameI.value.trim());
    });

    document.body.append(dlg);
    dlg.showModal();
    nameI.focus();
  });
}
