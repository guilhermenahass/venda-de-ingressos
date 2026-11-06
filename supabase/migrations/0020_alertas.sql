-- Alerta por e-mail quando algo falha em produção, no máximo um por tipo a
-- cada 30 min (várias instâncias da Vercel disputam o mesmo registro aqui,
-- então a trava tem que ser no banco, não em memória).
create table if not exists alertas (
  tipo       text primary key,
  enviado_em timestamptz not null
);
alter table alertas enable row level security;
revoke all on alertas from anon, authenticated;
grant all on alertas to service_role;

create or replace function alerta_pode(p_tipo text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into alertas (tipo, enviado_em) values (p_tipo, now())
  on conflict (tipo) do update set enviado_em = now()
    where alertas.enviado_em < now() - interval '30 min';
  return found;
end $$;
revoke execute on function alerta_pode(text) from public, anon, authenticated;
grant execute on function alerta_pode(text) to service_role;
