// Módulo 5 da Etapa 4.5 (painel web): lógica PURA do front-end (sem DOM,
// sem fetch), extraída pra src/web/public/logic/*.js justamente pra dar
// pra testar em Node puro sem simular navegador. Cobre as duas peças mais
// arriscadas de a UI errar silenciosamente: conversão de unidade de banda
// e montagem do documento de automação a partir do estado do wizard.
import { parseBandwidth, formatBandwidth, formatBytes } from '../src/web/public/logic/optimization.js'
import { converterParaTipo, descreverValor, tipoDoValor, valorParaCampo } from '../src/web/public/logic/valores.js'
import { juntar, realcar, realcarLinha } from '../src/web/public/logic/realce.js'
import { inserirTrecho, recuoDaLinha } from '../src/web/public/logic/trechos.js'
import { montarReferencia } from '../src/lcn/referencia.js'
import * as glossario from '../src/web/public/logic/acoes.js'
import fs from 'node:fs'

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

// --- realce da linguagem -------------------------------------------------
//
// A REGRA DURA, e o único caso que realmente importa aqui: o realce não altera
// o texto. Ele devolve os mesmos caracteres, na mesma ordem, repartidos. Um
// realce que come um espaço corromperia o que a pessoa escreveu, e
// corromperia CALADO — quem digita olha a cor, não o conteúdo.
//
// A prova é feita sobre os 42 arquivos do catálogo, que é todo o corpus de
// .lcn que existe: tudo que a linguagem aceita hoje passa por aqui.
const palavras = montarReferencia({ prosa: glossario }).palavras
const pastaDoCatalogo = new URL('../src/engine/templates/catalog/', import.meta.url)
const arquivosDoCatalogo = fs.readdirSync(pastaDoCatalogo).filter((n) => n.endsWith('.lcn'))

let corrompidos = 0
for (const nome of arquivosDoCatalogo) {
  const texto = fs.readFileSync(new URL(nome, pastaDoCatalogo), 'utf8')
  if (juntar(realcar(texto, palavras)) !== texto) { corrompidos++; console.log(`   ↳ ${nome}`) }
}
check(`realce: devolve o texto intacto nos ${arquivosDoCatalogo.length} arquivos do catálogo`, corrompidos === 0)
check('realce: o catálogo tem arquivo de verdade para conferir', arquivosDoCatalogo.length >= 40)

// Contagem de linhas igual à do campo de texto: é dela que sai a barra de
// números, e uma linha a mais ou a menos desalinha a barra inteira.
const comLinhasVazias = 'automação x\n\n  responde "oi"\n'
check('realce: conta as linhas igual ao texto', realcar(comLinhasVazias, palavras).length === comLinhasVazias.split('\n').length)
check('realce: texto vazio continua uma linha', realcar('', palavras).length === 1)

const classesDe = (linha) => realcarLinha(linha, palavras).filter((p) => p.c).map((p) => `${p.c}:${p.t}`)
check('realce: bloco de abertura acende', classesDe('automação x').includes('lcn-bloco:automação'))
check('realce: campo do cabeçalho acende', classesDe('  tipo: comando').includes('lcn-campo:tipo'))
check('realce: valor de enum acende', classesDe('  tipo: comando').includes('lcn-valor:comando'))
check('realce: ação acende', classesDe('  responde "oi"').includes('lcn-acao:responde'))
check('realce: marcador de interpolação acende', classesDe('  pool: {{params.poolId}}').includes('lcn-marcador:{{params.poolId}}'))
check('realce: comentário acende inteiro', classesDe('# nós: a, b').includes('lcn-comentario:# nós: a, b'))
check('realce: palavra de arquivo acende', classesDe('      arquivo: a mídia').includes('lcn-arquivo:a mídia'))
check('realce: a mais longa ganha ("a mídia citada")', classesDe('      foto: a mídia citada').includes('lcn-arquivo:a mídia citada'))

// "responde rico" tem de ganhar de "responde", igual ao compilador — senão a
// linha acende como a ação errada, sem erro nenhum.
check('realce: "responde rico" ganha de "responde"', classesDe('  responde rico "x"').includes('lcn-acao:responde rico'))

// Chave que a linguagem NÃO conhece fica sem cor, e essa ausência é
// informação: é o primeiro sinal de que a linha vai ser recusada.
check('realce: campo desconhecido não acende', !classesDe('  nomee: Oi').some((c) => c.startsWith('lcn-campo')))

// `com` só vale abrindo linha. No meio de um texto livre é palavra da pessoa.
check('realce: "com" no meio de texto livre não acende', !classesDe('  menu: /x — baixa com legenda').some((c) => c.includes('com')))
check('realce: "com" abrindo linha acende', classesDe('    com').includes('lcn-estrutura:com'))
check('realce: "var" dentro do se acende', classesDe('  se var member avisos >= 3').includes('lcn-estrutura:var'))
check('realce: operador acende', classesDe('  se var member avisos >= 3').includes('lcn-operador:>='))
check('realce: número acende', classesDe('  se var member avisos >= 3').includes('lcn-numero:3'))
check('realce: o "2" de "mp3" não acende como número', !classesDe('    audio_ext: mp3').some((c) => c.startsWith('lcn-numero')))

// Aspas sem par acendem igual: quem está escrevendo ainda não fechou, e apagar
// a cor no meio da digitação pisca a tela a cada tecla.
check('realce: aspas sem par ainda acendem', classesDe('  responde "metade').some((c) => c.startsWith('lcn-texto')))

// Sem palavras (servidor fora), nada acende e nada se perde.
check('realce: sem palavras não acende nada', realcarLinha('automação x', {}).every((p) => !p.c))
check('realce: sem palavras o texto continua inteiro', juntar(realcar('automação x\n  responde "oi"', {})) === 'automação x\n  responde "oi"')

// --- inserir trecho ------------------------------------------------------
check('recuo: linha na margem não tem recuo', recuoDaLinha('automação x', 0) === '')
check('recuo: pega o recuo da linha do cursor', recuoDaLinha('se x\n    responde "oi"', 10) === '    ')

// O trecho entra com o recuo DA LINHA do cursor: inserir uma ação dentro de um
// ramo do `se` tem de manter o nível do ramo, não voltar para a margem.
const dentroDoRamo = inserirTrecho('automação x\n  se a == b\n    responde "oi"\n', 30, 'apaga mensagem')
check('inserir: respeita o recuo da linha', dentroDoRamo.texto.includes('\n    apaga mensagem\n'))
check('inserir: não apaga a linha que estava ali', dentroDoRamo.texto.includes('    responde "oi"'))
check('inserir: deixa o cursor no fim do que inseriu', dentroDoRamo.texto[dentroDoRamo.posicao] === '\n')

const multilinha = inserirTrecho('automação x\n  responde "oi"\n', 16, 'se a == b\n  apaga mensagem')
check('inserir: recua todas as linhas do trecho', multilinha.texto.includes('\n  se a == b\n    apaga mensagem\n'))

// Linha vazia fica VAZIA, sem o recuo: espaço solto no fim da linha é sujeira
// que a próxima leitura do texto mostra como diferença — e a ida e volta da
// linguagem passaria a acusar mudança onde ninguém mudou nada.
const comVazia = inserirTrecho('  x\n', 2, 'primeira\n\nsegunda')
check('inserir: linha vazia não leva recuo', !/ +\n/.test(comVazia.texto.split('segunda')[0].replace('  primeira', 'primeira')))
check('inserir: em texto vazio funciona', inserirTrecho('', 0, 'automação x').texto === 'automação x\n')
check('inserir: posição além do fim não quebra', inserirTrecho('abc', 999, 'x').texto === 'x\nabc')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DA LÓGICA DO PAINEL PASSARAM')
process.exit(falhas ? 1 : 0)
