import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/worker/**/*.test.ts"],
    // Worker integration tests share one test database, so files run one at a time.
    fileParallelism: false,
  },
});
