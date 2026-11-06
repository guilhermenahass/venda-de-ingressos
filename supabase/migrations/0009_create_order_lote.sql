-- create_order aqui SUBSTITUI a versao de 0004_reconciliacao.sql: mesma
-- assinatura, so troca o liquido fixo pelo liquido do lote vigente.
create or replace function create_order(
  p_event uuid, p_seats text[], p_name text, p_email text, p_phone text, p_method text
) returns table(order_id uuid, total_cents int)
language plpgsql security definer set search_path = public as $$
declare
  v_seats   text[] := array(select distinct unnest(p_seats));
  v_order   uuid;
  v_total   int;
  v_net     int;
  v_ok      text[];
  v_missing text[];
begin
  if p_method not in ('pix', 'card') then
    raise exception 'INVALID_METHOD';
  end if;
  if array_length(v_seats, 1) is null or array_length(v_seats, 1) > 10 then
    raise exception 'INVALID_QTY';
  end if;
  if not exists (select 1 from events e where e.id = p_event and e.status = 'open') then
    raise exception 'EVENT_CLOSED';
  end if;

  -- preco vem do servidor, nunca do cliente. O liquido e o do lote vigente
  -- AGORA (preco_vigente): antes da data e o promocional, depois o cheio. O
  -- total cobrado soma a taxa do MP do metodo escolhido e arredonda por evento.
  -- net_expected_cents e o liquido esperado, sem repasse, para conferir depois
  -- contra o que o Mercado Pago efetivamente repassa.
  --
  -- O preco congela no momento do pedido: quem reservou antes da virada paga o
  -- valor antigo mesmo que pague depois, o que e o esperado por quem comprou.
  select coalesce(sum(charged_cents(
           preco_vigente(sec.price_cents, sec.price2_cents, sec.price_change_at, now()),
           case p_method when 'pix' then e.fee_pix_bps else e.fee_card_bps end,
           e.rounding_cents
         )), 0),
         coalesce(sum(preco_vigente(sec.price_cents, sec.price2_cents, sec.price_change_at, now())), 0)
    into v_total, v_net
  from unnest(v_seats) sid
  join seats s on s.id = sid
  join event_sectors sec on sec.event_id = p_event and sec.sector = s.sector
  join events e on e.id = p_event;

  insert into orders (event_id, buyer_name, email, phone, seat_ids, total_cents, method, net_expected_cents)
  values (p_event, p_name, lower(trim(p_email)), regexp_replace(p_phone, '\D', '', 'g'), v_seats, v_total, p_method, v_net)
  returning id into v_order;

  -- reserva atômica: Postgres trava linha a linha; quem chegar depois reavalia o WHERE e falha
  with upd as (
    update event_seats es
       set status = 'held', held_until = now() + interval '15 min', order_id = v_order
      from seats s, event_sectors sec
     where es.event_id = p_event
       and es.seat_id = any(v_seats)
       and s.id = es.seat_id
       and sec.event_id = es.event_id and sec.sector = s.sector
       and sec.sales_open_at <= now()
       and (es.status = 'free' or (es.status = 'held' and es.held_until < now()))
    returning es.seat_id
  )
  select array_agg(u.seat_id) into v_ok from upd u;

  select array_agg(sid order by sid) into v_missing
  from unnest(v_seats) sid
  where sid <> all(coalesce(v_ok, '{}'));

  if v_missing is not null then
    -- a exceção desfaz o insert em orders e o update em event_seats
    raise exception 'SEATS_UNAVAILABLE:%', array_to_string(v_missing, ',');
  end if;

  return query select v_order, v_total;
end $$;
