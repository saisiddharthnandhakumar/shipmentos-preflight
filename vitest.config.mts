import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration files share one Neon dev branch; run files sequentially to keep timing predictable.
    fileParallelism: false,
  },
});
