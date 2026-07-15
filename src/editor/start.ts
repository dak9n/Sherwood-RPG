import type Phaser from 'phaser';
import { createBlankMap } from '../map/blank';
import { isSafeMapName } from '../map/name';
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

  // Новая карта: строим пустую в памяти. Тайлсеты не копируем — их подставит
  // общий каталог (applyCatalog) при загрузке сцены; размер тайла по умолчанию 16.
  const map = createBlankMap({ width: choice.width, height: choice.height });

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
