import Phaser from 'phaser';
import { MapDoc } from '../map/doc';
import { resizeMap } from '../map/resize';
import { withLayerAdded, withLayerRemoved, withLayerMoved, suggestLayerName } from '../map/layers';
import { EditorState } from './state';
import { installTools, type Tool } from './tools';
import { Overlay } from './overlay';
import { saveMap, saveMapAs, fetchRevision, fetchMaps } from './save';
import { askResize } from './resize-dialog';
import { buildShell } from './ui/shell';
import { buildLayers } from './ui/layers';
import { showHelp } from './ui/help';
import { askMapName } from './ui/start-screen';
import { buildPalette, revealBrush } from './ui/palette';
import { WORLD_READY } from '../scenes/MapScene';
import type { EditorScene } from '../scenes/EditorScene';

export function mountEditor(game: Phaser.Game): void {
  const scene = game.scene.getScene('world') as EditorScene;

  // Ждём именно готовности карты, а не запуска сцены: тайлсеты грузятся вторым
  // проходом уже после create, и до его конца doc с view не существуют.
  if (!scene.ready) {
    scene.events.once(WORLD_READY, () => mountEditor(game));
    return;
  }

  const mapName = (game.registry.get('mapName') as string | undefined) ?? 'forest';
  const isNew = game.registry.get('mapIsNew') === true;
  game.registry.set('mapIsNew', false); // флаг одноразовый

  const state = new EditorState(scene.doc, scene.view, mapName);
  state.dirty = isNew; // новую карту надо сохранить; beforeunload её защитит
  if (isNew) state.baseRevision = 'none'; // файла ещё нет; первое сохранение его создаст

  const shell = buildShell();

  // Панель забирает часть экрана уже после старта сцены: Phaser сам этого не
  // замечает — он слушает окно, а не разметку. Иначе карта останется в углу.
  game.scale.refresh();
  scene.fitCamera();

  // Панель можно тянуть за края — канвас при этом меняет ширину, и Phaser опять
  // об этом не узнает. Зум и положение камеры не трогаем: их настраивает
  // пользователь, и сбрасывать их на каждую подгонку панели незачем.
  window.addEventListener('resize', () => game.scale.refresh());

  const overlay = new Overlay(scene, state);
  let tool: Tool = 'brush';

  const redrawLayers = buildLayers(shell.layers, state, {
    onDelete: deleteLayer,
    onRename: (i, name) => state.renameLayer(i, name),
    onReorder: reorderLayer,
  });
  buildPalette(shell.palette, state);
  shell.addLayer.onclick = addLayer;

  // Кнопки
  const btn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.onclick = onClick;
    shell.tools.append(b);
    return b;
  };

  const brushBtn = btn('Кисть', 'Рисовать (ЛКМ)', () => setTool('brush'));
  const eraserBtn = btn('Ластик', 'Стирать (ПКМ или этот режим)', () => setTool('eraser'));
  const selectBtn = btn('Выделить', 'Обвести объект рамкой и взять его как кисть (то же самое — Alt+протяжка)', () =>
    setTool('select'),
  );
  const gridBtn = btn('Сетка', 'Показать сетку (при увеличении от 2x)', () => {
    gridOn = !gridOn;
    overlay.setGrid(gridOn);
    gridBtn.setAttribute('aria-pressed', String(gridOn));
  });
  const dimBtn = btn('Затемнить', 'Вкл/выкл затемнение всех слоёв, кроме активного — видно, что именно правишь', () => {
    dimInactive = !dimInactive;
    dimBtn.setAttribute('aria-pressed', String(dimInactive));
    applyDim();
  });
  const undoBtn = btn('↶', 'Отменить (Ctrl+Z)', () => state.undo());
  const redoBtn = btn('↷', 'Вернуть (Ctrl+Shift+Z)', () => state.redo());
  btn('Размер', 'Изменить размер карты', () => doResize());
  const saveBtn = btn('Сохранить', 'Записать карту в файл (Ctrl+S)', () => doSave());
  btn('Сохранить как', 'Сохранить текущую карту в новый файл под другим именем', () => void doSaveAs());
  btn('Карты', 'К списку карт: открыть другую карту или создать новую', () => backToPicker());
  btn('?', 'Горячие клавиши редактора', () => showHelp());

  let gridOn = true;
  gridBtn.setAttribute('aria-pressed', 'true');
  let dimInactive = false;
  dimBtn.setAttribute('aria-pressed', 'false');

  function setTool(next: Tool): void {
    tool = next;
    brushBtn.setAttribute('aria-pressed', String(next === 'brush'));
    eraserBtn.setAttribute('aria-pressed', String(next === 'eraser'));
    selectBtn.setAttribute('aria-pressed', String(next === 'select'));
  }
  setTool('brush');

  // Инструменты на карте
  let hover = { x: -1, y: -1 };
  installTools(scene, state, () => tool, {
    onPick: (note) => {
      revealBrush(shell.palette, state, state.brush);
      pickNote = note ?? '';
      noteBrush = state.brush;
      refreshStatus();
    },
    onHover: (x, y) => {
      hover = { x, y };
      overlay.moveCursor(x, y);
      refreshStatus();
    },
    onSelection: (rect) => {
      overlay.setSelection(rect);
      if (!rect) {
        // Сброс выделения возвращает кисть в одну клетку — иначе штамп остаётся,
        // а рамки, объясняющей его размер, уже нет.
        state.setBrush({ w: 1, h: 1, raws: [state.brush.raws.find(Boolean) ?? 0] });
        pickNote = '';
        refreshStatus();
      }
    },
  });

  scene.events.on('postupdate', () => overlay.draw());

  // Статус
  let saveNote = '';
  let saveClass = '';
  let pickNote = '';
  // Подпись относится к конкретной кисти: выбрал другую в палитре — подпись уходит.
  let noteBrush: unknown = null;

  function refreshStatus(): void {
    const layer = state.doc.layers[state.activeLayer]?.name ?? '?';
    const raw = state.doc.inBounds(hover.x, hover.y) ? state.doc.getRaw(state.activeLayer, hover.x, hover.y) : 0;
    const where = state.doc.inBounds(hover.x, hover.y) ? `${hover.x}:${hover.y}` : '—';

    if (state.brush !== noteBrush) pickNote = '';
    const brush = pickNote
      ? ` · ${pickNote}`
      : state.brush.w > 1 || state.brush.h > 1
        ? ` · кисть ${state.brush.w}×${state.brush.h}`
        : '';

    shell.setStatus(
      `${state.mapName} · ${layer} · ${where} · ${raw || 'пусто'}${brush}`,
      saveNote || (state.dirty ? 'не сохранено' : 'сохранено'),
      saveClass || (state.dirty ? 'save-dirty' : 'save-ok'),
    );
    undoBtn.disabled = !state.canUndo;
    redoBtn.disabled = !state.canRedo;
  }

  // Затемнение неактивных слоёв — чисто экранный эффект (alpha в Phaser), в файл
  // не пишется. Помогает видеть, что правишь, когда слоёв два десятка. Скрытые
  // «глазом» слои это не трогает: у них visible=false, alpha им не важен.
  const DIM_ALPHA = 0.25;
  function applyDim(): void {
    const layers = state.view.layers;
    for (let i = 0; i < layers.length; i++) {
      layers[i].setAlpha(dimInactive && i !== state.activeLayer ? DIM_ALPHA : 1);
    }
  }

  state.onChange(() => {
    redrawLayers();
    refreshStatus();
    // Пересборка карты (add/delete слоя) даёт новые слои с alpha=1 — приглушаем
    // заново; смена активного слоя — переносим подсветку на него.
    applyDim();
  });

  // Сохранение
  async function doSave(force = false): Promise<void> {
    saveBtn.disabled = true;
    saveNote = 'сохраняю…';
    saveClass = '';
    refreshStatus();

    const res = await saveMap(state, { force });
    saveBtn.disabled = false;

    if (res.ok) {
      state.markSaved(res.revision);
      // Первое сохранение новой карты: закрепляем ?map в URL, чтобы перезагрузка открыла её же.
      if (!new URLSearchParams(location.search).has('map')) {
        history.replaceState(null, '', `?edit&map=${encodeURIComponent(state.mapName)}`);
      }
      saveNote = '';
      saveClass = '';
      refreshStatus();
      return;
    }

    if (res.kind === 'conflict') {
      if (state.baseRevision === 'none') {
        // Думали, что СОЗДАЁМ файл, а карта с таким именем уже есть — чужое не затираем.
        alert(`Карта «${state.mapName}» уже существует. Открой её из списка или сохрани под другим именем.`);
        saveNote = 'имя занято — не сохранено';
        saveClass = 'save-err';
        refreshStatus();
        return;
      }
      // Файл на диске изменился с момента загрузки — предложить перезапись.
      const keep = confirm(
        'Файл карты на диске изменился с тех пор, как редактор её загрузил.\n' +
          'Это мог сделать git, конвертер или второй редактор.\n\n' +
          'OK — записать мою версию поверх (старая уйдёт в .map-backups).\n' +
          'Отмена — ничего не делать, ваши правки останутся в редакторе.',
      );
      if (keep) {
        state.baseRevision = res.revision;
        await doSave(true);
        return;
      }
      saveNote = 'конфликт — не сохранено';
      saveClass = 'save-err';
      refreshStatus();
      return;
    }

    saveNote = res.kind === 'invalid' ? `карта не прошла проверку (${res.errors.length})` : 'ошибка сохранения';
    saveClass = 'save-err';
    refreshStatus();
    console.error('Сохранение не удалось:', res);
  }

  // Сохранить как: текущая карта уходит в НОВЫЙ файл под другим именем.
  async function doSaveAs(): Promise<void> {
    const maps = await fetchMaps();
    const newName = await askMapName(maps, 'Сохранить как', 'Сохранить');
    if (!newName) return;

    saveBtn.disabled = true;
    saveNote = 'сохраняю…';
    saveClass = '';
    refreshStatus();

    const res = await saveMapAs(state, newName);
    saveBtn.disabled = false;

    if (res.ok) {
      state.mapName = newName; // дальше Ctrl+S пишет уже в новый файл
      state.persistHidden(); // скрытие слоёв запоминаем под новым именем карты
      state.markSaved(res.revision);
      history.replaceState(null, '', `?edit&map=${encodeURIComponent(newName)}`);
      saveNote = '';
      saveClass = '';
      refreshStatus();
      return;
    }
    // askMapName уже проверил имя по списку, так что 409 тут — редкая гонка.
    if (res.kind === 'conflict') alert(`Карта «${newName}» уже есть — выбери другое имя.`);
    saveNote = res.kind === 'invalid' ? `карта не прошла проверку (${res.errors.length})` : 'не сохранено';
    saveClass = 'save-err';
    refreshStatus();
  }

  // К списку карт: уходим на стартовый экран (?edit без map).
  function backToPicker(): void {
    if (state.dirty && !confirm('В карте есть несохранённые правки. Отбросить их и вернуться к списку карт?')) return;
    state.dirty = false; // осознанно отбрасываем — гасим предупреждение beforeunload
    location.search = '?edit';
  }

  // Изменение размера
  async function doResize(): Promise<void> {
    const req = await askResize(state.doc);
    if (!req) return;

    if (req.dropped > 0) {
      const where = Object.entries(req.droppedByLayer)
        .map(([n, c]) => `  ${n}: ${c}`)
        .join('\n');
      if (!confirm(`Будет безвозвратно потеряно ${req.dropped} тайлов:\n${where}\n\nПродолжить?`)) return;
    }

    const { map } = resizeMap(state.doc.map, req.deltas);
    const doc = new MapDoc(map);

    // У Phaser нет ресайза тайлмапа — только пересборка.
    scene.rebuild(doc);
    state.resetAfterResize(doc, scene.view);

    // Камера сдвигается вслед за картой, иначе она прыгнет под курсором.
    scene.cameras.main.scrollX += req.deltas.left * map.tileWidth;
    scene.cameras.main.scrollY += req.deltas.top * map.tileHeight;

    redrawLayers();
    refreshStatus();
  }

  // Слои. Добавление и удаление структурны — как ресайз, они пересобирают проекцию
  // Phaser (у неё нет вставки/удаления слоя на лету) и потому чистят историю.
  function addLayer(): void {
    const insertAt = state.activeLayer + 1; // над активным, как в графических редакторах
    const doc = new MapDoc(withLayerAdded(state.doc.map, suggestLayerName(state.doc.map), insertAt));
    scene.rebuild(doc);
    state.relayer(doc, scene.view, insertAt); // новый слой сразу активный
  }

  function deleteLayer(index: number): void {
    if (state.doc.layers.length <= 1) return; // последний слой удалять нельзя
    const name = state.doc.layers[index].name;
    const filled = state.doc.countFilled(index);
    // Спрашиваем всегда: 🗑 легко задеть, а удаление структурно и чистит историю
    // Undo. Слой с тайлами предупреждает жёстче — их уже не вернуть.
    const question =
      filled > 0
        ? `Слой «${name}»: ${filled} тайлов будут потеряны безвозвратно.\nUndo это не вернёт. Удалить слой?`
        : `Удалить слой «${name}»?`;
    if (!confirm(question)) return;

    const doc = new MapDoc(withLayerRemoved(state.doc.map, index));
    scene.rebuild(doc);
    state.relayer(doc, scene.view, index); // relayer сам поджимает индекс под укоротившийся список
  }

  function reorderLayer(from: number, to: number): void {
    if (from === to) return; // бросили на то же место — ничего не делаем
    const doc = new MapDoc(withLayerMoved(state.doc.map, from, to));
    scene.rebuild(doc);
    state.relayer(doc, scene.view, to); // перемещённый слой остаётся активным
  }

  // Горячие клавиши
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void doSave();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) state.redo();
      else state.undo();
      return;
    }
    if (e.key === 'e') setTool(tool === 'eraser' ? 'brush' : 'eraser');
    if (e.key === 'g') gridBtn.click();
  });

  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    // Правка любого src/*.ts перезагружает страницу — без этого несохранённая
    // карта тихо исчезнет посреди работы над редактором.
    e.preventDefault();
    e.returnValue = '';
  });

  // Ревизия файла на диске: по ней ловим правку в обход редактора. Карту грузит
  // Phaser, заголовков ответа наружу не отдаёт. Для новой карты файла ещё нет —
  // baseRevision уже 'none', запрашивать нечего.
  if (!isNew) {
    void fetchRevision(state.mapName).then((r) => {
      state.baseRevision = r;
      refreshStatus();
    });
  }

  refreshStatus();

  // Чтобы ковырять редактор из консоли браузера: editor.state, editor.save()
  (globalThis as Record<string, unknown>).editor = { state, save: doSave, resize: doResize };

  console.log('Редактор включён. ЛКМ — рисовать, ПКМ — стирать, Shift+ЛКМ — пипетка, Space+ЛКМ или СКМ — двигать карту.');
}
