import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // §fix-test: los tests E2E en tools/integration/ requieren node real + WebCrypto
    // (window.crypto.subtle.generateKey falla en happy-dom). Correlos con:
    //   npm run test:integration  →  node tools/integration/run_integration.js
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.config.*', 'tools/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.config.*',
        '**/tests/**',
      ],
    },
  },
});
