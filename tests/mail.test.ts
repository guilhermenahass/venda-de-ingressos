import { describe, expect, test } from "vitest";
import { esc } from "../lib/mail";

describe("esc", () => {
  test("escapa &, <, >, aspas duplas e simples", () => {
    expect(esc(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});
