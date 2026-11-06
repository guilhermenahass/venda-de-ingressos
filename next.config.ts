import type { NextConfig } from "next";

// Cabeçalhos de segurança de todas as páginas.
//
// CSP: tudo vem do próprio site. 'unsafe-inline' em script é exigência do
// Next (os dados de hidratação vão em <script> inline); em style, das fontes
// e dos atributos style do mapa. connect-src 'self' basta porque o navegador
// só fala com as nossas rotas; o Mercado Pago é navegação, não fetch.
// worker-src e blob: cobrem o leitor de QR da portaria.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Dev via túnel (ngrok): libera o host do APP_URL para HMR e chunks do cliente.
  allowedDevOrigins: process.env.APP_URL ? [new URL(process.env.APP_URL).host] : [],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // /pedido/{id} e /t/{token} funcionam como senha: quem tem o link vê
          // o pedido. Para outros sites vai só o domínio, nunca o caminho.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // a câmera só serve à portaria; o resto fica desligado
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
      {
        // páginas com dados de quem comprou, ou de uso interno, não entram em buscador
        source: "/:dir(pedido|t|portaria|meus-ingressos|atendimento)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:dir(portaria|meus-ingressos|atendimento)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
