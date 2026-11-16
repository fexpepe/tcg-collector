// Logo de set que um espelho automático baixa (mirror-set-logos,
// mirror-ja-set-logos, mirror-fab-set-logos, mirror-swu-set-logos,
// sync-bulbapedia-zh --logos) entra no repositório JÁ no padrão dos logos
// (docs/LOGOS.md): WebP recortado na tinta, sem véu, no teto do tipo e no menor
// peso. É a mesma normalização do normaliza-logo.mjs e do caçador de logos.
//
// Até 2026-11-14 cada espelho gravava no formato dele (o da TCGdex do tamanho
// que viesse, de 160 a 2.500 px; o do Bulbagarden num thumb de 520 px, abaixo
// do que a vitrine do topo pede; o do FAB a 600 px pelo wsrv). O build completo
// commita o que eles trazem com [skip ci], então o check-logos do CI nunca via:
// a regra tem de estar no próprio espelho.
//
// O sharp fica fora do repositório (SHARP_DIR = pasta do pacote, como no
// caçador). No deploy ele é instalado uma vez, antes dos espelhos. Sem ele o
// espelho NÃO grava logo novo (fica o que já existe, e o set sem arquivo mostra
// o nome): gravar a fonte crua seria pôr de volta um arquivo fora do padrão.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { normaliza } from "./logo-padrao.mjs";

let carregando = null;
export function sharpDoAmbiente() {
  if (!carregando) {
    carregando = (async () => {
      const dir = process.env.SHARP_DIR;
      if (!dir) return null;
      try {
        return (await import(pathToFileURL(join(dir, "lib", "index.js")).href)).default;
      } catch (e) {
        console.warn(`  sharp não carregou de ${dir} (${e.message}): logos novos não serão gravados.`);
        return null;
      }
    })();
  }
  return carregando;
}

// Bytes da fonte (PNG/WebP/SVG com fundo transparente) -> WebP no padrão do
// tipo ("set" ou "simbolo"). null sem sharp. Fonte sem alfa ou vazia lança
// (quem chama conta como falha e segue).
export async function logoNoPadrao(buf, tipo = "set") {
  const sharp = await sharpDoAmbiente();
  if (!sharp) return null;
  return (await normaliza(sharp, buf, { tipo })).buf;
}
