import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 4187, strictPort: true },
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 650 },
});
