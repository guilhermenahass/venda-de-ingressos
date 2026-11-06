import { expect, test } from "vitest";
test("env carregado", () => {
  expect(process.env.SUPABASE_URL).toBeDefined();
});
