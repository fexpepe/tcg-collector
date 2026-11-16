// O robots.txt do img.sleevu.app (o espelho das imagens de carta no R2) e a
// lista dos robôs de TREINO de IA, que o robots.txt do sleevu.app repete.
//
// Decisão de 16/11/2026: o texto do site fica aberto pra busca e pra IA,
// inclusive treino (o Sleevu quer ser conhecido pelos modelos), mas as imagens
// das cartas, não. Elas são das editoras, dos artistas e das fontes de onde
// vêm; o Sleevu as guarda pra mostrar nas próprias páginas e parte delas não
// pode licenciar a ninguém. Buscador segue indexando a imagem (a busca de
// imagem leva à página da carta), e os Termos proíbem raspar e republicar.
//
// O bucket não tem outro jeito de servir um robots.txt: o objeto `robots.txt`
// na raiz é o que o img.sleevu.app/robots.txt devolve. Quem grava é o job do
// espelho (scripts/mirror-r2.mjs), no começo de toda rodada, e só quando o
// texto mudou. Enquanto o "robots.txt gerenciado" da Cloudflare estiver ligado
// na zona, é o dele que sai, nos dois endereços.

// Os robôs que coletam pra TREINAR modelo (não os de busca nem os que buscam
// na hora pra responder: OAI-SearchBot, ChatGPT-User, Claude-SearchBot,
// Claude-User e PerplexityBot seguem no grupo `*`). Os "-Extended" do Google e
// da Apple não rastreiam: são o nome que os dois leem pra decidir o uso em
// treino do que o robô de busca deles já pegou.
export const ROBOS_DE_TREINO = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "Amazonbot",
  "Bytespider",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "AI2Bot",
  "PanguBot",
  "Timpibot",
  "omgili"
];

export function robotsDoEspelho() {
  return [
    "# img.sleevu.app: o espelho das imagens de carta do Sleevu (https://sleevu.app).",
    "#",
    "# As imagens são das editoras, dos artistas e das fontes de onde vêm. O Sleevu",
    "# as guarda pra mostrar nas próprias páginas e não pode licenciá-las a ninguém.",
    "# Buscador pode indexar (a busca de imagem leva à página da carta no Sleevu);",
    "# treino de IA, uso em resposta de IA e republicação, não.",
    "# Termos: https://sleevu.app/terms#uso-do-catalogo.",
    "#",
    "# Card images belong to their publishers, artists and sources. Search engines",
    "# may index them; AI training, AI answers and republishing are not allowed.",
    "",
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=no, ai-train=no",
    "Allow: /",
    "# O índice interno do espelho.",
    "Disallow: /_index/",
    "",
    ...ROBOS_DE_TREINO.map((r) => `User-agent: ${r}`),
    "Content-Signal: search=yes, ai-input=no, ai-train=no",
    "Disallow: /",
    ""
  ].join("\n");
}

// Grava o robots.txt no bucket se o que está lá for outro. Devolve "igual" ou
// "gravado"; erro de gravação sobe (o job registra e segue, ver mirror-r2).
export async function publicaRobotsDoEspelho(r2) {
  const texto = robotsDoEspelho();
  const atual = await r2.get("robots.txt");
  if (atual.ok && (await atual.text()) === texto) return "igual";
  const r = await r2.put("robots.txt", texto, { contentType: "text/plain; charset=utf-8", cacheControl: "public, max-age=3600" });
  if (!r.ok) throw new Error(`gravar robots.txt: HTTP ${r.status}`);
  return "gravado";
}
