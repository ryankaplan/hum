import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      arranger: fileURLToPath(
        new URL("./node_modules/arranger/dist/index.js", import.meta.url),
      ),
    },
  },
  ssr: {
    noExternal: ["arranger"],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
