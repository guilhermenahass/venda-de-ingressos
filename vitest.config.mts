import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // globalSetup roda fora do ambiente de teste e não enxerga `test.env`;
  // por isso as variáveis também entram no processo do próprio vitest.
  Object.assign(process.env, env);
  return {
    test: {
      env,
      testTimeout: 30_000,
      fileParallelism: false,
      globalSetup: ["./tests/global-setup.ts"],
    },
  };
});
