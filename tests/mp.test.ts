import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { buildPreference, toMpDate, verifySignature } from "../lib/mp";

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  total_cents: 12000, event_name: "Espetáculo 2026", email: "maria@example.com",
  descricao: "06/11: A-1, A-2", quantidade: 2, method: "pix" as const, max_installments: 1,
};

test("toMpDate usa offset -03:00 e mantém o instante", () => {
  const d = new Date("2026-10-03T13:10:00.000Z");
  expect(toMpDate(d)).toBe("2026-10-03T10:10:00.000-03:00");
});

test("preference expira em 10 min, exclui boleto e usa preço do servidor", () => {
  const now = new Date("2026-10-03T13:00:00.000Z");
  const p: any = buildPreference(order, now);
  expect(p.external_reference).toBe(order.id);
  expect(p.expires).toBe(true);
  expect(p.expiration_date_to).toBe("2026-10-03T10:10:00.000-03:00");
  expect(p.date_of_expiration).toBe("2026-10-03T10:10:00.000-03:00");
  expect(p.payment_methods.excluded_payment_types).toEqual(
    [{ id: "credit_card" }, { id: "debit_card" }, { id: "prepaid_card" }, { id: "ticket" }],
  );
  expect(p.items[0].unit_price).toBe(120);
  expect(p.back_urls.success).toContain(`/pedido/${order.id}`);
  expect(p.notification_url).toContain("/api/webhooks/mp");
});

test("auto_return só é enviado quando APP_URL é https", () => {
  const now = new Date("2026-10-03T13:00:00.000Z");
  const original = process.env.APP_URL;
  try {
    process.env.APP_URL = "http://localhost:3000";
    const httpPref: any = buildPreference(order, now);
    expect(httpPref.auto_return).toBeUndefined();

    process.env.APP_URL = "https://example.com";
    const httpsPref: any = buildPreference(order, now);
    expect(httpsPref.auto_return).toBe("approved");
  } finally {
    process.env.APP_URL = original;
  }
});

test("verifySignature valida o HMAC do manifest", () => {
  const secret = "segredo";
  const ts = "1700000000";
  const dataId = "123456";
  const xRequestId = "req-1";
  const v1 = createHmac("sha256", secret)
    .update(`id:${dataId};request-id:${xRequestId};ts:${ts};`).digest("hex");
  expect(verifySignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId, secret })).toBe(true);
  expect(verifySignature({ xSignature: `ts=${ts},v1=deadbeef`, xRequestId, dataId, secret })).toBe(false);
});
