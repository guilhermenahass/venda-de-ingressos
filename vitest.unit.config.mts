import { defineConfig } from "vitest/config";

// Testes que não precisam de banco: rodam no CI (GitHub Actions) sem segredos.
// A suíte completa (vitest.config.mts) roda contra um Supabase real.
export default defineConfig({
  test: {
    include: ["tests/{csv,mail,mp,publicar,seats-grid,smoke}.test.ts"],
    env: { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_ROLE_KEY: "ci", MP_ACCESS_TOKEN: "ci", MP_WEBHOOK_SECRET: "ci", RESEND_API_KEY: "ci", APP_URL: "http://localhost:3000" },
  },
});
