-- Carrinho com as duas sessões: a família compra 06/11 e 07/11 de uma vez,
-- com um pagamento só.
--
-- Cada pedido continua sendo de UM evento (ingresso, portaria, lista e
-- estorno seguem iguais). O que muda é que pedidos pagos juntos têm o mesmo
-- compra_id, e é a compra que vai para o meio de pagamento. compra_id é o id
-- do primeiro pedido, então a compra de uma sessão só tem compra_id = id e o
-- link /pedido/{id} de antes continua valendo.

alter table orders add column if not exists compra_id uuid;
update orders set compra_id = id where compra_id is null;
alter table orders alter column compra_id set not null;
create index if not exists orders_compra_idx on orders (compra_id);

-- create_order aqui SUBSTITUI a versão de 0010: muda só o compra_id, que nasce
-- igual ao id do pedido.
create or replace function create_order(
  p_event uuid, p_seats text[], p_name text, p_email text, p_phone text, p_method text
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
    raise exception 'SEATS_UNAVAILABLE:%', array_to_string(v_missing, ',');
  end if;

  return query select v_order, v_total;
end $$;

-- p_itens: [{"event": uuid, "seats": ["A-1", ...]}, ...], um item por sessão.
-- Tudo ou nada: se um lugar de qualquer sessão já foi, nenhuma reserva fica.
-- O erro diz de qual sessão era: SEATS_UNAVAILABLE:<event>:A-1,A-2
create or replace function create_compra(
  p_itens jsonb, p_name text, p_email text, p_phone text, p_method text
) returns table(compra_id uuid, total_cents int)
language plpgsql security definer set search_path = public as $$
declare
  v_item   jsonb;
  v_event  uuid;
  v_compra uuid;
  v_total  int := 0;
  r        record;
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'INVALID_QTY';
  end if;
  -- o teto de 30 vale para a compra inteira, não por sessão
  if (select count(*) from jsonb_array_elements(p_itens) i, jsonb_array_elements_text(i->'seats')) > 30 then
    raise exception 'INVALID_QTY';
  end if;
  if (select count(distinct i->>'event') from jsonb_array_elements(p_itens) i) <> jsonb_array_length(p_itens) then
    raise exception 'INVALID_QTY';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_event := (v_item->>'event')::uuid;
    begin
      select * into r from create_order(
        v_event, array(select jsonb_array_elements_text(v_item->'seats')), p_name, p_email, p_phone, p_method);
    exception when raise_exception then
      if sqlerrm like 'SEATS_UNAVAILABLE:%' then
        raise exception 'SEATS_UNAVAILABLE:%:%', v_event, substr(sqlerrm, 19);
      end if;
      raise;
    end;
    v_compra := coalesce(v_compra, r.order_id);
    update orders set compra_id = v_compra where id = r.order_id;
    v_total := v_total + r.total_cents;
  end loop;

  return query select v_compra, v_total;
end $$;

-- Paga a compra inteira ou nada. Se um dos pedidos perdeu o lugar (pagamento
-- chegou depois do prazo), a compra toda vira conflito e o pagamento inteiro
-- é estornado: emitir metade dos ingressos de um pagamento único deixaria a
-- família com dinheiro preso e lugar faltando.
create or replace function mark_compra_paid(p_compra uuid, p_payment_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_r  text;
begin
  if not exists (select 1 from orders where compra_id = p_compra) then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if not exists (select 1 from orders where compra_id = p_compra and status <> 'paid') then
    return 'already_paid';
  end if;

  begin
    for v_id in select id from orders where compra_id = p_compra order by id for update loop
      v_r := mark_order_paid(v_id, p_payment_id);
      if v_r = 'conflict' then raise exception 'COMPRA_CONFLICT'; end if;
    end loop;
  exception when raise_exception then
    if sqlerrm <> 'COMPRA_CONFLICT' then raise; end if;
    -- o bloco desfez os pedidos já marcados; aqui todos viram conflito
    update orders set status = 'conflict', mp_payment_id = p_payment_id
     where compra_id = p_compra and status = 'pending';
    return 'conflict';
  end;
  return 'paid';
end $$;

create or replace function mark_compra_refunded(p_compra uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in select id from orders where compra_id = p_compra loop
    perform mark_order_refunded(v_id);
  end loop;
end $$;

revoke execute on function create_compra(jsonb, text, text, text, text) from public, anon, authenticated;
revoke execute on function mark_compra_paid(uuid, text) from public, anon, authenticated;
revoke execute on function mark_compra_refunded(uuid) from public, anon, authenticated;
grant execute on function create_compra(jsonb, text, text, text, text) to service_role;
grant execute on function mark_compra_paid(uuid, text) to service_role;
grant execute on function mark_compra_refunded(uuid) to service_role;
