// Módulo 5 da Etapa 4.5 (painel web): lógica PURA do front-end (sem DOM,
// sem fetch), extraída pra src/web/public/logic/*.js justamente pra dar
// pra testar em Node puro sem simular navegador. Cobre as duas peças mais
// arriscadas de a UI errar silenciosamente: conversão de unidade de banda
// e montagem do documento de automação a partir do estado do wizard.
import { parseBandwidth, formatBandwidth, formatBytes } from '../src/web/public/logic/optimization.js'
import { converterParaTipo, descreverValor, tipoDoValor, valorParaCampo } from '../src/web/public/logic/valores.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

// --- parseBandwidth ---
check('parseBandwidth: "500 KB/s" vira 500000', parseBandwidth('500 KB/s') === 500000)
check('parseBandwidth: "1 MB/s" vira 1000000', parseBandwidth('1 MB/s') === 1000000)
check('parseBandwidth: "1 MiB/s" vira 1048576 (binário, não decimal)', parseBandwidth('1 MiB/s') === 1048576)
check('parseBandwidth: aceita vírgula decimal ("1,5 MB/s")', parseBandwidth('1,5 MB/s') === 1500000)
check('parseBandwidth: case-insensitive ("500kb/s")', parseBandwidth('500kb/s') === 500000)
check('parseBandwidth: "sem limite" vira 0', parseBandwidth('sem limite') === 0)
check('parseBandwidth: "ilimitado" vira 0', parseBandwidth('ilimitado') === 0)
check('parseBandwidth: número puro passa direto', parseBandwidth(500000) === 500000)

let lancouTextoInvalido = false
try { parseBandwidth('quinhentos KB/s') } catch { lancouTextoInvalido = true }
check('parseBandwidth: texto sem número reconhecível lança erro claro', lancouTextoInvalido)

let lancouNumeroNegativo = false
try { parseBandwidth(-5) } catch { lancouNumeroNegativo = true }
check('parseBandwidth: número negativo lança erro', lancouNumeroNegativo)

let lancouUnidadeDesconhecida = false
try { parseBandwidth('500 XB/s') } catch { lancouUnidadeDesconhecida = true }
check('parseBandwidth: unidade desconhecida lança erro', lancouUnidadeDesconhecida)

// --- formatBandwidth (inverso de parseBandwidth, pra exibição) ---
check('formatBandwidth: 0 vira "sem limite"', formatBandwidth(0) === 'sem limite')
check('formatBandwidth: 500000 vira "500 KB/s"', formatBandwidth(500000) === '500 KB/s')
check('formatBandwidth: 1048576 vira "1 MiB/s" (prefere binário exato)', formatBandwidth(1048576) === '1 MiB/s')
check('formatBandwidth: valor sem unidade exata cai pra B/s', formatBandwidth(1234) === '1234 B/s')

// --- formatBytes (total acumulado, painel de recursos — Módulo 6 da Parte C) ---
check('formatBytes: valores pequenos ficam em B', formatBytes(512) === '512 B')
check('formatBytes: KB com 1 casa decimal', formatBytes(1536) === '1.5 KB')
check('formatBytes: MB com 1 casa decimal', formatBytes(5_500_000) === '5.5 MB')
check('formatBytes: GB com 1 casa decimal', formatBytes(2_000_000_000) === '2.0 GB')
check('formatBytes: zero é um total válido, não "sem limite"', formatBytes(0) === '0 B')
check('formatBytes: negativo/NaN nunca lança, cai num traço', formatBytes(-5) === '—' && formatBytes(NaN) === '—')

// O que existia aqui exercitava o assistente de seis passos, removido junto
// com ele: `suggestAutomationId`, `emptyScopeBlocksSave`,
// `buildAutomationDocument`, `automationSummary`, `stateFromDocument` e
// `analisarForma`.
//
// Aqueles casos guardavam uma decisão que deixou de existir: "esta automação
// cabe na forma que o assistente monta?". Como ele montava DOIS nós, a resposta
// era não para todas as automações reais, e a tela abria um resumo no lugar da
// regra. Agora criar e editar são a mesma coisa — o texto .lcn — e o contrato
// que importa é outro: `tests/lcn-ida-e-volta.test.mjs` prova que toda ação que
// o motor executa tem palavra na linguagem, nos dois sentidos, e que cada
// template do catálogo vira texto e volta IGUAL.
//
// Manter aqueles testes verdes sobre código que ninguém chama seria pior que
// não tê-los: passa a impressão de cobertura onde não há mais nada coberto.

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DA LÓGICA DO PAINEL PASSARAM')
process.exit(falhas ? 1 : 0)
