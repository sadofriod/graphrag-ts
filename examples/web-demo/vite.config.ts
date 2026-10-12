import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mcp': { target: 'http://127.0.0.1:3000' },
      '/healthz': { target: 'http://127.0.0.1:3000' },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});