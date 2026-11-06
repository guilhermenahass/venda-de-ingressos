-- A Juliana vende tudo aberto de uma vez, mas com o preco subindo numa data:
-- ate la todo mundo paga o valor promocional (ela chama de "meia"), depois
-- fica mais caro. Vale para os dois setores, por isso a coluna fica em
-- event_sectors e nao em events: se um dia ela quiser subir so um, ja da.
--
-- price_cents continua sendo o LIQUIDO do primeiro lote. price2_cents e o
-- liquido do segundo. Nulo em price_change_at significa preco unico.
alter table event_sectors
  add column if not exists price2_cents int check (price2_cents >= 0),
  add column if not exists price_change_at timestamptz;

-- os dois andam juntos: preco novo sem data, ou data sem preco novo, e engano
alter table event_sectors drop constraint if exists event_sectors_lote_completo;
alter table event_sectors add constraint event_sectors_lote_completo
  check ((price2_cents is null) = (price_change_at is null));

-- preco liquido valendo agora, num setor
create or replace function preco_vigente(
  p_price_cents int, p_price2_cents int, p_price_change_at timestamptz, p_agora timestamptz
) returns int language sql immutable as $$
  select case
    when p_price_change_at is not null and p_agora >= p_price_change_at then p_price2_cents
    else p_price_cents
  end;
$$;
