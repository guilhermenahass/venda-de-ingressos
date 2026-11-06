-- Taxa repassada ao centavo: a PEC recebe exatamente o preço do ingresso.
--
-- Antes o total era arredondado para cima a R$ 0,50, o que dava à PEC alguns
-- centavos a mais e escondia quanto era taxa. Agora o total é o menor valor
-- em centavos que, descontada a taxa do Mercado Pago, deixa o líquido
-- inteiro. A taxa é calculada com arredondamento para cima (o pior caso para
-- a PEC), então nunca falta centavo.
--
-- Somar 5% em cima do preço não basta: o MP cobra a taxa sobre o total.
-- R$ 100 + 5% = R$ 105, e 4,98% de R$ 105 = R$ 5,23 -> sobram R$ 99,77.
-- Aqui: R$ 105,25 -> taxa R$ 5,25 -> sobram R$ 100,00.
--
-- Somar o total de cada lugar continua seguro numa compra com vários: a taxa
-- sobre a soma nunca passa da soma das taxas (ceil(a+b) <= ceil(a)+ceil(b)).
create or replace function charged_cents(p_net int, p_fee_bps int, p_rounding int)
returns int language plpgsql immutable as $$
declare
  c int := ceil(p_net::numeric / (1 - p_fee_bps::numeric / 10000));
begin
  while c - ceil(c::numeric * p_fee_bps / 10000) < p_net loop
    c := c + 1;
  end loop;
  -- p_rounding = 1 é o normal agora; maior que 1 só arredonda o total para cima
  return ceil(c::numeric / p_rounding)::int * p_rounding;
end $$;

alter table events alter column rounding_cents set default 1;
update events set rounding_cents = 1 where status = 'open';

-- cart_view ganha o preço dos ingressos (net_cents), para a tela mostrar
-- "ingressos + taxa" separados. SUBSTITUI a de 0013.
drop function if exists cart_view(uuid);
create or replace function cart_view(p_token uuid)
returns table(event_id uuid, slug text, date timestamptz, seat_ids text[], net_cents int, pix_cents int, card_cents int, resta_seg int)
language sql security definer set search_path = public as $$
  select e.id, e.slug, e.date, array_agg(es.seat_id order by es.seat_id),
         sum(preco_vigente(sec.price_cents, sec.price2_cents, sec.price_change_at, now()))::int,
         sum(charged_cents(preco_vigente(sec.price_cents, sec.price2_cents, sec.price_change_at, now()),
                           e.fee_pix_bps, e.rounding_cents))::int,
         sum(charged_cents(preco_vigente(sec.price_cents, sec.price2_cents, sec.price_change_at, now()),
                           e.fee_card_bps, e.rounding_cents))::int,
         greatest(0, ceil(extract(epoch from max(es.held_until) - now())))::int
    from event_seats es
    join events e on e.id = es.event_id
    join seats s on s.id = es.seat_id
    join event_sectors sec on sec.event_id = es.event_id and sec.sector = s.sector
   where es.cart_token = p_token and es.order_id is null and es.status = 'held' and es.held_until > now()
   group by e.id, e.slug, e.date
   order by e.date;
$$;
revoke execute on function cart_view(uuid) from public, anon, authenticated;
grant execute on function cart_view(uuid) to service_role;
