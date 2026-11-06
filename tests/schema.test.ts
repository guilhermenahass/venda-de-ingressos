import { expect, test } from "vitest";
import { db } from "../lib/db";

test("tabelas existem", async () => {
  for (const t of ["seats", "events", "event_sectors", "orders", "event_seats", "tickets"]) {
    const { error } = await db.from(t).select("*").limit(1);
    expect(error, t).toBeNull();
  }
});
