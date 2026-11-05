// `resposta.json()` aloca o corpo inteiro antes de olhar o tamanho. A leitura
// limitada tem de abortar no primeiro byte além do limite — sem ler o resto —
// e continuar lendo normalmente o que cabe.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { lerJsonLimitado, LIMITE_JSON_PADRAO } from '../src/mediaBudget.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }

// Resposta de verdade (Web Streams), corpo em pedaços, contando o que foi puxado.
function resposta (pedacos, { cabecalhos = {} } = {}) {
  const estado = { puxados: 0, cancelado: false }
  let i = 0
  const body = new ReadableStream({
    pull (c) {
      if (i >= pedacos.length) return c.close()
      estado.puxados++
      c.enqueue(typeof pedacos[i] === 'string' ? new TextEncoder().encode(pedacos[i++]) : pedacos[i++])
    },
    cancel () { estado.cancelado = true }
  })
  return { r: new Response(body, { headers: cabecalhos }), estado }
}

{
  const { r } = resposta(['{"a":', '1,"b":"é"}'])
  const v = await lerJsonLimitado(r, 1024)
  check('JSON que cabe é lido, inclusive em vários pedaços e com acento', v.a === 1 && v.b === 'é')
}
{
  const { r } = resposta([JSON.stringify({ x: 'y'.repeat(100) })])
  const v = await lerJsonLimitado(r, JSON.stringify({ x: 'y'.repeat(100) }).length)
  check('exatamente no limite ainda passa', v.x.length === 100)
}
{
  const pedacos = Array.from({ length: 1000 }, () => 'x'.repeat(1024))
  const { r, estado } = resposta(pedacos)
  let erro
  try { await lerJsonLimitado(r, 4096) } catch (e) { erro = e }
  check('corpo que passa do limite é recusado com código próprio', erro?.code === 'LCN_JSON_GRANDE')
  check('a leitura parou cedo: não puxou o corpo inteiro', estado.puxados < 20)
  check('o fluxo foi cancelado (a conexão não fica presa)', estado.cancelado === true)
}
{
  const { r, estado } = resposta(['{}'], { cabecalhos: { 'content-length': String(10 * 1024 * 1024) } })
  let erro
  try { await lerJsonLimitado(r, 4096) } catch (e) { erro = e }
  check('Content-Length acima do limite é recusado sem ler o corpo', erro?.code === 'LCN_JSON_GRANDE' && estado.puxados === 0)
}
{
  const { r } = resposta(['isto não é json'])
  let erro
  try { await lerJsonLimitado(r, 1024) } catch (e) { erro = e }
  check('JSON inválido continua sendo erro (quem chama já trata)', erro instanceof SyntaxError)
}
{
  const dublê = { headers: new Headers(), json: async () => ({ ok: true }) }
  check('dublê sem fluxo legível cai no json() de sempre', (await lerJsonLimitado(dublê, 10)).ok === true)
}
{
  check('o padrão é folgado para resposta de controle e finito', LIMITE_JSON_PADRAO >= 1024 * 1024 && Number.isFinite(LIMITE_JSON_PADRAO))
  const { r } = resposta([JSON.stringify({ x: 'z'.repeat(5000) })])
  process.env.LCN_JSON_MAX_BYTES = '100000'
  const v = await lerJsonLimitado(r)
  delete process.env.LCN_JSON_MAX_BYTES
  check('o limite padrão é configurável por LCN_JSON_MAX_BYTES (não é teto fixo)', v.x.length === 5000)
  const { r: r2 } = resposta([JSON.stringify({ x: 'z'.repeat(5000) })])
  process.env.LCN_JSON_MAX_BYTES = '100'
  let erro
  try { await lerJsonLimitado(r2) } catch (e) { erro = e }
  delete process.env.LCN_JSON_MAX_BYTES
  check('e reduzir o ambiente recusa o que antes passava', erro?.code === 'LCN_JSON_GRANDE')
}

// A função só protege onde é chamada: quem lê resposta de serviço externo não
// pode voltar a `resposta.json()` direto.
for (const arquivo of ['../src/downloader.js', '../src/engine/conexaoExecutor.js']) {
  const fonte = fs.readFileSync(new URL(arquivo, import.meta.url), 'utf8')
  check(`${arquivo.split('/').pop()} não chama resposta.json() direto`, !/\bresposta\.json\(\)/.test(fonte) && fonte.includes('lerJsonLimitado(resposta)'))
}

console.log(`\n${checagens} CHECAGENS PASSARAM`)
process.exit(0)
