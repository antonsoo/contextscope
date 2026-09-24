import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Vite's project root is `web/` (index.html lives there); this file stays at the repo root so
// `vite build web` / `vite web` read one config regardless of cwd. The web app imports the core
// library straight from TypeScript source via this alias - no separate core build step needed for
// the dev server or the production bundle.
export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  base: "/contextscope/",
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./web/dist", import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 4306, fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] } },
  preview: { port: 4306 },
});
