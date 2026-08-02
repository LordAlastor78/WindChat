import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const devHttps = process.env.DEV_HTTPS === 'true';

export default defineConfig({
  plugins: devHttps ? [basicSsl()] : [],
  server: {
    port: 3000,
    strictPort: false,
    // Enable HTTPS in dev when DEV_HTTPS environment variable is set to 'true'
    https: devHttps,
    host: '127.0.0.1',
    allowedHosts: ['.trycloudflare.com']
  },
  build: {
    target: 'ES2020',
    cssMinify: 'esbuild',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        chat: resolve(__dirname, 'chat.html')
      }
    }
  },
  preview: {
    port: 4183,
    strictPort: true,
    // En E2E el relay Rust corre en 8080; proxyamos el WebSocket al relay
    // sin afectar el sirvido de estáticos (vite sirve HTTP, proxya solo WS).
    proxy: {
      '/': {
        target: 'http://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
