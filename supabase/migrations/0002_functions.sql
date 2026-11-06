create or replace function create_order(
  p_event uuid, p_seats text[], p_name text, p_email text, p_phone text
) returns table(order_id uuid, total_cents int)
language plpgsql security definer set search_path = public as $$
declare
  v_seats   text[] := array(select distinct unnest(p_seats));
  v_order   uuid;
  v_total   int;
  v_ok      text[];
  v_missing text[];
begin
  if array_length(v_seats, 1) is null or array_length(v_seats, 1) > 10 then
    raise exception 'INVALID_QTY';
  end if;
  if not exists (select 1 from events e where e.id = p_event and e.status = 'open') then
    raise exception 'EVENT_CLOSED';
  end if;

  -- preço vem do servidor, nunca do cliente
  select coalesce(sum(sec.price_cents), 0) into v_total
  from unnest(v_seats) sid
  join seats s on s.id = sid
  join event_sectors sec on sec.event_id = p_event and sec.sector = s.sector;

  insert into orders (event_id, buyer_name, email, phone, seat_ids, total_cents)
  values (p_event, p_name, lower(trim(p_email)), regexp_replace(p_phone, '\D', '', 'g'), v_seats, v_total)
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

create or replace function mark_order_paid(p_order uuid, p_payment_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  o        orders%rowtype;
  v_held   int;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status = 'paid' then return 'already_paid'; end if;
  if o.status <> 'pending' then return 'conflict'; end if;

  -- posse: todos os assentos do pedido ainda precisam estar held por este pedido
  -- (for update trava as linhas: um create_order concorrente espera este commit
  -- e então enxerga 'sold', em vez de roubar o assento entre o count e o insert)
  with locked as (
    select 1 from event_seats es
    where es.event_id = o.event_id and es.seat_id = any(o.seat_ids)
      and es.order_id = p_order and es.status = 'held'
    for update
  )
  select count(*) into v_held from locked;

  if v_held <> array_length(o.seat_ids, 1) then
    update orders set status = 'conflict', mp_payment_id = p_payment_id where id = p_order;
    return 'conflict';
  end if;

  -- tickets só para os assentos que o UPDATE realmente vendeu (não para o array inteiro)
  with upd as (
    update event_seats set status = 'sold', held_until = null
     where event_id = o.event_id and seat_id = any(o.seat_ids)
       and order_id = p_order and status = 'held'
    returning seat_id
  )
  insert into tickets (order_id, seat_id)
  select p_order, u.seat_id from upd u;

  -- guarda final: com o for update acima isto nunca deveria disparar; se disparar,
  -- aborta a transação inteira em vez de emitir tickets pela metade
  if (select count(*) from tickets where order_id = p_order) <> array_length(o.seat_ids, 1) then
    raise exception 'PAID_SEAT_MISMATCH';
  end if;

  update orders set status = 'paid', mp_payment_id = p_payment_id where id = p_order;
  return 'paid';
end $$;

create or replace function mark_order_refunded(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'refunded' where id = p_order and status <> 'refunded';
  update tickets set revoked_at = now() where order_id = p_order and revoked_at is null;
  update event_seats set status = 'free', held_until = null, order_id = null
   where order_id = p_order;
end $$;

-- SUBSTITUIDA em 0007_checkin_por_evento.sql: la a funcao passa a receber
-- tambem o slug do evento. Mantida aqui so como historico da migration.
create or replace function checkin_ticket(p_token uuid)
returns table(result text, seat_id text, buyer_name text, checked_in_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select t.id, t.seat_id, t.checked_in_at, t.revoked_at, o.buyer_name, o.status as order_status
    into r
    from tickets t join orders o on o.id = t.order_id
   where t.qr_token = p_token
     for update of t;

  if not found then
    return query select 'not_found'::text, null::text, null::text, null::timestamptz; return;
  end if;
  if r.revoked_at is not null or r.order_status <> 'paid' then
    return query select 'revoked'::text, r.seat_id, r.buyer_name, null::timestamptz; return;
  end if;
  if r.checked_in_at is not null then
    return query select 'already'::text, r.seat_id, r.buyer_name, r.checked_in_at; return;
  end if;

  update tickets set checked_in_at = now() where id = r.id;
  return query select 'ok'::text, r.seat_id, r.buyer_name, now();
end $$;

create or replace function token_by_code(p_slug text, p_code text)
returns uuid language sql security definer set search_path = public as $$
  select t.qr_token
    from tickets t
    join orders o on o.id = t.order_id
    join events e on e.id = o.event_id
   where e.slug = p_slug
     and right(t.qr_token::text, 6) = lower(p_code)
   limit 1;
$$;
