import QRCode from "qrcode";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("not found", { status: 404 });
  const png = await QRCode.toBuffer(`${process.env.APP_URL}/t/${token}`, { width: 400, margin: 1 });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
