import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [{
    name: 'compact-math-fonts',
    enforce: 'pre',
    transform(source, id) {
      if (id.replaceAll('\\', '/').includes('/katex/dist/katex') && id.endsWith('.css')) {
        return source.replace(/src:(url\([^)]*\.woff2\) format\("woff2"\))[^}]*/g, 'src:$1');
      }
    },
  }],
  base: './',
  build: { outDir: 'dist-web', target: 'es2022', chunkSizeWarningLimit: 700 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
