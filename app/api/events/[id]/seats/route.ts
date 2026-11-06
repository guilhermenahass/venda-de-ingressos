import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // id malformado nem chega ao banco
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({}, { status: 404 });
  const { data, error } = await db.from("event_seats")
    .select("seat_id,status,held_until").eq("event_id", id);
  if (error) return NextResponse.json({}, { status: 500 });

  const now = Date.now();
  const map: Record<string, "free" | "held" | "sold" | "blocked"> = {};
  for (const r of data) {
    map[r.seat_id] = r.status === "held" && r.held_until && new Date(r.held_until).getTime() < now
      ? "free" : (r.status as "free" | "held" | "sold" | "blocked");
  }
  return NextResponse.json(map, {
    headers: { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=5" },
  });
}
