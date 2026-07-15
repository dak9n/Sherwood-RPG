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
    title: 'Рисование',
    items: [
      { keys: 'ЛКМ', what: 'Рисовать активной кистью' },
      { keys: 'ПКМ', what: 'Стирать' },
      { keys: 'E', what: 'Переключить ластик' },
    ],
  },
  {
    title: 'Взять как кисть',
    items: [
      { keys: 'Shift + ЛКМ', what: 'Взять один тайл под курсором (пипетка)' },
      { keys: 'Alt + ЛКМ', what: 'Взять объект под курсором целиком' },
      { keys: 'Alt + протяжка', what: 'Обвести область рамкой (или кнопка «Выделить»)' },
      { keys: 'протяжка в палитре', what: 'Взять прямоугольник тайлов из тайлсета' },
      { keys: 'Esc', what: 'Сбросить выделение' },
    ],
  },
  {
    title: 'Навигация',
    items: [
      { keys: 'W A S D', what: 'Двигать камеру' },
      { keys: 'Средняя кнопка / Space + ЛКМ', what: 'Тащить карту' },
      { keys: 'Колесо', what: 'Приблизить / отдалить' },
      { keys: 'G', what: 'Сетка вкл/выкл' },
      { keys: 'Затемнить', what: 'Приглушить все слои, кроме активного' },
    ],
  },
  {
    title: 'История',
    items: [
      { keys: 'Ctrl + Z', what: 'Отменить' },
      { keys: 'Ctrl + Shift + Z', what: 'Вернуть' },
    ],
  },
  {
    title: 'Слои',
    items: [
      { keys: '＋', what: 'Новый слой над активным' },
      { keys: 'Двойной клик / ✎', what: 'Переименовать слой' },
      { keys: '🗑', what: 'Удалить слой' },
      { keys: 'Перетащить строку', what: 'Сменить порядок слоёв (выше/ниже)' },
      { keys: '👁', what: 'Скрыть слой на экране (в файл не пишется)' },
    ],
  },
  {
    title: 'Карта',
    items: [
      { keys: 'Ctrl + S', what: 'Сохранить карту в файл' },
      { keys: 'Сохранить как', what: 'Сохранить в новый файл под другим именем' },
      { keys: 'Карты', what: 'К списку карт: открыть другую или создать новую' },
      { keys: 'Размер', what: 'Изменить размер карты' },
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
      <h3>Горячие клавиши <button class="x">Закрыть</button></h3>
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
