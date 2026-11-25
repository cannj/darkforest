import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/room': { target: 'ws://127.0.0.1:8788', ws: true } } },
});
