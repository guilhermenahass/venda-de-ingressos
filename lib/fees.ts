/** Espelha charged_cents() de supabase/migrations/0015_taxa_ao_centavo.sql — só
 * para exibição no cliente e nos scripts; o valor que vale é sempre o do servidor.
 * Menor total em centavos que, descontada a taxa (arredondada para cima, o pior
 * caso), deixa o líquido inteiro para a PEC. */
export function chargedCents(netCents: number, feeBps: number, roundingCents = 1): number {
  // a taxa em centavos inteiros: 498 bps de c = c*498/10000, arredondado para cima
  const taxa = (c: number) => Math.ceil((c * feeBps) / 10000);
  let c = Math.ceil((netCents * 10000) / (10000 - feeBps));
  while (c - taxa(c) < netCents) c++;
  return Math.ceil(c / roundingCents) * roundingCents;
}

/** Espelha preco_vigente() de supabase/migrations/0008_lote.sql. O líquido muda
 * de lote na data marcada; nulo em priceChangeAt significa preço único. */
export function precoVigente(
  priceCents: number, price2Cents: number | null, priceChangeAt: string | null, agora: number,
): number {
  if (price2Cents == null || priceChangeAt == null) return priceCents;
  return agora >= new Date(priceChangeAt).getTime() ? price2Cents : priceCents;
}
