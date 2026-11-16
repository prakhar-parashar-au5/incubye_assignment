import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      // The real package throws outside the React Server condition. Tests import server modules
      // directly, so it resolves to an empty module here.
      "server-only": path.join(root, "tests/support/server-only.ts"),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/component/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["tests/support/setup-dom.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
