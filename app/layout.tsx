import type { Metadata } from "next";
import { Archivo, Rye } from "next/font/google";
import "./globals.css";

// Rye é tipo de madeira vitoriano: a mesma família da arte do PECkywest.
// Archivo faz o trabalho pesado — rótulo, número de cadeira e valor — com
// algarismos tabulares, que é o que mantém o mapa alinhado.
const rye = Rye({ variable: "--font-rye", subsets: ["latin"], weight: "400", display: "swap" });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "PECkywest — Ingressos | PEC Studio",
  description: "Ingressos de PECkywest, o Mistério de Daisy Belle. PEC Studio, Sorocaba.",
  // prévia do link no WhatsApp/Instagram: sem isto aparece só o título, sem a arte
  metadataBase: new URL(process.env.APP_URL ?? "https://pec-ingressos.vercel.app"),
  openGraph: {
    title: "PECkywest — O Mistério de Daisy Belle",
    description: "Dias 06 e 07 de novembro, 19h30. Escolha seu lugar no mapa. Ingresso antecipado com valor promocional para todos!",
    images: [{ url: "/arte/peckywest-og.jpg", width: 1200, height: 630, alt: "PECkywest — O Mistério de Daisy Belle" }],
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${rye.variable} ${archivo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
