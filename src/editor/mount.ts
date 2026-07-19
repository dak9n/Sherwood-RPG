import Phaser from 'phaser';
import { MapDoc } from '../map/doc';
import { resizeMap } from '../map/resize';
import {
  withLayerAdded, withLayerRemoved, withLayerMoved, suggestLayerName,
  withLayerGrouped, withGroupLabelAt, suggestGroupName,
} from '../map/layers';
import { EditorState } from './state';
import type { CellEdit } from './edit';
import { installTools, type Tool } from './tools';
import { Overlay } from './overlay';
import { PassOverlay } from './pass-overlay';
import { draftCollision } from '../map/collision-draft';
import { findTallObjects } from '../game/tall-objects';
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
  const passOverlay = new PassOverlay(scene, state.doc, scene.view);
  // Правку проходимости в apply рисуем точечно: O(1) на клетку вместо обхода 9800.
  state.onPass = (x, y, pass) => passOverlay.paint(x, y, pass);

  /**
   * Залить проходимость черновиком по картинке.
   *
   * Без этого размечать пришлось бы с нуля: сейчас во всех картах проходимость —
   * сплошные нули, и в режиме стен экран был бы равномерно серым. Черновик даёт
   * основу (вода, край нарисованного, стволы), а кисть её уточняет.
   */
  function seedDraft(): void {
    const draft = draftCollision(state.doc, findTallObjects(state.doc), state.doc.map.tileHeight);
    const edits: CellEdit[] = [];
    for (let y = 0; y < state.doc.height; y++) {
      for (let x = 0; x < state.doc.width; x++) {
        const i = y * state.doc.width + x;
        edits.push({ kind: 'pass', x, y, before: state.doc.getPass(x, y), after: draft.collision[i] });
      }
    }
    // Одной правкой: Ctrl+Z должен откатывать заливку целиком, а не по клетке.
    state.apply(edits);
    refreshStatus();
  }
  let tool: Tool = 'brush';

  const redrawLayers = buildLayers(shell.layers, state, {
    onDelete: deleteLayer,
    onRename: (i, name) => state.renameLayer(i, name),
    onReorder: reorderLayer,
    onAssignGroup: assignGroup,
    onRenameGroup: (from, to) => state.renameGroup(from, to),
    onDisbandGroup: disbandGroup,
  });
  buildPalette(shell.palette, state);
  shell.addLayer.onclick = addLayer;
  shell.addGroup.onclick = addGroup;

  // Кнопки
  const btn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.onclick = onClick;
    shell.tools.append(b);
    return b;
  };

  const brushBtn = btn('Brush', 'Paint (LMB)', () => setTool('brush'));
  const eraserBtn = btn('Eraser', 'Erase (RMB or this mode)', () => setTool('eraser'));
  const selectBtn = btn('Select', 'Drag a box around an object and take it as a brush (same as Alt+drag)', () =>
    setTool('select'),
  );
  const wallBtn = btn(
    'Walls',
    'Paint collision: LMB — wall, RMB — walkable. Box in a river, cliff or house — the player will not enter',
    () => setTool('wall'),
  );
  const draftBtn = btn(
    'Auto-fill',
    'Fill collision automatically from the picture (water, edges, trunks) — so you do not mark the whole map from scratch',
    () => seedDraft(),
  );
  const gridBtn = btn('Grid', 'Show the grid (at 2x zoom and above)', () => {
    gridOn = !gridOn;
    overlay.setGrid(gridOn);
    gridBtn.setAttribute('aria-pressed', String(gridOn));
  });
  const dimBtn = btn('Dim', 'Toggle dimming of every layer except the active one — you see what you are editing', () => {
    dimInactive = !dimInactive;
    dimBtn.setAttribute('aria-pressed', String(dimInactive));
    applyDim();
  });
  const undoBtn = btn('↶', 'Undo (Ctrl+Z)', () => state.undo());
  const redoBtn = btn('↷', 'Redo (Ctrl+Shift+Z)', () => state.redo());
  btn('Resize', 'Change the map size', () => doResize());
  const saveBtn = btn('Save', 'Write the map to a file (Ctrl+S)', () => doSave());
  btn('Save as', 'Save the current map to a new file under a different name', () => void doSaveAs());
  btn('Maps', 'To the map list: open another map or create a new one', () => backToPicker());
  btn('?', 'Editor hotkeys', () => showHelp());

  let gridOn = true;
  gridBtn.setAttribute('aria-pressed', 'true');
  let dimInactive = false;
  dimBtn.setAttribute('aria-pressed', 'false');

  function setTool(next: Tool): void {
    tool = next;
    brushBtn.setAttribute('aria-pressed', String(next === 'brush'));
    eraserBtn.setAttribute('aria-pressed', String(next === 'eraser'));
    selectBtn.setAttribute('aria-pressed', String(next === 'select'));
    wallBtn.setAttribute('aria-pressed', String(next === 'wall'));
    // Накладку показываем только в своём режиме: поверх карты она мешает рисовать.
    passOverlay.setVisible(next === 'wall');
    draftBtn.disabled = next !== 'wall';
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
        ? ` · brush ${state.brush.w}×${state.brush.h}`
        : '';

    shell.setStatus(
      `${state.mapName} · ${layer} · ${where} · ${raw || 'empty'}${brush}`,
      saveNote || (state.dirty ? 'unsaved' : 'saved'),
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
    saveNote = 'saving…';
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
        alert(`Map "${state.mapName}" already exists. Open it from the list or save under a different name.`);
        saveNote = 'name taken — unsaved';
        saveClass = 'save-err';
        refreshStatus();
        return;
      }
      // Файл на диске изменился с момента загрузки — предложить перезапись.
      const keep = confirm(
        'The map file on disk has changed since the editor loaded it.\n' +
          'It could have been git, a converter or a second editor.\n\n' +
          'OK — write my version over it (the old one goes to .map-backups).\n' +
          'Cancel — do nothing, your edits stay in the editor.',
      );
      if (keep) {
        state.baseRevision = res.revision;
        await doSave(true);
        return;
      }
      saveNote = 'conflict — unsaved';
      saveClass = 'save-err';
      refreshStatus();
      return;
    }

    saveNote = res.kind === 'invalid' ? `map failed validation (${res.errors.length})` : 'save error';
    saveClass = 'save-err';
    refreshStatus();
    console.error('Save failed:', res);
  }

  // Сохранить как: текущая карта уходит в НОВЫЙ файл под другим именем.
  async function doSaveAs(): Promise<void> {
    const maps = await fetchMaps();
    const newName = await askMapName(maps, 'Save as', 'Save');
    if (!newName) return;

    saveBtn.disabled = true;
    saveNote = 'saving…';
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
    if (res.kind === 'conflict') alert(`Map "${newName}" already exists — pick another name.`);
    saveNote = res.kind === 'invalid' ? `map failed validation (${res.errors.length})` : 'unsaved';
    saveClass = 'save-err';
    refreshStatus();
  }

  // К списку карт: уходим на стартовый экран (?edit без map).
  function backToPicker(): void {
    if (state.dirty && !confirm('The map has unsaved edits. Discard them and go back to the map list?')) return;
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
      if (!confirm(`${req.dropped} tiles will be lost for good:\n${where}\n\nContinue?`)) return;
    }

    const { map } = resizeMap(state.doc.map, req.deltas);
    const doc = new MapDoc(map);

    // У Phaser нет ресайза тайлмапа — только пересборка.
    scene.rebuild(doc);
    state.resetAfterResize(doc, scene.view);
    passOverlay.relayer(doc, scene.view); // rebuild уничтожил тайлмапу вместе с накладкой

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
    passOverlay.relayer(doc, scene.view); // rebuild уничтожил тайлмапу вместе с накладкой
  }

  function deleteLayer(index: number): void {
    if (state.doc.layers.length <= 1) return; // последний слой удалять нельзя
    const name = state.doc.layers[index].name;
    const filled = state.doc.countFilled(index);
    // Спрашиваем всегда: 🗑 легко задеть, а удаление структурно и чистит историю
    // Undo. Слой с тайлами предупреждает жёстче — их уже не вернуть.
    const question =
      filled > 0
        ? `Layer "${name}": ${filled} tiles will be lost for good.\nUndo will not bring them back. Delete the layer?`
        : `Delete layer "${name}"?`;
    if (!confirm(question)) return;

    const doc = new MapDoc(withLayerRemoved(state.doc.map, index));
    scene.rebuild(doc);
    state.relayer(doc, scene.view, index); // relayer сам поджимает индекс под укоротившийся список
    passOverlay.relayer(doc, scene.view);
  }

  function reorderLayer(from: number, to: number, group: string | null): void {
    // Членство пришло из панели — со строки, НА которую бросили: в папке она
    // или нет. Раньше группу угадывали по соседям, и слой, брошенный вплотную к
    // своей папке, прилипал обратно — вытащить его перетаскиванием было нельзя.
    if (from === to && (state.doc.layers[from].group ?? null) === group) return; // ни места, ни папки не сменили
    const doc = new MapDoc(withGroupLabelAt(withLayerMoved(state.doc.map, from, to), to, group));
    scene.rebuild(doc);
    state.relayer(doc, scene.view, to); // перемещённый слой остаётся активным
    passOverlay.relayer(doc, scene.view);
  }

  /**
   * Положить слой в группу (null — вынуть). Если группа уже существует, слой
   * переезжает в массиве вплотную к ней — это перестановка, то есть структурная
   * правка с пересборкой, как reorderLayer. Без переезда (первая метка группы
   * или снятие метки) хватает лёгкого пути: подпись поменялась, тайлы на местах.
   */
  function assignGroup(index: number, group: string | null): void {
    if (group === null) {
      state.setLayerGroupLabel(index, null);
      return;
    }
    const r = withLayerGrouped(state.doc.map, index, group);
    if (r.index === index) {
      // Порядок не менялся — метку можно поставить прямо в документе.
      state.setLayerGroupLabel(index, group);
      return;
    }
    const doc = new MapDoc(r.map);
    scene.rebuild(doc);
    state.relayer(doc, scene.view, r.index); // слой остаётся активным на новом месте
    passOverlay.relayer(doc, scene.view);
  }

  /**
   * «📁+» в заголовке панели: новая группа с активным слоем внутри — как в
   * Photoshop, где кнопка папки заворачивает выделенное. Пустых групп не бывает:
   * группа существует, пока на неё ссылается слой, и пустая исчезла бы сама.
   * Слой уже на месте, поэтому это лёгкая правка — только метка, без пересборки.
   */
  function addGroup(): void {
    state.setLayerGroupLabel(state.activeLayer, suggestGroupName(state.doc.map));
  }

  /**
   * Распустить группу. Без подтверждения намеренно: роспуск ничего не теряет —
   * слои остаются на карте со всеми тайлами, исчезает только папка, и собрать её
   * заново можно кнопкой «📁+». А блокирующий confirm тут ещё и опасен тем, что
   * браузер умеет молча глушить диалоги (если отметить «не показывать»), и кнопка
   * выглядела бы сломанной. От случайного клика бережёт то, что 🗑 виден только
   * при наведении на заголовок.
   */
  function disbandGroup(name: string): void {
    state.disbandGroup(name);
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

  console.log('Editor on. LMB — paint, RMB — erase, Shift+LMB — eyedropper, Space+LMB or MMB — pan the map.');
}
