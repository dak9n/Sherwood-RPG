import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { EditorScene } from './scenes/EditorScene';

/** Игра и редактор — две разные сцены, вместе они не запускаются никогда. */
const editMode = import.meta.env.DEV && new URLSearchParams(location.search).has('edit');

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
