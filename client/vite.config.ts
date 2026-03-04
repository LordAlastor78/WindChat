import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    port: 3000,
    https: true,
    strictPort: false
  },
  build: {
    target: 'ES2020',
    outDir: 'dist',
    sourcemap: true
  }
});
