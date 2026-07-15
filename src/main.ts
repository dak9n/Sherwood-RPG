import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';

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
  scene: [WorldScene],
});

if (import.meta.env.DEV) {
  // Чтобы можно было ковырять сцену из консоли браузера: game.scene.getScene('world')
  (globalThis as Record<string, unknown>).game = game;
}
