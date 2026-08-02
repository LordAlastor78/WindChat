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
    // Code-splitting (§5.7): Vite 8 usa Rolldown → build.rolldownOptions.
    // Separar vendors pesados (KaTeX/highlight.js/marked/DOMPurify) del chunk
    // principal (~1.34 MB) en chunks dedicados para carga paralela/lazy.
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        chat: resolve(__dirname, 'chat.html')
      },
      output: {
        // §5.7: Rolldown requiere manualChunks como FUNCTION (no objeto).
        // Función que clasifica cada módulo en un chunk vendor dedicado.
        manualChunks(id) {
          if (id.includes('katex')) return 'katex';
          if (id.includes('highlight.js')) return 'highlight';
          if (id.includes('marked')) return 'markdown';
          if (id.includes('dompurify')) return 'dompurify';
          // Fallback: Rolldown genera chunks por defecto para el resto
        },
      },
    },
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
