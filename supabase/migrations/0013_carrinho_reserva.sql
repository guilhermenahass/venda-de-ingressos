-- Lugar fica guardado no toque, como nos sites de ingresso com mapa.
--
-- Antes, o carrinho vivia só no celular: a mãe marcava P-10 no dia 06, ia
-- escolher o dia 07 e, nesse meio tempo, outra pessoa comprava o P-10. Agora
-- cada toque reserva a cadeira no banco para o carrinho dela, e ela aparece
-- ocupada para os outros.
--
-- O carrinho é identificado por um token aleatório que só o celular dela
-- conhece. O prazo é um só para o carrinho inteiro (as duas sessões), conta
-- do primeiro lugar marcado e não renova a cada toque: senão daria para
-- segurar lugar para sempre clicando de vez em quando. Venceu, as cadeiras
-- voltam para a venda sozinhas (held_until no passado já vale como livre em
-- todo o sistema).

alter table event_seats add column if not exists cart_token uuid;
create index if not exists event_seats_cart_idx on event_seats (cart_token) where cart_token is not null;

create table if not exists carts (
  token      uuid primary key,
  expires_at timestamptz not null
);
alter table carts add column if not exists ip text;
create index if not exists carts_ip_idx on carts (ip);
alter table carts enable row level security;
revoke all on carts from anon, authenticated;

-- pega uma cadeira para o carrinho; devolve o fim do prazo.
--
-- Teto por IP: o token é gerado pelo celular, então um robô criaria quantos
-- carrinhos quisesse e travaria o teatro inteiro sem pagar. 60 lugares vivos
-- por IP cobre duas famílias na mesma rede e corta isso.
drop function if exists cart_hold(uuid, uuid, text);
create or replace function cart_hold(p_token uuid, p_event uuid, p_seat text, p_ip text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_exp  timestamptz;
  v_vivos int;
begin
  if not exists (select 1 from events e where e.id = p_event and e.status = 'open') then
    raise exception 'EVENT_CLOSED';
  end if;

  -- trava o carrinho: dois toques ao mesmo tempo não furam o teto de 30
  insert into carts (token, expires_at, ip) values (p_token, now() + interval '10 min', p_ip)
  on conflict (token) do nothing;
  select expires_at into v_exp from carts where token = p_token for update;

  select count(*) into v_vivos from event_seats
   where cart_token = p_token and order_id is null and status = 'held' and held_until > now();
  -- carrinho vazio (ou vencido) começa um prazo novo
  if v_vivos = 0 then
    v_exp := now() + interval '10 min';
    update carts set expires_at = v_exp where token = p_token;
  end if;

  -- já é deste carrinho: nada a fazer (toque repetido, rede que reenviou)
  if exists (select 1 from event_seats where event_id = p_event and seat_id = p_seat
              and cart_token = p_token and order_id is null and status = 'held' and held_until > now()) then
    return v_exp;
  end if;

  if v_vivos >= 30 then raise exception 'LIMIT'; end if;
  if p_ip is not null and (
       select count(*) from event_seats es join carts c on c.token = es.cart_token
        where c.ip = p_ip and es.order_id is null and es.status = 'held' and es.held_until > now()
     ) >= 60 then
    raise exception 'LIMIT_IP';
  end if;

  update event_seats es
     set status = 'held', held_until = v_exp, cart_token = p_token, order_id = null
    from seats s, event_sectors sec
   where es.event_id = p_event and es.seat_id = p_seat
     and s.id = es.seat_id
     and sec.event_id = es.event_id and sec.sector = s.sector
     and sec.sales_open_at <= now()
     and (es.status = 'free' or (es.status = 'held' and es.held_until < now()));
  if not found then raise exception 'SEAT_UNAVAILABLE'; end if;
  return v_exp;
end $$;

-- solta uma cadeira do carrinho, ou todas da sessão se p_seat for null
create or replace function cart_release(p_token uuid, p_event uuid, p_seat text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update event_seats
     set status = 'free', held_until = null, cart_token = null
   where cart_token = p_token and order_id is null and status = 'held'
     and event_id = p_event and (p_seat is null or seat_id = p_seat);
end $$;

-- create_order aqui SUBSTITUI a de 0012: ganha p_cart. As cadeiras que o
-- carrinho guardou entram no pedido; as que ainda estão livres também (quem
-- chama sem carrinho, como os scripts, continua funcionando).
drop function if exists create_order(uuid, text[], text, text, text, text);
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
       set status = 'held', held_until = now() + interval '15 min', order_id = v_order
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

-- create_compra aqui SUBSTITUI a de 0012: repassa o carrinho
drop function if exists create_compra(jsonb, text, text, text, text);
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
        v_event, array(select jsonb_array_elements_text(v_item->'seats')), p_name, p_email, p_phone, p_method, p_cart);
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

-- o que o carrinho tem guardado agora, com o preço de cada sessão.
-- resta_seg vem do relógio do banco: o celular conta a partir daí, sem
-- depender da hora dele (nem da do servidor) estar certa.
drop function if exists cart_view(uuid);
create or replace function cart_view(p_token uuid)
returns table(event_id uuid, slug text, date timestamptz, seat_ids text[], pix_cents int, card_cents int, resta_seg int)
language sql security definer set search_path = public as $$
  select e.id, e.slug, e.date, array_agg(es.seat_id order by es.seat_id),
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

revoke execute on function cart_hold(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function cart_release(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function cart_view(uuid) from public, anon, authenticated;
revoke execute on function create_order(uuid, text[], text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function create_compra(jsonb, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function cart_hold(uuid, uuid, text, text) to service_role;
grant execute on function cart_release(uuid, uuid, text) to service_role;
grant execute on function cart_view(uuid) to service_role;
grant execute on function create_order(uuid, text[], text, text, text, text, uuid) to service_role;
grant execute on function create_compra(jsonb, text, text, text, text, uuid) to service_role;
grant all on carts to service_role;
