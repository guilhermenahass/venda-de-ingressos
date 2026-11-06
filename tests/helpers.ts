import { db } from "../lib/db";

export async function makeEvent(opts: {
  seats?: number;
  priceCents?: number;
  opensInMinutes?: number; // negativo = já aberto
  sector?: string;
} = {}) {
  const n = opts.seats ?? 3;
  const sector = opts.sector ?? "ZZTEST";
  const slug = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const seats = Array.from({ length: n }, (_, i) => ({
    id: `ZZTEST-${i + 1}`, sector, row: "ZZTEST", number: i + 1, x: i * 30, y: 0,
  }));
  await db.from("seats").upsert(seats, { onConflict: "id" });

  const { data: ev, error } = await db.from("events")
    .insert({ slug, name: `Teste ${slug}`, date: new Date().toISOString(), status: "open" })
    .select().single();
  if (error) throw error;

  const opensAt = new Date(Date.now() + (opts.opensInMinutes ?? -1) * 60_000).toISOString();
  await db.from("event_sectors").insert({
    event_id: ev.id, sector, price_cents: opts.priceCents ?? 6000, sales_open_at: opensAt,
  });
  await db.from("event_seats").insert(seats.map((s) => ({ event_id: ev.id, seat_id: s.id })));

  return { eventId: ev.id as string, slug, seatIds: seats.map((s) => s.id) };
}

// p_method: "pix" é o default para os testes que não são sobre método de pagamento
// (create_order agora exige o parâmetro); fees.test.ts sobrescreve quando importa.
export const buyer = { p_name: "Maria Teste", p_email: "maria@example.com", p_phone: "15999990000", p_method: "pix" };
