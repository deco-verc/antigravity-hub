import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = process.env.VITE_BACKEND_PORT || process.env.PORT || '3001';
const target = `http://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target,
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 3002,
    host: true,
    proxy: {
      '/api': {
        target,
        changeOrigin: true
      }
    }
  }
});
