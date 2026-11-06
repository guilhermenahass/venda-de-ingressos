-- Cadeira indisponível: aparece no mapa, mas não é vendida nem guardada.
-- Usada nas fileiras Q e R (nível 9), que a PEC decidiu não vender. Não é
-- 'sold' porque não foi vendida a ninguém: o mapa mostra outra cor e a
-- contagem de lugares não a conta como livre.
alter table event_seats drop constraint if exists event_seats_status_check;
alter table event_seats add constraint event_seats_status_check
  check (status in ('free', 'held', 'sold', 'blocked'));
