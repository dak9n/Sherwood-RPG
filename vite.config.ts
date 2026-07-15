import { defineConfig } from 'vite';
import { saveMapPlugin } from './tools/save-map-plugin.ts';

export default defineConfig({
  plugins: [saveMapPlugin()],
});
