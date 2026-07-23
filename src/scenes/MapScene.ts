import Phaser from 'phaser';
import type { GameMap } from '../map/types';
import { MapDoc, ensureCollision } from '../map/doc';
import { applyCatalog, CATALOG_URL, type TilesetCatalog } from '../map/catalog';
import { buildTilemap, updateAnimations, type MapView } from '../map/view';

/** Ключ карты в json-кэше Phaser — просто ручка, не имя файла. */
const MAP_CACHE_KEY = 'map';
/** Общий каталог тайлсетов: один на все карты. */
const CATALOG_CACHE_KEY = 'tileset-catalog';
const MAPS_URL = 'assets/maps/';
const DEFAULT_MAP = 'forest';
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
  /** Новую (ещё не сохранённую) карту редактор передаёт прямо в память — файла для неё ещё нет. */
  private injected?: GameMap;

  init(data?: { mapData?: GameMap }): void {
    this.injected = data?.mapData;
  }

  preload(): void {
    // Каталог тайлсетов нужен всегда — даже новой карте, которую передали в память.
    this.load.json(CATALOG_CACHE_KEY, CATALOG_URL);

    if (this.injected) return; // карта уже в памяти — грузить нечего
    // Какую карту грузить, говорит registry (ставит стартовый экран редактора).
    // Игра его не трогает → падает на DEFAULT_MAP='forest', поведение прежнее.
    const name = (this.registry.get('mapName') as string | undefined) ?? DEFAULT_MAP;
    this.load.json(MAP_CACHE_KEY, `${MAPS_URL}${encodeURIComponent(name)}.json`);
  }

  create(): void {
    // Источник — либо переданная в память новая карта, либо загруженная с диска.
    // Карта на диске может быть ещё первой версии, без проходимости — дополняем
    // в памяти. На диск это попадёт при первом сохранении из редактора.
    const raw = ensureCollision(this.injected ?? (this.cache.json.get(MAP_CACHE_KEY) as GameMap));

    // Тайлсеты приходят из общего каталога: в файле карты версии 3 их нет.
    // Старая карта со своим списком его и оставит — иначе её номера тайлов поедут.
    const catalog = this.cache.json.get(CATALOG_CACHE_KEY) as TilesetCatalog;
    const data = applyCatalog(raw, catalog);

    // Картинки тайлсетов известны только из карты, поэтому это отдельный, второй
    // проход загрузки. Добавлять их из колбэка первого прохода нельзя: если очередь
    // загрузчика к тому моменту опустела, он их не подхватит и молча встанет.
    //
    // Грузим ВСЕ разом. У загрузчика Phaser есть предел одновременных закачек
    // (maxParallelDownloads, по умолчанию 32): файлы сверх него ждут в очереди, и
    // на границе ровно в 32 насос list->inflight у него глохнет — очередь так и
    // остаётся с хвостом, COMPLETE не наступает, onReady не зовётся, карта не
    // строится. Каталог дорос до 39 тайлсетов (добавили деревню) и упёрся в это.
    // Поднимаем предел выше числа тайлсетов: тогда в очереди ничего не оседает и
    // глохнуть нечему. Браузер всё равно сам держит настоящих соединений 6 на хост.
    for (const ts of data.tilesets) {
      this.load.image(ts.name, TILESET_URL + ts.image);
    }

    // Наследник докидывает своё во второй проход ЗДЕСЬ — до start и до
    // пересчёта предела. Добавлять из колбэков первого прохода нельзя (см.
    // выше — молча встанет), и GameScene со спрайтами брони на этом ловился.
    this.queueSecondPass();

    // Предел — по фактической очереди: worn-спрайтов может быть больше запаса.
    this.load.maxParallelDownloads = Math.max(this.load.maxParallelDownloads, this.load.list.size + 8);

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

  /**
   * Досыпать файлы во ВТОРОЙ проход загрузчика (create), когда результаты
   * первого — манифесты, карта — уже в кеше. Единственное безопасное место
   * для «файлов, о которых узнаёшь из других файлов».
   */
  protected queueSecondPass(): void {}

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
