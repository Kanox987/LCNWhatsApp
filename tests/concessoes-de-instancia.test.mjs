// Frente E do pedido: a hierarquia administração → concessões da instância →
// preferências do usuário → limites efetivos, com a verdade no BACKEND.
//
// O pedido é explícito sobre o que NÃO fazer: "Não utilize simplesmente
// Math.min() em todas as configurações". Os quatro primeiros blocos abaixo são
// exatamente os campos onde Math.min dá a resposta errada — e o primeiro é
// onde ele dá a resposta PERIGOSA, elevando o limite em vez de baixar.
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  PARAMETROS, CAMPOS, resolverCampo, limitesEfetivos, valoresEfetivos,
  validarConcessao, validarPedido, explicar
} from '../src/agent/concessoes.js'
import { lerRegistro, salvarRegistro } from '../src/instances/registry.js'
import { PADRAO } from '../src/config.js'

let falhas = 0
const check = (nome, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
  if (!ok) console.log(`   exp=${JSON.stringify(exp)} got=${JSON.stringify(got)}`)
}
const checkBool = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }
const checkRecusa = (nome, fn, parte) => {
  try { fn(); falhas++; console.log(`❌ ${nome} (não recusou)`) } catch (erro) {
    const ok = String(erro.message).includes(parte)
    if (!ok) falhas++
    console.log(`${ok ? '✅' : '❌'} ${nome}`)
    if (!ok) console.log(`   esperava conter "${parte}", veio "${erro.message}"`)
  }
}

const DOWNLOAD = 'hardware.bandwidthLimit.downloadBytesPerSecond'
const SIMULTANEOS = 'hardware.comandosSimultaneos'
const QUARENTENA = 'confiabilidade.falhasConsecutivasParaQuarentena'
const NAVEGADOR = 'hardware.aparelho.navegador'
const ECONOMIA = 'hardware.modoEconomia'

// ── 1. zero é ILIMITADO: Math.min elevaria o teto ────────────────────────────
// Math.min(0, 1000000) === 0 === sem limite. Se a validação fosse Math.min,
// pedir zero seria a maneira mais fácil de furar a cota, passando por uma
// checagem que parece correta. É o caso que o pedido nomeia ao proibir
// Math.min em tudo.
const zeroContraTeto = resolverCampo(DOWNLOAD, 0, 1_000_000)
check('zero (ilimitado) contra teto concedido vira o TETO, não zero', zeroContraTeto.efetivo, 1_000_000)
check('e a origem do valor é dita', zeroContraTeto.origem, 'concessão do administrador')
checkBool('com motivo legível para a tela', /Sem limite não está liberado/.test(zeroContraTeto.motivo))
// Sem concessão nenhuma, zero continua querendo dizer ilimitado: padrão
// sensato sim, teto no código não.
check('sem concessão, zero continua ilimitado', resolverCampo(DOWNLOAD, 0, undefined).efetivo, 0)

// ── 2. mínimo obrigatório: o piso vence a preferência E a concessão ──────────
// Zero comandos simultâneos trancaria a fila inteira.
const abaixoDoPiso = resolverCampo(SIMULTANEOS, 0, 8)
check('abaixo do mínimo obrigatório sobe para o mínimo', abaixoDoPiso.efetivo, 1)
check('e a origem é o mínimo, não a concessão', abaixoDoPiso.origem, 'mínimo obrigatório')
// Concessão que o mínimo tornaria impossível é recusada na origem, em vez de
// aceita e desobedecida em silêncio pelo runtime.
checkRecusa('conceder abaixo do mínimo é recusado', () => validarConcessao({ [SIMULTANEOS]: 0 }), 'mínimo obrigatório')

// ── 3. campo não numérico: lista de opções, não grandeza ─────────────────────
const fora = resolverCampo(NAVEGADOR, 'safari', ['chrome', 'firefox'])
check('valor fora da lista concedida cai na primeira concedida', fora.efetivo, 'chrome')
checkBool('e a tela recebe as opções disponíveis', /não está liberado/.test(fora.motivo) && /chrome, firefox/.test(fora.motivo))
checkRecusa('conceder opção inexistente é recusado', () => validarConcessao({ [NAVEGADOR]: ['netscape'] }), 'não é uma opção')
check('valor dentro da lista passa intacto', resolverCampo(NAVEGADOR, 'firefox', ['chrome', 'firefox']).efetivo, 'firefox')

// ── 4. booleano travável ─────────────────────────────────────────────────────
check('sem trava, a preferência do cliente vale', resolverCampo(ECONOMIA, false, undefined).efetivo, false)
const travado = resolverCampo(ECONOMIA, false, true)
check('travado, a preferência do cliente é ignorada', travado.efetivo, true)
checkBool('e a tela diz que a administração fixou', /fixou/.test(travado.motivo))

// ── 5. fronteira ─────────────────────────────────────────────────────────────
check('exatamente no teto passa', resolverCampo(SIMULTANEOS, 8, 8).efetivo, 8)
check('no teto não há motivo de recusa a exibir', resolverCampo(SIMULTANEOS, 8, 8).motivo, null)
check('um acima do teto é cortado no teto', resolverCampo(SIMULTANEOS, 9, 8).efetivo, 8)
checkBool('e um acima tem motivo', Boolean(resolverCampo(SIMULTANEOS, 9, 8).motivo))
check('exatamente no piso passa', resolverCampo(SIMULTANEOS, 1, 8).efetivo, 1)
// Tolerar MAIS falhas é insistir numa conexão que está dando errado, e
// insistir é o que arrisca a conta. Baixar é sempre permitido; subir é o que
// precisa de concessão.
check('quarentena: pedir mais tolerância é cortado', resolverCampo(QUARENTENA, 100, 20).efetivo, 20)
check('quarentena: pedir menos tolerância é livre', resolverCampo(QUARENTENA, 5, 20).efetivo, 5)

// ── 6. REDUZIR a quota ───────────────────────────────────────────────────────
// Reduzir não reescreve o config.json do cliente: o valor configurado fica
// guardado e o efetivo é cortado na leitura. Assim, devolver a quota devolve a
// escolha dele sem reconfigurar nada — em troca, a tela TEM de mostrar os dois
// números, que é o que explicar() serve.
const configGrande = { hardware: { comandosSimultaneos: 16 } }
const apertado = limitesEfetivos(configGrande, { [SIMULTANEOS]: 4 })[SIMULTANEOS]
check('reduzir a quota preserva o que o cliente escolheu', apertado.configurado, 16)
check('e o que vale agora é a concessão', apertado.efetivo, 4)
check('devolver a quota restaura a escolha sem reconfigurar', limitesEfetivos(configGrande, { [SIMULTANEOS]: 32 })[SIMULTANEOS].efetivo, 16)

// ── 7. o cliente não eleva o próprio limite ──────────────────────────────────
// (a) por HTTP direto, sem passar pela tela: a gravação recusa COM MOTIVO.
// Gravar 64 e devolver 4 calado é o que faz a pessoa achar que a tela quebrou.
let codigo = null; let permitido = null
try { validarPedido(SIMULTANEOS, 64, { [SIMULTANEOS]: 4 }) } catch (erro) { codigo = erro.code; permitido = erro.permitido }
check('pedido acima da concessão é recusado com código próprio', codigo, 'LCN_ACIMA_DA_CONCESSAO')
check('e a recusa diz qual é o permitido', permitido, 4)
check('pedido dentro da concessão passa', validarPedido(SIMULTANEOS, 4, { [SIMULTANEOS]: 4 }), 4)
// (b) editando o config.json à mão, importando configuração ou trocando o
// arquivo: nada disso passa pela gravação, então a LEITURA também limita.
// Defesa em profundidade: as duas, não uma.
const adulterado = { hardware: { comandosSimultaneos: 9999, bandwidthLimit: { downloadBytesPerSecond: 0 } } }
const efetivoAdulterado = valoresEfetivos(adulterado, { [SIMULTANEOS]: 4, [DOWNLOAD]: 1_000_000 })
check('config adulterado à mão não eleva o número', efetivoAdulterado[SIMULTANEOS], 4)
check('nem pela via do zero-é-ilimitado', efetivoAdulterado[DOWNLOAD], 1_000_000)

// ── 8. concorrência ──────────────────────────────────────────────────────────
// A resolução é pura e lê a concessão a cada chamada, então não existe janela
// entre duas gravações simultâneas em que o teto não valha.
const simultaneos = await Promise.all(
  Array.from({ length: 200 }, () => Promise.resolve().then(() => valoresEfetivos(configGrande, { [SIMULTANEOS]: 3 })[SIMULTANEOS]))
)
check('200 leituras simultâneas dão todas o mesmo limite', [...new Set(simultaneos)], [3])

// ── 9. isolamento entre clientes e reinício ──────────────────────────────────
// A concessão mora no registro, FORA da pasta da instância, porque quem
// controla a instância reescreve o próprio config.json. Guardar o teto no
// mesmo arquivo que o valor seria guardar a chave dentro do cofre.
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), `lcn-concessoes-${process.pid}-`))
const arquivo = path.join(pasta, 'registry.json')
try {
  salvarRegistro({ version: 1, nextSeq: 1, instances: {}, grants: { 'wa-000001': { [SIMULTANEOS]: 2 }, bare: { [DOWNLOAD]: 500 } } }, arquivo)
  const registro = lerRegistro(arquivo)
  check('a concessão de uma instância é lida de volta', registro.grants['wa-000001'][SIMULTANEOS], 2)
  check('instância sem concessão não herda a da vizinha', registro.grants['wa-000002'], undefined)
  check('o teto de wa-000001 vale para wa-000001', valoresEfetivos(configGrande, registro.grants['wa-000001'])[SIMULTANEOS], 2)
  check('e wa-000002 fica com a própria preferência', valoresEfetivos(configGrande, registro.grants['wa-000002'] || {})[SIMULTANEOS], 16)
  // A instância do modo simples (`bare`) não tem entrada em `instances` e
  // também precisa de teto — é por isso que o mapa fica no TOPO do registro.
  check('a instância bare, que não está em instances, também tem teto', valoresEfetivos({}, registro.grants.bare)[DOWNLOAD], 500)
  // Reler é o que acontece a cada subida do painel. E reescrever é o risco
  // real: `validar` descarta chave que não conhece, então uma concessão
  // escondida numa chave desconhecida se perderia na primeira gravação.
  salvarRegistro(lerRegistro(arquivo), arquivo)
  check('a concessão sobrevive a um ciclo de leitura e gravação', lerRegistro(arquivo).grants['wa-000001'][SIMULTANEOS], 2)
} finally {
  fs.rmSync(pasta, { recursive: true, force: true })
}

// ── 10. mudança administrativa de plano ──────────────────────────────────────
check('retirar a concessão é pedido com null', validarConcessao({ [SIMULTANEOS]: null }), { [SIMULTANEOS]: null })
check('sem concessão, a preferência do cliente vale inteira', valoresEfetivos({ hardware: { comandosSimultaneos: 7 } }, {})[SIMULTANEOS], 7)

// ── 11. a tela tem de conseguir se explicar ──────────────────────────────────
// O pedido exige que a interface mostre o valor configurado, o limite
// permitido, o significado, o efeito e a razão de um valor estar indisponível
// — e que diga quando o limite é do PROVEDOR, não nosso.
const linhas = explicar(configGrande, { [SIMULTANEOS]: 4 })
const linha = linhas.find((l) => l.chave === SIMULTANEOS)
for (const campo of ['tipo', 'padrao', 'configurado', 'permitido', 'emVigor', 'fonteDoLimite', 'significado', 'efeito']) {
  checkBool(`explicar() entrega "${campo}"`, linha[campo] !== undefined)
}
checkBool('explicar() diz POR QUE o valor não está disponível', Boolean(linha.indisponivelPorque))
check('e marca quando o limite é do provedor', linhas.find((l) => l.chave === 'hardware.maxMidiaMB').limiteDoProvedor, true)
check('e quando não é', linha.limiteDoProvedor, false)
check('explicar() cobre todos os parâmetros, sem segunda lista', linhas.length, CAMPOS.length)

// A tela não pode AFIRMAR uma escolha que ninguém fez. `configurado` nunca vem
// vazio — o resolvedor precisa de um número para resolver, então ele põe o
// padrão ali. Quem distingue "o cliente escolheu 2" de "ninguém mexeu" é
// `foiEscolhido`, e sem ele a tela escreve "você escolheu" para todo mundo.
checkBool('explicar() diz que o valor configurado FOI escolhido', linha.foiEscolhido === true)
const intocado = linhas.find((l) => l.chave === 'hardware.cacheSqliteMB')
checkBool('e diz que o padrão NÃO foi escolhido', intocado.foiEscolhido === false)
check('mesmo trazendo o padrão no configurado', intocado.configurado, PARAMETROS['hardware.cacheSqliteMB'].padrao)

// E não pode avisar "precisa reiniciar" a quem não tem concessão nenhuma. O
// campo de LISTA devolve as opções liberadas em `permitido` mesmo sem
// concessão, então `permitido != null` diria sim para toda instância — a tela
// que grita lobo. `temConcessao` é por campo e vem das concessões, não da fonte.
const navegador = linhas.find((l) => l.chave === 'hardware.aparelho.navegador')
checkBool('campo de lista entrega as opções em permitido', Array.isArray(navegador.permitido))
checkBool('e ainda assim NÃO finge ter concessão', navegador.temConcessao === false)
checkBool('onde há concessão, temConcessao diz sim', linha.temConcessao === true)

// Concessão que não está cortando nada AGORA continua sendo concessão: o
// cliente pediu abaixo do teto, a fonte do limite é a preferência dele, e
// mudar o teto ainda exige reiniciar. Não dá para inferir de `fonteDoLimite`.
const folgado = explicar({}, { 'hardware.cacheSqliteMB': 8 }).find((l) => l.chave === 'hardware.cacheSqliteMB')
checkBool('concessão que não corta nada ainda é concessão', folgado.temConcessao === true)
check('e a fonte continua sendo a preferência do cliente', folgado.fonteDoLimite, 'preferência do cliente')

// ── 12. a tabela de parâmetros é a fonte única ───────────────────────────────
for (const chave of CAMPOS) {
  const spec = PARAMETROS[chave]
  const completo = ['rotulo', 'tipo', 'regra', 'significado', 'efeito'].every((c) => Boolean(spec[c])) && 'padrao' in spec
  checkBool(`${chave} declara rótulo, tipo, regra, padrão, significado e efeito`, completo)
}
// Guarda contra a divergência de camadas que este projeto já pagou caro (ver
// o escopo `local` no histórico do plano): se a tabela discordar de
// src/config.js, a tela explica um padrão que o runtime não usa.
const esperado = {
  [DOWNLOAD]: PADRAO.hardware.bandwidthLimit.downloadBytesPerSecond,
  'hardware.bandwidthLimit.uploadBytesPerSecond': PADRAO.hardware.bandwidthLimit.uploadBytesPerSecond,
  'hardware.maxMidiaMB': PADRAO.hardware.maxMidiaMB,
  'hardware.cacheSqliteMB': PADRAO.hardware.cacheSqliteMB,
  [ECONOMIA]: PADRAO.hardware.modoEconomia,
  [NAVEGADOR]: PADRAO.hardware.aparelho.navegador,
  [QUARENTENA]: PADRAO.confiabilidade.falhasConsecutivasParaQuarentena,
  'download.limiteMB': PADRAO.download.limiteMB
}
for (const [chave, valor] of Object.entries(esperado)) {
  check(`o padrão de ${chave} é o de src/config.js`, PARAMETROS[chave].padrao, valor)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CONCESSÕES DE INSTÂNCIA PASSARAM')
process.exit(falhas ? 1 : 0)
