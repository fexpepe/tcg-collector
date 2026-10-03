// Câmbio do dia como RESERVA do app: data/fx.generated.json, { t, d, r: { USD,
// EUR }, fonte } — quantos reais vale 1 dólar e 1 euro.
//
// POR QUE (2026-10-03, docs/PLANO-TECNICO.md S2): o navegador busca o câmbio
// direto na AwesomeAPI, sem chave. Em 02/10 ela respondeu 429 QuotaExceeded,
// sem CORS — e quem não tinha câmbio guardado (todo visitante novo da
// campanha) via a carta SEM a cotação de Cardmarket e TCGplayer: sem câmbio, o
// convertMoney devolve null e a seção some. Se a cota sem chave contar por IP,
// como é o comum, o celular é o mais exposto: a operadora põe muita gente atrás
// do mesmo IP. Este arquivo é da
// mesma origem: sem cota, sem CORS, no cache do SW; o shared.js cai nele
// quando a API falha.
//
// Fontes, na ordem (a primeira que responder com número são vence):
//   1. AwesomeAPI COM chave, se o secret AWESOMEAPI_KEY existir (a mesma
//      cotação "bid" que o navegador usa; 100 mil pedidos/mês grátis);
//   2. Banco Central (PTAX, olinda.bcb.gov.br): o último boletim dos últimos
//      7 dias, compra — oficial, sem chave;
//   3. Frankfurter (BCE, api.frankfurter.dev): referência diária, sem chave;
//   4. o arquivo que já está em produção, se tiver até 10 dias — rede fora no
//      build não pode apagar a reserva.
// Nenhuma deu: não escreve nada e o build segue (o app volta ao de antes).
//
// Uso: node scripts/build-fx.mjs   (roda em todo deploy, ver deploy.yml)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const SAIDA = join(RAIZ, "data", "fx.generated.json");

// Faixa de sanidade: um número fora dela é API quebrada, não o câmbio.
export function cotacaoSa(r) {
  return !!r && r.USD >= 2 && r.USD <= 20 && r.EUR >= 2 && r.EUR <= 25;
}

export function daAwesome(json) {
  const r = { USD: Number(json && json.USDBRL && json.USDBRL.bid), EUR: Number(json && json.EURBRL && json.EURBRL.bid) };
  return cotacaoSa(r) ? r : null;
}

// PTAX: a lista de boletins do período; vale o mais recente (Fechamento ou
// Intermediário), pela data-hora.
export function daPtax(usd, eur) {
  const ultimo = (j) => ((j && j.value) || []).slice().sort((a, b) => String(a.dataHoraCotacao).localeCompare(String(b.dataHoraCotacao))).pop();
  const u = ultimo(usd), e = ultimo(eur);
  const r = { USD: Number(u && u.cotacaoCompra), EUR: Number(e && e.cotacaoCompra) };
  return cotacaoSa(r) ? { r, d: String(u.dataHoraCotacao).slice(0, 10) } : null;
}

// Frankfurter com base USD: BRL direto; EUR→BRL = BRL por dólar ÷ EUR por dólar.
export function daFrankfurter(json) {
  const brl = Number(json && json.rates && json.rates.BRL), eur = Number(json && json.rates && json.rates.EUR);
  const r = { USD: brl, EUR: eur > 0 ? Math.round((brl / eur) * 10000) / 10000 : NaN };
  return cotacaoSa(r) ? { r, d: String(json.date || "").slice(0, 10) } : null;
}

async function pega(url, opts) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(15000) }, opts));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const mmddyyyy = (d) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;

async function principal() {
  const hoje = new Date();
  const tentativas = [];
  if (process.env.AWESOMEAPI_KEY) {
    tentativas.push(["awesomeapi", async () => {
      const r = daAwesome(await pega("https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL", { headers: { "x-api-key": process.env.AWESOMEAPI_KEY } }));
      return r ? { r, d: hoje.toISOString().slice(0, 10) } : null;
    }]);
  }
  tentativas.push(["bcb-ptax", async () => {
    const ini = mmddyyyy(new Date(hoje.getTime() - 7 * 86400000)), fim = mmddyyyy(hoje);
    const url = (moeda) => "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
      + `?@moeda='${moeda}'&@dataInicial='${ini}'&@dataFinalCotacao='${fim}'&$format=json&$top=200`;
    return daPtax(await pega(url("USD")), await pega(url("EUR")));
  }]);
  tentativas.push(["frankfurter", async () => daFrankfurter(await pega("https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR"))]);
  tentativas.push(["producao", async () => {
    const j = await pega("https://sleevu.app/data/fx.generated.json");
    if (!j || !cotacaoSa(j.r) || !(Date.now() - Number(j.t) < 10 * 86400000)) return null;
    return { r: j.r, d: j.d, t: Number(j.t), fonte: `producao (${j.fonte})` };
  }]);

  for (const [fonte, tenta] of tentativas) {
    try {
      const x = await tenta();
      if (!x) { console.log(`build-fx: ${fonte} sem número são`); continue; }
      const saida = { t: x.t || Date.now(), d: x.d || hoje.toISOString().slice(0, 10), r: { USD: x.r.USD, EUR: x.r.EUR }, fonte: x.fonte || fonte };
      mkdirSync(dirname(SAIDA), { recursive: true });
      writeFileSync(SAIDA, JSON.stringify(saida) + "\n");
      console.log(`build-fx: 1 USD = R$ ${saida.r.USD} · 1 EUR = R$ ${saida.r.EUR} (${saida.fonte}, ${saida.d})`);
      return;
    } catch (e) {
      console.log(`build-fx: ${fonte} falhou (${e.message})`);
    }
  }
  console.log("::warning title=Câmbio::nenhuma fonte de câmbio respondeu; o app fica sem a reserva neste deploy");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
