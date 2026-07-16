import { defineConfig } from 'vite';
import { saveMapPlugin } from './tools/save-map-plugin.ts';
import { authPlugin } from './server/auth-plugin.ts';

export default defineConfig({
  plugins: [saveMapPlugin(), authPlugin()],
});
