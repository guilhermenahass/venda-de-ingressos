-- checkin_ticket aceitava qualquer token valido, sem conferir de qual evento
-- o ingresso e. Com duas sessoes no mesmo dia (tarde e noite, o formato comum
-- de espetaculo de escola), o ingresso da tarde daria entrada na porta da
-- noite. p_slug amarra o ingresso ao evento daquela portaria.
drop function if exists checkin_ticket(uuid);

create or replace function checkin_ticket(p_token uuid, p_slug text)
returns table(result text, seat_id text, buyer_name text, checked_in_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select t.id, t.seat_id, t.checked_in_at, t.revoked_at, o.buyer_name, o.status as order_status,
         e.slug as event_slug
    into r
    from tickets t
    join orders o on o.id = t.order_id
    join events e on e.id = o.event_id
   where t.qr_token = p_token
     for update of t;

  -- ingresso de outro evento responde igual a token inexistente: a portaria nao
  -- precisa saber que o ingresso existe em outra sessao
  if not found or r.event_slug <> p_slug then
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
