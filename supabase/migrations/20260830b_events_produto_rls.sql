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

-- Confere o resultado (deve listar os 7 nomes na checagem):
--   select polname, pg_get_expr(polwithcheck, polrelid)
--     from pg_policy where polrelid = 'public.events'::regclass;
