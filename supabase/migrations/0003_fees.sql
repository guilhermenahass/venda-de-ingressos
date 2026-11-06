-- Repasse da taxa do Mercado Pago por meio de pagamento (Task 14).
-- event_sectors.price_cents passa a significar "valor líquido que a PEC recebe"
-- (antes era o preço cobrado). O preço cobrado no Pix/cartão é derivado por
-- charged_cents() a partir desse líquido.
--
-- create_order() aqui SUBSTITUI a versão de 0002_functions.sql (create or replace,
-- então esta é a que vale): ganha p_method e passa a somar charged_cents() por
-- assento em vez de price_cents puro. O resto do comportamento é idêntico.

alter table events
  add column if not exists fee_pix_bps  int not null default 99,
  add column if not exists fee_card_bps int not null default 498,
  add column if not exists rounding_cents int not null default 50,
  add column if not exists max_installments int not null default 1;

alter table orders
  add column if not exists method text not null default 'pix'
    check (method in ('pix','card'));

create or replace function charged_cents(p_net int, p_fee_bps int, p_rounding int)
returns int language sql immutable as $$
  -- valor que o comprador paga para a casa receber p_net líquido, arredondado
  -- para cima ao múltiplo de p_rounding
  select ceil( (p_net::numeric / (1 - p_fee_bps::numeric / 10000)) / p_rounding )::int * p_rounding;
$$;

-- a assinatura muda (ganha p_method): "create or replace" só troca o corpo quando
-- os parâmetros batem exatamente, senão cria um overload. Como aqui o parâmetro
-- é novo, isto criaria as duas funções lado a lado; derruba a de 5 argumentos
-- primeiro para não deixar o create_order antigo (sem taxa) ainda chamável.
drop function if exists create_order(uuid, text[], text, text, text);

create or replace function create_order(
  p_event uuid, p_seats text[], p_name text, p_email text, p_phone text, p_method text
) returns table(order_id uuid, total_cents int)
language plpgsql security definer set search_path = public as $$
declare
  v_seats   text[] := array(select distinct unnest(p_seats));
  v_order   uuid;
  v_total   int;
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

  -- preço vem do servidor, nunca do cliente; price_cents é o líquido, o total
  -- cobrado depende do método (taxa do MP repassada) e é arredondado por evento
  select coalesce(sum(charged_cents(
           sec.price_cents,
           case p_method when 'pix' then e.fee_pix_bps else e.fee_card_bps end,
           e.rounding_cents
         )), 0)
    into v_total
  from unnest(v_seats) sid
  join seats s on s.id = sid
  join event_sectors sec on sec.event_id = p_event and sec.sector = s.sector
  join events e on e.id = p_event;

  insert into orders (event_id, buyer_name, email, phone, seat_ids, total_cents, method)
  values (p_event, p_name, lower(trim(p_email)), regexp_replace(p_phone, '\D', '', 'g'), v_seats, v_total, p_method)
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
