import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const helper = `http://127.0.0.1:${process.env.AW_PORT ?? 4747}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
    proxy: {
      '/api': helper,
      '/ws': { target: helper, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
