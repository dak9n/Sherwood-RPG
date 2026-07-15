import Phaser from 'phaser';
import type { GameMap } from '../map/types';
import { MapDoc } from '../map/doc';
import { buildTilemap, updateAnimations, type MapView } from '../map/view';

const MAP_KEY = 'forest';
const MAP_URL = 'assets/maps/forest.json';
const TILESET_URL = 'assets/tilesets/';

/** Карта и тайлсеты загружены, doc и view готовы. */
export const WORLD_READY = 'world-ready';

/**
 * Общая основа игры и редактора: загрузить карту, построить тайлмап, анимировать
 * тайлы, дать камере мышь.
 *
 * Здесь только то, что нужно обоим. Всё, что нужно кому-то одному, живёт в
 * GameScene или EditorScene — иначе оба будут править этот файл и мешать друг
 * другу в git. Если правка нужна здесь, она задевает и игру, и редактор: об этом
 * стоит договориться, а не молча коммитить.
 */
export abstract class MapScene extends Phaser.Scene {
  doc!: MapDoc;
  view!: MapView;
  ready = false;

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

      this.onReady();

      this.ready = true;
      this.events.emit(WORLD_READY);
    });
    this.load.start();
  }

  /** Карта готова. Здесь наследник добавляет своё: игрока, панораму, что угодно. */
  protected onReady(): void {}

  /** Своё поведение каждый кадр. Карта уже готова. */
  protected onUpdate(_delta: number): void {}

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
    this.fitCamera();
    this.input.mouse?.disableContextMenu();
    // Панорама и зум мышью живут в EditorScene: в игре камера ведёт игрока, и
    // возможность утащить её колесом или средней кнопкой — это способ потерять
    // персонажа за кадром, а не фича.
  }

  update(_time: number, delta: number): void {
    if (!this.ready) return;
    updateAnimations(this.view, delta);
    this.onUpdate(delta);
  }
}
