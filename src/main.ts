import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { EditorScene } from './scenes/EditorScene';
import { whoami, logout } from './auth/client';
import { showAuthWindow, showAccountBadge } from './auth/window';
import { showCharacterCreate } from './auth/character-window';
import { fetchProgress, setPendingSave, setPendingChar, setAccount } from './auth/progress';
import { cleanName } from './game/save';

/** Игра и редактор — две разные сцены, вместе они не запускаются никогда. */
const editMode = import.meta.env.DEV && new URLSearchParams(location.search).has('edit');

/**
 * ?anim — редактор поз оружия. Ни игру, ни Phaser не поднимает: там нужен один
 * кадр под увеличением и мышь, а не игровой цикл. Динамический импорт — чтобы
 * редактор не попал в собранную игру.
 */
const animMode = import.meta.env.DEV && new URLSearchParams(location.search).has('anim');

function bootGame(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1a2b34',
    // Тайлы 16x16 — без этого браузер размылит их при увеличении.
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 } },
    },
    // В редакторе сцену на старте НЕ запускаем: иначе она загрузит forest ещё до
    // того, как пользователь выберет карту на стартовом экране. Её добавит и
    // запустит start.ts — уже после выбора.
    scene: editMode ? [] : [GameScene],
  });

  if (import.meta.env.DEV) {
    // Чтобы можно было ковырять сцену из консоли браузера: game.scene.getScene('world')
    (globalThis as Record<string, unknown>).game = game;

    // Редактор подключается только по ?edit и только в разработке. Динамический
    // импорт нужен, чтобы он не попал в собранную игру. start сначала даёт выбрать
    // карту (стартовый экран), а уже потом запускает сцену и монтирует редактор.
    if (editMode) {
      game.scene.add('world', EditorScene, false); // добавлена, но не запущена — старт за start.ts
      void import('./editor/start').then((m) => m.startEditor(game));
    }
  }
}

async function main(): Promise<void> {
  // Редактор анимации — дев-инструмент, игру не поднимает вовсе.
  if (animMode) {
    const { mountAnimEditor } = await import('./anim/mount');
    await mountAnimEditor();
    return;
  }

  // Редактор — дев-инструмент для правки карт, за окном входа не прячем.
  if (editMode) {
    bootGame();
    return;
  }

  // Игра открывается только после входа. Сначала пробуем сохранённый токен;
  // не вошёл — показываем окно и ждём, пока войдёт или зарегистрируется.
  const name = (await whoami()) ?? (await showAuthWindow());

  // Под каким аккаунтом хранить локальный сейв — до его чтения.
  setAccount(name);

  // Прогресс тянем ДО старта игры: сцена в onReady применяет его синхронно, а
  // из сети в момент создания сцены его не подгрузить.
  const save = await fetchProgress();

  // Нет героя (новый игрок) — экран создания: класс и ник. Есть ник в сейве —
  // идём сразу в игру. Ник передаём сцене отдельно (у нового сейва ещё нет).
  const savedName = cleanName((save as { charName?: unknown } | null)?.charName);
  const charName = savedName || (await showCharacterCreate()).name;
  setPendingChar(charName);

  setPendingSave(save);
  bootGame();

  // Плашка «вошёл как …»: без неё аккаунт не сменить. Выход гасит сессию и
  // перезагружает страницу — так игра снова упрётся в окно входа.
  showAccountBadge(name, () => {
    void logout().then(() => location.reload());
  });
}

void main();
