// Módulo 5 da Etapa 4.5 (painel web): lógica PURA do front-end (sem DOM,
// sem fetch), extraída pra src/web/public/logic/*.js justamente pra dar
// pra testar em Node puro sem simular navegador. Cobre as duas peças mais
// arriscadas de a UI errar silenciosamente: conversão de unidade de banda
// e montagem do documento de automação a partir do estado do wizard.
import { parseBandwidth, formatBandwidth, formatBytes } from '../src/web/public/logic/optimization.js'
import { suggestAutomationId, emptyScopeBlocksSave, buildAutomationDocument, automationSummary, stateFromDocument } from '../src/web/public/logic/automation.js'

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

// --- suggestAutomationId ---
check('suggestAutomationId: espaços e acentos viram id kebab-case', suggestAutomationId('Consultar Climática Região') === 'consultar-climatica-regiao')
check('suggestAutomationId: símbolos somem', suggestAutomationId('Ping! /teste #1') === 'ping-teste-1')
check('suggestAutomationId: nome vazio vira string vazia (nunca lança)', suggestAutomationId('') === '')
check('suggestAutomationId: nome undefined nunca lança', suggestAutomationId(undefined) === '')

// --- emptyScopeBlocksSave (achado real do plano: include vazio nunca é "todos") ---
check('emptyScopeBlocksSave: array vazio bloqueia', emptyScopeBlocksSave([]) === true)
check('emptyScopeBlocksSave: undefined bloqueia', emptyScopeBlocksSave(undefined) === true)
check('emptyScopeBlocksSave: com 1 item não bloqueia', emptyScopeBlocksSave([{ kind: 'contact', id: 'x' }]) === false)

// --- buildAutomationDocument: estado do wizard -> documento v1 válido ---
const estadoWizard = {
  id: 'ping', name: 'Ping', enabled: true, command: '/ping', match: 'exact',
  scopeInclude: [{ kind: 'contact', id: '5511999@s.whatsapp.net', label: 'Fulano' }],
  poolId: 'pool-local', replyText: 'pong ({{latencyMs}}ms)'
}
const doc = buildAutomationDocument(estadoWizard)
check('buildAutomationDocument: schemaVersion 1', doc.schemaVersion === 1)
check('buildAutomationDocument: só trigger.command -> action.whatsapp.reply (linear)', doc.flow.nodes.map((n) => n.type).join(',') === 'trigger.command,action.whatsapp.reply')
check('buildAutomationDocument: edge liga os dois nós em "matched"', doc.flow.edges[0].from === 'gatilho-comando' && doc.flow.edges[0].to === 'resposta-whatsapp' && doc.flow.edges[0].on === 'matched')
check('buildAutomationDocument: scope.include só leva kind/id (não vaza "label" da UI pro documento)', JSON.stringify(doc.scope.include[0]) === JSON.stringify({ kind: 'contact', id: '5511999@s.whatsapp.net' }))
check('buildAutomationDocument: texto de resposta preserva o placeholder de latência', doc.flow.nodes[1].config.text === 'pong ({{latencyMs}}ms)')
check('buildAutomationDocument: scope vazio gera include: [] (nunca omite o campo)', Array.isArray(buildAutomationDocument({ ...estadoWizard, scopeInclude: [] }).scope.include))
check('buildAutomationDocument: sem menuLabel/menuDescription, nunca inclui "display" no documento', doc.display === undefined)
const docComMenu = buildAutomationDocument({ ...estadoWizard, menuLabel: '/ping', menuDescription: 'Testa a latência' })
check('buildAutomationDocument: com menuLabel/menuDescription preenchidos, gera "display" completo', docComMenu.display.menuLabel === '/ping' && docComMenu.display.menuDescription === 'Testa a latência')
const docSoLabel = buildAutomationDocument({ ...estadoWizard, menuLabel: '/ping' })
check('buildAutomationDocument: só menuLabel preenchido, "display" não leva menuDescription vazia', docSoLabel.display.menuLabel === '/ping' && !('menuDescription' in docSoLabel.display))

// --- automationSummary: resumo em linguagem humana pra etapa de revisão ---
const resumo = automationSummary(estadoWizard)
check('automationSummary: menciona o nome', resumo.some((linha) => linha.includes('Ping')))
check('automationSummary: menciona o comando', resumo.some((linha) => linha.includes('/ping')))
check('automationSummary: menciona os destinos autorizados', resumo.some((linha) => linha.includes('Fulano')))
const resumoSemEscopo = automationSummary({ ...estadoWizard, scopeInclude: [] })
check('automationSummary: escopo vazio avisa que o salvamento deve ficar bloqueado', resumoSemEscopo.some((linha) => linha.toLowerCase().includes('bloqueado')))
check('automationSummary: sem menuLabel, avisa que não vai aparecer no /menu', resumo.some((linha) => linha.includes('Não vai aparecer no comando /menu')))
const resumoComMenu = automationSummary({ ...estadoWizard, menuLabel: '/ping', menuDescription: 'Testa a latência' })
check('automationSummary: com menuLabel, menciona como vai aparecer no /menu', resumoComMenu.some((linha) => linha.includes('/menu') && linha.includes('Testa a latência')))

// --- stateFromDocument: caminho inverso, editar uma automação existente ---
const estadoRecuperado = stateFromDocument(doc, new Map([['5511999@s.whatsapp.net', 'Fulano']]))
check('stateFromDocument: recupera o comando do trigger', estadoRecuperado.command === '/ping')
check('stateFromDocument: recupera o texto de resposta', estadoRecuperado.replyText === 'pong ({{latencyMs}}ms)')
check('stateFromDocument: recupera o label do contato via mapa de nomes', estadoRecuperado.scopeInclude[0].label === 'Fulano')
check('stateFromDocument: documento vazio/malformado nunca lança, cai em defaults', JSON.stringify(stateFromDocument({}).scopeInclude) === '[]')
const estadoComMenu = stateFromDocument(docComMenu)
check('stateFromDocument: recupera menuLabel/menuDescription de "display"', estadoComMenu.menuLabel === '/ping' && estadoComMenu.menuDescription === 'Testa a latência')
check('stateFromDocument: sem "display" no documento, menuLabel/menuDescription vêm vazios (nunca undefined)', estadoRecuperado.menuLabel === '' && estadoRecuperado.menuDescription === '')

// --- ida e volta: documento -> estado -> documento é estável (idempotente) ---
const doc2 = buildAutomationDocument(stateFromDocument(doc))
check('ida e volta documento->estado->documento não perde informação', JSON.stringify(doc2) === JSON.stringify(doc))
const docComMenu2 = buildAutomationDocument(stateFromDocument(docComMenu))
check('ida e volta documento->estado->documento não perde "display" (menu)', JSON.stringify(docComMenu2) === JSON.stringify(docComMenu))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DA LÓGICA DO PAINEL PASSARAM')
process.exit(falhas ? 1 : 0)
