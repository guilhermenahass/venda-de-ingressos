-- O Supabase expõe toda função do schema public em /rest/v1/rpc e, por
-- padrão, concede EXECUTE a PUBLIC (o que inclui anon e authenticated). Como
-- estas funções são SECURITY DEFINER, elas rodam como dono e passam por cima
-- do RLS. Resultado: quem tivesse a URL do projeto e a chave anon -- que o
-- Supabase trata como pública -- chamaria mark_order_paid e emitiria
-- ingresso de graça, checkin_ticket sem o PIN da portaria, ou
-- mark_order_refunded para cancelar o ingresso de outra pessoa.
--
-- O site nunca usa a chave anon: tudo passa pelo servidor com a service
-- role. Então só a service role precisa executar e ler qualquer coisa.

revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;

-- funções criadas daqui em diante nascem fechadas também
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant  execute on functions to service_role;

-- As tabelas já estão com RLS ligado e sem policy nenhuma, o que bloqueia
-- anon. Tirar o privilégio também deixa de depender de ninguém criar uma
-- policy por engano no futuro.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
