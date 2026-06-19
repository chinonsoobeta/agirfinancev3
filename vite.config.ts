import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: 'esm',
      quasiModuleReferenceResolutions: [],
    }),
    tanstackStart(),
    react(),
    tsconfigPaths(),
    tailwindcss(),
  ],
  server: {
    port: 8081,
  },
  build: {
    target: "ES2020",
  },
});
