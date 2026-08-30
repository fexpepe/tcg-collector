-- ============================================================================
-- Eventos de produto, parte 2: a política de RLS (E6)
--
-- A 20260830a ampliou a whitelist do TRIGGER `events_guard` — e não bastou. A
-- tabela `events` tem DUAS trancas com lista de nomes, e o plano só conhecia
-- uma. O teste que descobriu isso (scripts/verifica-setup.mjs) separa as duas
-- pelo jeito de reclamar:
--
--   nome inválido  → HTTP 201, corpo []   (o trigger devolve NULL: some calado)
--   'export_done'  → HTTP 401, SQLSTATE 42501 "violates row-level security"
--
-- Ou seja: a linha ATRAVESSOU o trigger (senão teria sumido calada, como a de
-- nome inválido) e foi barrada pela política. É essa lista que falta ampliar.
--
-- Aplicar no SQL Editor do Supabase (projeto dlnalopazitfdgnmdguu):
--   https://supabase.com/dashboard/project/dlnalopazitfdgnmdguu/sql/new
-- Depois de aplicar, rode a aba Actions → "Verifica dependências externas".
--
-- POR QUE `alter policy` e não `drop`+`create`: a política foi criada no painel
-- e não está versionada aqui, então o nome dela e os papéis a que se aplica são
-- desconhecidos deste arquivo. `alter policy ... with check` troca SÓ a
-- expressão e deixa nome, comando e papéis intactos — recriar do zero seria
-- adivinhar duas coisas que ninguém aqui sabe.
--
-- ATUALIZAÇÃO 2026-08-30, depois de rodar: a única política que este SELECT
-- mostrou foi `events_insert_anyone`, INSERT, com checagem `true` — ou seja,
-- ela NÃO barra nada, e o bloco se recusou a mexer nela (certo: `true` não
-- menciona `name`). Mas o 42501 continua. Como o BEFORE trigger roda ANTES do
-- RLS, e o nome inválido morre no trigger (201 []) enquanto o `export_done`
-- chega ao RLS e é barrado, sobra uma política que este SELECT não enxergava:
-- ele filtrava `polwithcheck is not null`, e uma política `FOR ALL` que só tem
-- USING (sem WITH CHECK) usa o USING como checagem do INSERT — e tem
-- `polwithcheck` NULL. Política RESTRICTIVE também precisa aparecer: ela é
-- ANDada com as permissivas, então uma sozinha reprova tudo.
-- O SELECT no fim do arquivo passou a mostrar TODAS, com USING, WITH CHECK e o
-- tipo permissive/restrictive. Filtro em consulta de diagnóstico é como se
-- perde o suspeito.
--
-- E o bloco se RECUSA a mexer numa política cuja checagem olhe qualquer coisa
-- além do `name`: sobrescrever cegamente uma regra de segurança é exatamente
-- como se perde uma. Nesse caso ele só avisa, com a expressão atual no aviso,
-- e não altera nada.
-- ============================================================================

do $$
declare
  pol record;
  lista constant text :=
    $lista$'pageview','jserror','export_done','import_done','deck_created','backup_done','share_created'$lista$;
  outras_colunas constant text := '\m(path|anon|game|props|id|created_at)\M';
begin
  for pol in
    select p.polname, pg_get_expr(p.polwithcheck, p.polrelid) as chk
    from pg_policy p
    where p.polrelid = 'public.events'::regclass
      and p.polcmd in ('a', '*')          -- INSERT ou ALL
      and p.polwithcheck is not null
  loop
    if pol.chk ~ outras_colunas then
      raise notice 'política "%" NÃO alterada: a checagem olha mais que o nome → %', pol.polname, pol.chk;
    elsif pol.chk !~ '\mname\M' then
      raise notice 'política "%" NÃO alterada: a checagem nem menciona name → %', pol.polname, pol.chk;
    else
      execute format('alter policy %I on public.events with check (name = any (array[%s]))', pol.polname, lista);
      raise notice 'política "%" ampliada. Antes: %', pol.polname, pol.chk;
    end if;
  end loop;
end $$;

-- O RESULTADO, como tabela — não como RAISE NOTICE. O painel do Supabase mostra
-- notice num painel lateral fácil de não ver, e "rodei e não olhei o aviso" é
-- indistinguível de "rodei e funcionou". Isto aparece na grade de resultados, e
-- a coluna `checagem` tem que listar os 7 nomes. Se listar só pageview/jserror,
-- o bloco acima se recusou a mexer — e o motivo está no notice.
select
  polname                                              as politica,
  case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
              when 'd' then 'DELETE' when '*' then 'ALL' else polcmd::text end as comando,
  case when polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end             as tipo,
  coalesce((select string_agg(rolname, ', ') from pg_roles where oid = any (polroles)), 'PUBLIC') as papeis,
  pg_get_expr(polqual, polrelid)                       as usando,
  pg_get_expr(polwithcheck, polrelid)                  as checagem
from pg_policy
where polrelid = 'public.events'::regclass
order by polname;
