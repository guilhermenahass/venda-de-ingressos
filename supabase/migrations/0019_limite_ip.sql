-- Teto de lugares guardados por IP: 60 -> 150. As operadoras de celular
-- colocam muitos clientes atrás do mesmo IP (CGNAT); no pico da abertura,
-- várias famílias de verdade podiam dividir um IP e esbarrar em 60. Com 150
-- um robô ainda precisa de vários IPs para travar o teatro (~800 lugares).
-- cart_hold aqui SUBSTITUI a de 0013: muda só o número.
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
     ) >= 150 then
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

