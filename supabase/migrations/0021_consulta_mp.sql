-- A página do pedido se atualiza a cada 4 s e cada atualização perguntava ao
-- Mercado Pago se o pagamento chegou. Com centenas de pessoas na tela do Pix
-- na abertura, isso viraria milhares de consultas por minuto com a mesma
-- chave, e o MP poderia limitar a conta inteira (inclusive a criação de Pix).
-- Agora no máximo uma consulta a cada 15 s por compra; o aviso do MP
-- (webhook) continua sendo o caminho principal.
alter table orders add column if not exists mp_consultado_em timestamptz;

create or replace function pode_consultar_mp(p_compra uuid)
returns boolean language sql security definer set search_path = public as $$
  with u as (
    update orders set mp_consultado_em = now()
     where id = p_compra and (mp_consultado_em is null or mp_consultado_em < now() - interval '15 seconds')
    returning 1
  )
  select exists (select 1 from u);
$$;
revoke execute on function pode_consultar_mp(uuid) from public, anon, authenticated;
grant execute on function pode_consultar_mp(uuid) to service_role;
