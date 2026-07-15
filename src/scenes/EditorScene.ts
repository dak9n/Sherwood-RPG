import Phaser from 'phaser';
import { MapScene } from './MapScene';

/** Скорость панорамы WASD в экранных пикселях за миллисекунду (в мировые переводим делением на зум). */
const PAN_SPEED = 0.8;

type PanKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

/**
 * Сцена редактора. Всё про редактирование — здесь и в src/editor/.
 *
 * Игрока тут нет: он ловил бы клики кисти. Поэтому WASD свободны и двигают
 * камеру — в игре те же клавиши ведут персонажа, и это две разные сцены,
 * которые никогда не запускаются вместе.
 */
export class EditorScene extends MapScene {
  private panKeys?: PanKeys;

  constructor() {
    super('world');
    // Сцену запускает только src/editor/start.ts и только ПОСЛЕ выбора карты
    // (registry.mapName задан). Поэтому в main.ts её добавляют с autoStart=false,
    // а не в загрузочный массив: иначе preload загрузил бы forest вместо стартового экрана.
  }

  protected onReady(): void {
    // Capture выключен (false): иначе Phaser перехватит эти клавиши по умолчанию,
    // и их нельзя будет напечатать в поле переименования слоя.
    this.panKeys = this.input.keyboard?.addKeys('W,A,S,D', false) as PanKeys | undefined;
    this.setupMousePan();
  }

  /** Панорама и зум мышью — только в редакторе: в игре камера ведёт игрока. */
  private setupMousePan(): void {
    const cam = this.cameras.main;

    // Панорама — средней кнопкой или пробелом с левой. Проверять Pointer.isDown нельзя:
    // он истинен для любой кнопки, и тогда кисть таскала бы карту.
    const space = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const panning = p.middleButtonDown() || (p.leftButtonDown() && space?.isDown);
      if (!panning) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });

    // Зум колесом, с курсором как центром.
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.25, 16));
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });
  }

  protected onUpdate(delta: number): void {
    this.panCamera(delta);
  }

  /**
   * Панорама камеры на WASD. Экранная скорость держится постоянной независимо
   * от зума: в мировые пиксели шаг переводим делением на zoom, иначе при
   * увеличении карта улетала бы под рукой.
   */
  private panCamera(delta: number): void {
    const keys = this.panKeys;
    if (!keys) return;

    // Пока фокус в текстовом поле (переименование слоя), WASD печатают, а не двигают карту.
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) return;

    let dx = (keys.D.isDown ? 1 : 0) - (keys.A.isDown ? 1 : 0);
    let dy = (keys.S.isDown ? 1 : 0) - (keys.W.isDown ? 1 : 0);
    if (dx === 0 && dy === 0) return;

    // Диагональ не должна быть быстрее прямого хода.
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }

    const cam = this.cameras.main;
    const step = (PAN_SPEED * delta) / cam.zoom;
    cam.scrollX += dx * step;
    cam.scrollY += dy * step;
  }
}
