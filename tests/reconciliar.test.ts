import { describe, expect, test, vi } from "vitest";
import { db } from "../lib/db";
import { reconciliarPendentes } from "../lib/reconciliar";
import { buyer, makeEvent } from "./helpers";

// Cada teste varre SÓ o próprio evento. Sem isso a suíte alcança os pedidos
// reais do banco e marca como pagos pedidos que ninguém pagou — foi o que
// aconteceu com a demo antes deste filtro existir.
async function pedidoPendente(idadeMin: number, seats = 1) {
  const ev = await makeEvent({ seats });
  const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: ev.seatIds, ...buyer });
  const id = data[0].order_id as string;
  await db.from("orders")
    .update({ created_at: new Date(Date.now() - idadeMin * 60_000).toISOString() }).eq("id", id);
  return { id, eventId: ev.eventId };
}

describe("reconciliarPendentes", () => {
  test("resgata pedido pendente que ja tinha pagamento aprovado", async () => {
    const { id, eventId } = await pedidoPendente(30);
    // o fake faz o que confirmarPagamento faria ao achar o pagamento no MP
    const check = vi.fn(async (o: string) => { await db.rpc("mark_order_paid", { p_order: o, p_payment_id: "pay-rec" }); });

    const r = await reconciliarPendentes({ eventId, deps: { checkPendingOrder: check } });
    expect(check).toHaveBeenCalledWith(id);
    expect(r.confirmados).toBeGreaterThanOrEqual(1);

    const { data: o } = await db.from("orders").select("status").eq("id", id).single();
    expect(o!.status).toBe("paid");
  });

  test("pedido recem-criado fica de fora: o fluxo normal ainda pode resolver", async () => {
    const { id, eventId } = await pedidoPendente(0);
    const check = vi.fn(async () => {});
    await reconciliarPendentes({ eventId, deps: { checkPendingOrder: check } });
    expect(check).not.toHaveBeenCalledWith(id);
  });

  test("a varredura nao sai do evento pedido", async () => {
    const meu = await pedidoPendente(30);
    const alheio = await pedidoPendente(30);
    const check = vi.fn(async () => {});
    await reconciliarPendentes({ eventId: meu.eventId, deps: { checkPendingOrder: check } });
    expect(check).toHaveBeenCalledWith(meu.id);
    expect(check).not.toHaveBeenCalledWith(alheio.id);
  });

  test("um pedido com erro nao derruba a varredura dos outros", async () => {
    // os dois no mesmo evento, para a varredura alcancar ambos sem sair dele
    const ev = await makeEvent({ seats: 2 });
    const pedir = async (assento: string) => {
      const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: [assento], ...buyer });
      const id = data[0].order_id as string;
      await db.from("orders").update({ created_at: new Date(Date.now() - 30 * 60_000).toISOString() }).eq("id", id);
      return id;
    };
    const ruim = await pedir(ev.seatIds[0]);
    const bom = await pedir(ev.seatIds[1]);
    const check = vi.fn(async (o: string) => {
      if (o === ruim) throw new Error("MP fora do ar");
      await db.rpc("mark_order_paid", { p_order: o, p_payment_id: "pay-rec2" });
    });

    const r = await reconciliarPendentes({ eventId: ev.eventId, deps: { checkPendingOrder: check } });
    expect(check).toHaveBeenCalledWith(ruim);
    expect(check).toHaveBeenCalledWith(bom);
    expect(r.falhas).toBeGreaterThanOrEqual(1);

    const { data: o } = await db.from("orders").select("status").eq("id", bom).single();
    expect(o!.status).toBe("paid");
  });
});

test("muitas compras abandonadas não escondem um pagamento recente", async () => {
  const ev = await makeEvent({ seats: 60 });
  const ids: string[] = [];
  for (let i = 0; i < 55; i++) {
    const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: [ev.seatIds[i]], ...buyer });
    ids.push(data[0].order_id);
  }
  // 55 abandonadas: entre 1 e 2 horas atrás
  for (const id of ids) await db.from("orders").update({ created_at: new Date(Date.now() - 90 * 60_000).toISOString() }).eq("id", id);
  // a que importa: 10 min atrás
  const { data } = await db.rpc("create_order", { p_event: ev.eventId, p_seats: [ev.seatIds[55]], ...buyer });
  const recente = data[0].order_id as string;
  await db.from("orders").update({ created_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eq("id", recente);
  const check = vi.fn(async () => {});
  await reconciliarPendentes({ eventId: ev.eventId, deps: { checkPendingOrder: check } });
  expect(check).toHaveBeenCalledWith(recente);
});

test("pendente de mais de 3 horas expira", async () => {
  const { id, eventId } = await pedidoPendente(200);
  await reconciliarPendentes({ eventId, deps: { checkPendingOrder: vi.fn(async () => {}) } });
  const { data: o } = await db.from("orders").select("status").eq("id", id).single();
  expect(o!.status).toBe("expired");
});
