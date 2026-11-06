-- Três tipos de ingresso por lugar, escolhidos pela compradora (pedido da PEC):
--   meia       = preço do setor, para beneficiários previstos em lei (documento na entrada)
--   antecipado = preço do setor, para todos, sem comprovação
--   inteira    = o dobro do preço do setor
-- orders.tipos guarda { "A-1": "meia", "A-2": "inteira" }; lugar ausente é
-- antecipado. create_order aqui SUBSTITUI a de 0014: ganha p_tipos e o preço
-- de cada lugar passa a considerar o tipo. O preço continua vindo do servidor.

alter table orders add column if not exists tipos jsonb not null default '{}';

drop function if exists create_order(uuid, text[], text, text, text, text, uuid);
create or replace function create_order(
  p_event uuid, p_seats text[], p_name text, p_email text, p_phone text, p_method text,
  p_cart uuid default null, p_tipos jsonb default '{}'
) returns table(order_id uuid, total_cents int)
language plpgsql security definer set search_path = public as $$
declare
  v_seats   text[] := array(select distinct unnest(p_seats));
  v_order   uuid := gen_random_uuid();
  v_tipos   jsonb;
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
  if jsonb_typeof(coalesce(p_tipos, '{}')) <> 'object' or exists (
       select 1 from jsonb_each_text(coalesce(p_tipos, '{}')) t where t.value not in ('meia', 'antecipado', 'inteira')) then
    raise exception 'INVALID_TIPO';
  end if;
  -- só os lugares deste pedido, e só o que não é antecipado (o padrão)
  select coalesce(jsonb_object_agg(t.key, t.value), '{}') into v_tipos
    from jsonb_each_text(coalesce(p_tipos, '{}')) t
   where t.key = any(v_seats) and t.value <> 'antecipado';

  select coalesce(sum(charged_cents(
           preco_vigente(sec.price_cents, sec.price2_cents, sec.price_change_at, now())
             * case v_tipos->>sid when 'inteira' then 2 else 1 end,
           case p_method when 'pix' then e.fee_pix_bps else e.fee_card_bps end,
           e.rounding_cents
         )), 0),
         coalesce(sum(preco_vigente(sec.price_cents, sec.price2_cents, sec.price_change_at, now())
             * case v_tipos->>sid when 'inteira' then 2 else 1 end), 0)
    into v_total, v_net
  from unnest(v_seats) sid
  join seats s on s.id = sid
  join event_sectors sec on sec.event_id = p_event and sec.sector = s.sector
  join events e on e.id = p_event;

  insert into orders (id, compra_id, event_id, buyer_name, email, phone, seat_ids, total_cents, method, net_expected_cents, tipos)
  values (v_order, v_order, p_event, p_name, lower(trim(p_email)), regexp_replace(p_phone, '\D', '', 'g'),
          v_seats, v_total, p_method, v_net, v_tipos);

  with upd as (
    update event_seats es
       set status = 'held', order_id = v_order,
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

-- create_compra aqui SUBSTITUI a de 0013: repassa os tipos de cada sessão
create or replace function create_compra(
  p_itens jsonb, p_name text, p_email text, p_phone text, p_method text, p_cart uuid default null
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
        v_event, array(select jsonb_array_elements_text(v_item->'seats')), p_name, p_email, p_phone, p_method, p_cart,
        coalesce(v_item->'tipos', '{}'));
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

revoke execute on function create_order(uuid, text[], text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function create_compra(jsonb, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function create_order(uuid, text[], text, text, text, text, uuid, jsonb) to service_role;
grant execute on function create_compra(jsonb, text, text, text, text, uuid) to service_role;
