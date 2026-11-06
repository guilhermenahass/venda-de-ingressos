-- token_by_code casa os 6 ultimos caracteres do token digitado na portaria.
-- Sao 6 caracteres hexadecimais: num evento de ~500 ingressos a chance de
-- existir um par que colide e de ~0,7%. A versao anterior fechava com
-- `limit 1`, entao a portaria digitava o codigo de uma pessoa e o sistema
-- fazia check-in na outra -- e a dona do codigo era recusada em seguida com
-- "ja entrou". Codigo ambiguo agora nao resolve para nada: a portaria cai no
-- QR, que e unico, em vez de liberar a entrada da pessoa errada.
create or replace function token_by_code(p_slug text, p_code text)
returns uuid language sql security definer set search_path = public as $$
  select (array_agg(m.q))[1]
    from (
      select t.qr_token as q
        from tickets t
        join orders o on o.id = t.order_id
        join events e on e.id = o.event_id
       where e.slug = p_slug
         and right(t.qr_token::text, 6) = lower(p_code)
       limit 2
    ) m
  having count(*) = 1;
$$;
