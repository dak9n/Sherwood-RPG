import Phaser from 'phaser';
import type { EditorState } from './state';

/** Сетка по тайлам и рамка кисти под курсором. Рисуется в мировых координатах. */
export class Overlay {
  private g: Phaser.GameObjects.Graphics;
  private cursor = { x: -1, y: -1 };
  private showGrid = true;

  constructor(
    private scene: Phaser.Scene,
    private state: EditorState,
  ) {
    this.g = scene.add.graphics().setDepth(1000);
  }

  setGrid(on: boolean): void {
    this.showGrid = on;
  }

  moveCursor(x: number, y: number): void {
    this.cursor = { x, y };
  }

  draw(): void {
    const { doc } = this.state;
    const tw = doc.map.tileWidth;
    const th = doc.map.tileHeight;
    const zoom = this.scene.cameras.main.zoom;

    this.g.clear();

    // Толщина линии делится на зум, иначе при отдалении сетка съест карту.
    const thin = 1 / zoom;

    // Граница карты видна всегда: без неё не понять, куда расширять.
    this.g.lineStyle(thin * 2, 0x7cc4ff, 0.9);
    this.g.strokeRect(0, 0, doc.width * tw, doc.height * th);

    if (this.showGrid && zoom >= 2) {
      this.g.lineStyle(thin, 0xffffff, 0.12);
      for (let x = 1; x < doc.width; x++) {
        this.g.lineBetween(x * tw, 0, x * tw, doc.height * th);
      }
      for (let y = 1; y < doc.height; y++) {
        this.g.lineBetween(0, y * th, doc.width * tw, y * th);
      }
    }

    if (doc.inBounds(this.cursor.x, this.cursor.y)) {
      const { w, h } = this.state.brush;
      this.g.lineStyle(thin * 2, 0xffe07c, 0.95);
      this.g.strokeRect(this.cursor.x * tw, this.cursor.y * th, w * tw, h * th);
    }
  }
}
