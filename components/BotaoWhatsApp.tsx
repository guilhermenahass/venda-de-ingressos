/**
 * O ingresso vive numa página, não no e-mail. Mandar o link para o próprio
 * WhatsApp é a entrega mais barata e mais confiável que existe aqui: custo
 * zero, não depende de entrega de e-mail e fica no aparelho que a pessoa vai
 * levar para o teatro.
 */
export default function BotaoWhatsApp({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <a
      href={`https://wa.me/?text=${encodeURIComponent(texto)}`}
      className="flex w-full items-center justify-center gap-2 border border-tinta bg-tinta p-3.5 text-base font-semibold text-papel"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
        <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47s1.06 2.86 1.21 3.06c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35Z" />
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.02h-.01c-1.53 0-3.02-.41-4.32-1.19l-.31-.18-3.21.84.86-3.13-.2-.32a8.22 8.22 0 0 1-1.26-4.4c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24Z" />
      </svg>
      {rotulo}
    </a>
  );
}
