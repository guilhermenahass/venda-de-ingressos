-- Lugares que a PEC mandou travar para uma pessoa específica comprar depois
-- (ex.: cartão em análise que pode não passar). Enquanto o lugar estiver aqui:
--   - o pedido que já o segura pode ser pago (vira sold) ou ter o prazo estendido;
--   - qualquer coisa que o soltaria (expirar, recusar, desmarcar) vira 'blocked';
--   - ninguém mais consegue pegá-lo (carrinho ou pedido novo não acham a linha).
-- Para liberar: delete from travas where ...; e update event_seats set status='free'.
create table if not exists travas (
  event_id uuid not null references events(id),
  seat_id  text not null,
  motivo   text,
  criado_em timestamptz not null default now(),
  primary key (event_id, seat_id)
);
alter table travas enable row level security;
revoke all on travas from anon, authenticated;
grant all on travas to service_role;

create or replace function trava_lugar() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from travas t where t.event_id = new.event_id and t.seat_id = new.seat_id) then
    return new;
  end if;
  -- pagamento ou prazo estendido do mesmo pedido que já segura o lugar
  if old.status = 'held' and new.order_id is not distinct from old.order_id and old.order_id is not null
     and new.status in ('held', 'sold') then
    return new;
  end if;
  if new.status = 'blocked' or new.status = 'sold' and old.status = 'sold' then
    return new;
  end if;
  if new.status = 'free' then
    new.status := 'blocked'; new.held_until := null; new.order_id := null; new.cart_token := null;
    return new;
  end if;
  -- outra pessoa tentando pegar: a linha não muda (cart_hold/create_order veem "indisponível")
  return null;
end $$;

drop trigger if exists trava_lugar on event_seats;
create trigger trava_lugar before update on event_seats for each row execute function trava_lugar();

revoke execute on function trava_lugar() from public, anon, authenticated;
