import type Phaser from 'phaser';
import { createBlankMap } from '../map/blank';
import { isSafeMapName } from '../map/name';
import type { GameMap } from '../map/types';
import { fetchMaps } from './save';
import { startScreen } from './ui/start-screen';

/**
 * Точка входа редактора. Сначала выясняем, какую карту открыть (по ?map или через
 * стартовый экран), и только потом запускаем сцену: EditorScene стоит active:false,
 * поэтому до этого момента ничего не грузится.
 */
export async function startEditor(game: Phaser.Game): Promise<void> {
  const maps = await fetchMaps();

  const preselected = new URLSearchParams(location.search).get('map');
  if (preselected && isSafeMapName(preselected) && maps.includes(preselected)) {
    // Пришли по ?edit&map=<name> (например, после выбора из списка) — без стартового экрана.
    // Проверка по списку: если карту удалили, а URL остался, не падаем, а покажем экран.
    openExisting(game, preselected);
    return;
  }

  const choice = await startScreen(maps);

  if (choice.kind === 'open') {
    // Перезагрузка на ?edit&map=<name>: свежий EditorState, а beforeunload штатно
    // предупредит о несохранённом, если оно есть.
    location.search = `?edit&map=${encodeURIComponent(choice.name)}`;
    return;
  }

  // Новая карта: тайлсеты и размер тайла берём из forest, строим пустую в памяти.
  const tpl = (await fetch('assets/maps/forest.json').then((r) => r.json())) as GameMap;
  const map = createBlankMap({
    width: choice.width,
    height: choice.height,
    tileWidth: tpl.tileWidth,
    tileHeight: tpl.tileHeight,
    tilesets: tpl.tilesets,
  });

  game.registry.set('mapName', choice.name);
  game.registry.set('mapIsNew', true);
  game.scene.start('world', { mapData: map }); // передаём карту прямо в память — файла ещё нет
  void import('./mount').then((m) => m.mountEditor(game));
}

/** Открыть существующую карту с диска: registry → старт сцены → монтирование редактора. */
function openExisting(game: Phaser.Game, name: string): void {
  game.registry.set('mapName', name);
  game.scene.start('world'); // preload загрузит assets/maps/<name>.json
  void import('./mount').then((m) => m.mountEditor(game));
}
