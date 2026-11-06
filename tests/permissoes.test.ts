import { afterAll, expect, test } from "vitest";
import postgres from "postgres";

// O Supabase expõe toda função do schema public na API REST e concede EXECUTE
// a qualquer um por padrão. Como as nossas rodam como dono, uma função aberta
// é um jeito de emitir ingresso sem pagar. Este teste falha se alguma
// migration recriar uma função sem fechar o acesso.
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
afterAll(() => sql.end());

test("nenhuma função do banco é executável pela chave pública", async () => {
  const abertas = await sql`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))`;
  expect(abertas.map((r) => r.proname)).toEqual([]);
});

test("a chave pública não tem privilégio em tabela nenhuma", async () => {
  const grants = await sql`
    select table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')`;
  expect(grants).toEqual([]);
});

test("toda tabela tem RLS ligado", async () => {
  const sem = await sql`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
  expect(sem.map((r) => r.relname)).toEqual([]);
});
