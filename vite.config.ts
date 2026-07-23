import { defineConfig } from 'vite';
import { saveMapPlugin } from './tools/save-map-plugin.ts';
import { saveAnchorsPlugin } from './tools/save-anchors-plugin.ts';
import { saveHelmPlugin } from './tools/save-helm-plugin.ts';
import { authPlugin } from './server/auth-plugin.ts';

export default defineConfig({
  // PORT из окружения: параллельные дев-серверы (второй чат, превью) получают
  // свой порт, не толкаясь на 5173. Без переменной — штатный порт Vite.
  server: { port: Number(process.env.PORT) || 5173 },
  plugins: [saveMapPlugin(), saveAnchorsPlugin(), saveHelmPlugin(), authPlugin()],
});
