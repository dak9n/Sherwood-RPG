import Phaser from 'phaser';
import type { GameMap } from '../map/types';
import { MapDoc } from '../map/doc';
import { buildTilemap, updateAnimations, type MapView } from '../map/view';

const MAP_KEY = 'forest';
const MAP_URL = 'assets/maps/forest.json';
const TILESET_URL = 'assets/tilesets/';

/** Скорость панорамы WASD в экранных пикселях за миллисекунду (в мировые переводим делением на зум). */
const PAN_SPEED = 0.8;

type PanKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

/** Карта и тайлсеты загружены, doc и view готовы. */
export const WORLD_READY = 'world-ready';

export class WorldScene extends Phaser.Scene {
  doc!: MapDoc;
  view!: MapView;
  ready = false;
  private panKeys?: PanKeys;

  constructor() {
    super('world');
  }

  preload(): void {
    this.load.json(MAP_KEY, MAP_URL);
  }

  create(): void {
    const data = this.cache.json.get(MAP_KEY) as GameMap;

    // Картинки тайлсетов известны только из карты, поэтому это отдельный, второй
    // проход загрузки. Добавлять их из колбэка первого прохода нельзя: если очередь
    // загрузчика к тому моменту опустела, он их не подхватит и молча встанет.
    for (const ts of data.tilesets) {
      this.load.image(ts.name, TILESET_URL + ts.image);
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.doc = new MapDoc(data);
      this.view = buildTilemap(this, this.doc);
      this.setupCamera();
      this.ready = true;
      this.events.emit(WORLD_READY);
    });
    this.load.start();
  }

  /** Пересобрать карту после смены размера: у Phaser нет ресайза тайлмапа. */
  rebuild(doc: MapDoc): void {
    this.view.map.destroy();
    this.doc = doc;
    this.view = buildTilemap(this, doc);
  }

  /**
   * Вписать карту в текущий размер канваса. Публичный, потому что редактор
   * забирает часть экрана под панель уже после старта сцены, и камеру нужно
   * пересчитать заново.
   */
  fitCamera(): void {
    const cam = this.cameras.main;
    const mapWidth = this.doc.width * this.doc.map.tileWidth;
    const mapHeight = this.doc.height * this.doc.map.tileHeight;

    const fit = Math.min(this.scale.width / mapWidth, this.scale.height / mapHeight);
    cam.setZoom(Phaser.Math.Clamp(fit * 0.95, 0.25, 16));
    cam.centerOn(mapWidth / 2, mapHeight / 2);
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    this.fitCamera();
    this.input.mouse?.disableContextMenu();

    // WASD — панорама с клавиатуры. Capture выключен (false): иначе Phaser
    // перехватит эти клавиши по умолчанию, и их нельзя будет напечатать в поле
    // переименования слоя в редакторе.
    this.panKeys = this.input.keyboard?.addKeys('W,A,S,D', false) as PanKeys | undefined;

    // Панорама — средней кнопкой или пробелом с левой. Проверять Pointer.isDown нельзя:
    // он истинен для любой кнопки, и тогда кисть в редакторе таскала бы карту.
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

  update(_time: number, delta: number): void {
    if (!this.ready) return;
    updateAnimations(this.view, delta);
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
