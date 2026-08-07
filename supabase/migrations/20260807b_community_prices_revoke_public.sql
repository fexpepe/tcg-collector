-- Correção da 20260807a: tirar do ANÔNIMO o direito de EXECUTAR as RPCs de
-- contribuição.
--
-- O que a 20260807a dizia: "SEM grant pra anon, de propósito: contribuição
-- exige conta". O que ela FAZIA: nada disso. No PostgreSQL, função nova nasce
-- com EXECUTE concedido a PUBLIC — então `grant execute ... to authenticated`
-- não restringe coisa alguma, só reafirma o que já estava aberto. Verificado
-- por curl depois de aplicar: chamada anônima de contribute_price devolveu
-- HTTP 204 (executou), não 404.
--
-- Gravidade real: BAIXA. O `if auth.uid() is null then return; end if;` dentro
-- da função impede a escrita, então nunca houve risco de dado sujo ou de
-- vazamento. O que sobrava era um anônimo conseguindo BATER na função e gastar
-- o orçamento do _rate_ok por IP. Mesmo assim, privilégio que a gente acha que
-- não deu é dívida: alguém remove a guarda um dia e a porta está aberta.
--
-- Lição pras próximas: `grant execute ... to <role>` NÃO é restrição. Pra
-- fechar uma função é preciso revogar de PUBLIC explicitamente.

revoke execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) from public;
revoke execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) from anon;
grant  execute on function public.contribute_price(text, text, text, text, text, text, text, numeric) to authenticated;

-- A de LEITURA continua aberta pros dois papéis de propósito: o agregado é
-- público (visitante sem conta vê o preço da comunidade no card) e ela já se
-- protege sozinha — só devolve bucket com n >= 3.
grant execute on function public.community_price_for(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Verificação — e o que ESPERAR de verdade em cada uma (a 20260807a errou a
-- expectativa em duas; ficam corrigidas aqui):
--
--   # 1) contribuição anônima: agora 404 (função não encontrada pro papel anon).
--   #    ANTES desta migração devolvia 204 — executava e caía na guarda.
--   curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--     "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/rpc/contribute_price" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL" -H "Content-Type: application/json" \
--     -d '{"p_game":"magic","p_card_id":"mtg-2x2-1","p_variant":"Normal","p_cond":"NM","p_kind":"listed","p_company":"","p_grade":"","p_value_brl":10}'
--
--   # 2) tabela crua: devolve 200 [] — e isso É o comportamento correto.
--   #    RLS ligada SEM policy não dá erro: filtra tudo, zero linhas. A
--   #    20260807a dizia "deve ser negado", o que confunde quem for conferir.
--   curl -s "https://dlnalopazitfdgnmdguu.supabase.co/rest/v1/community_prices?select=value_brl&limit=1" \
--     -H "apikey: sb_publishable_0Qlei5ZvRcEsr18QRdWfGg_N3aR1zyL"
--
--   # 3) agregado anônimo: 200 [] (sem contribuição ainda). Segue liberado.
-- ============================================================================
