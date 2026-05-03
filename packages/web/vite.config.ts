import { defineConfig } from 'vite';

// Production build is mounted at /relit/ inside ComfyUI (see scripts/comfy_init.py).
// Dev server runs at /, so use the appropriate base per command.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/relit/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
