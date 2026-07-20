import { defineConfig } from 'vite';
import { saveMapPlugin } from './tools/save-map-plugin.ts';
import { saveAnchorsPlugin } from './tools/save-anchors-plugin.ts';
import { saveHelmPlugin } from './tools/save-helm-plugin.ts';
import { authPlugin } from './server/auth-plugin.ts';

export default defineConfig({
  plugins: [saveMapPlugin(), saveAnchorsPlugin(), saveHelmPlugin(), authPlugin()],
});
