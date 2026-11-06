-- Pix sem login: o checkout do Mercado Pago exige conta para pagar no Pix
-- (no cartão deixa pagar como convidado). O Pix passa a ser gerado pela API,
-- e o QR aparece na nossa página do pedido.
--
-- O QR do Pix vale no mínimo 30 minutos, então o lugar de quem escolheu Pix
-- fica guardado 35. create_order aqui SUBSTITUI a de 0013: muda só o prazo.

alter table orders
  add column if not exists pix_qr text,
  add column if not exists pix_qr_base64 text;

create or replace function create_order(
  p_event uuid, p_seats text[], p_name text, p_email text, p_phone text, p_method text, p_cart uuid default null
) returns table(order_id uuid, total_cents int)
language plpgsql security definer set search_path = public as $$
declare
  v_seats   text[] := array(select distinct unnest(p_seats));
  v_order   uuid := gen_random_uuid();
  v_total   int;
  v_net     int;
  v_ok      text[];
  v_missing text[];
begin
  if p_method not in ('pix', 'card') then
    raise exception 'INVALID_METHOD';
  end if;
  if array_length(v_seats, 1) is null or array_length(v_seats, 1) > 30 then
    raise exception 'INVALID_QTY';
  end if;
  if not exists (select 1 from events e where e.id = p_event and e.status = 'open') then
    raise exception 'EVENT_CLOSED';
  end if;

  -- preço vem do servidor, nunca do cliente; ver 0009 para o lote e a taxa
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

  insert into orders (id, compra_id, event_id, buyer_name, email, phone, seat_ids, total_cents, method, net_expected_cents)
  values (v_order, v_order, p_event, p_name, lower(trim(p_email)), regexp_replace(p_phone, '\D', '', 'g'),
          v_seats, v_total, p_method, v_net);

  -- reserva atômica: Postgres trava linha a linha; quem chegar depois reavalia o WHERE e falha
  with upd as (
    update event_seats es
       set status = 'held', order_id = v_order,
           -- Pix: o QR vale 30 min (mínimo do Mercado Pago) e o lugar espera
           -- um pouco mais; cartão: 10 min no checkout, 15 de folga
           held_until = now() + case p_method when 'pix' then interval '35 min' else interval '15 min' end
      from seats s, event_sectors sec
     where es.event_id = p_event
       and es.seat_id = any(v_seats)
       and s.id = es.seat_id
       and sec.event_id = es.event_id and sec.sector = s.sector
       and sec.sales_open_at <= now()
       and (es.status = 'free'
            or (es.status = 'held' and es.held_until < now())
            or (p_cart is not null and es.status = 'held' and es.order_id is null and es.cart_token = p_cart))
    returning es.seat_id
  )
  select array_agg(u.seat_id) into v_ok from upd u;

  select array_agg(sid order by sid) into v_missing
  from unnest(v_seats) sid
  where sid <> all(coalesce(v_ok, '{}'));

  if v_missing is not null then
    raise exception 'SEATS_UNAVAILABLE:%', array_to_string(v_missing, ',');
  end if;

  return query select v_order, v_total;
end $$;

