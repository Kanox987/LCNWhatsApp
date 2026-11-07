// Concessões da instância — a camada que faltava entre "o administrador
// decide" e "o cliente configura".
//
// A hierarquia, do mais forte para o mais fraco:
//
//   1. o PADRÃO do código      (src/config.js, PADRAO)
//   2. a CONCESSÃO do administrador  (registry.json, fora da pasta da instância)
//   3. a PREFERÊNCIA do cliente      (config.json, DENTRO da pasta da instância)
//   4. o LIMITE EFETIVO             — o que o runtime obedece
//
// Por que a concessão mora no registro e não no config.json: o `config.json`
// fica dentro da pasta da instância, então quem controla a instância pode
// reescrevê-lo. Guardar o teto no mesmo arquivo que o valor seria guardar a
// chave dentro do cofre. O registro (`~/.local/share/lcnwhatsapp/registry.json`,
// src/instances/registry.js) é do administrador e não é servido pelo painel da
// instância.
//
// E o limite é aplicado na LEITURA, não só na gravação. Gravação validada
// protege de quem usa a tela; validar na leitura protege também de quem
// editou o JSON à mão, importou configuração ou chamou a rota direto. Defesa
// em profundidade: as duas, não uma.
//
// NÃO É `Math.min()` EM TUDO. Quatro regras diferentes, porque quatro classes
// de parâmetro diferentes:
//
//   - `teto`            — número que o cliente pode baixar, nunca subir.
//   - `teto com piso`   — idem, mas existe mínimo obrigatório: zero ou menos
//                         trancaria a fila inteira, então o piso vence.
//   - `teto onde zero é ilimitado` — a ARMADILHA. Em `bandwidthLimit`, 0
//                         significa "sem limite". `Math.min(0, teto)` dá 0,
//                         ou seja: pedir zero ELEVARIA o limite para
//                         infinito, passando pela validação. Aqui o zero do
//                         cliente é trocado pelo teto concedido.
//   - `lista`           — campo não numérico (o aparelho anunciado ao
//                         WhatsApp). Não há "menor que": ou o valor está na
//                         lista concedida, ou é recusado.
//   - `travável`        — booleano que o administrador pode fixar. Travado,
//                         a preferência do cliente é ignorada.
//
// Reduzir uma cota NÃO reescreve o config.json do cliente. O valor
// configurado fica guardado e o efetivo é limitado na leitura, então quando o
// administrador devolve a cota o cliente recupera o que tinha escolhido, sem
// precisar reconfigurar. Em troca, a tela tem de mostrar os dois números —
// é o que `explicar()` serve.
import { APARELHOS } from '../aparelho.js'
import { MAX_PENDENTES_PADRAO } from '../engine/fila.js'

const NAVEGADORES = APARELHOS.map((a) => a.id)

// Esta tabela é a fonte única: o runtime obedece a ela, a tela se explica por
// ela e docs/engineering/lcn-v2/INSTANCE_LIMITS.md é gerado dela. Uma segunda
// lista em outro arquivo seria a divergência de camadas que este projeto já
// pagou caro (ver o escopo `local` no histórico do plano).
export const PARAMETROS = {
  'hardware.bandwidthLimit.downloadBytesPerSecond': {
    rotulo: 'Banda de download',
    tipo: 'inteiro, bytes por segundo',
    padrao: 0,
    regra: 'teto onde zero é ilimitado',
    minimo: 0,
    significado: 'Quanto a instância pode baixar por segundo. 0 = sem limite.',
    unidade: 'B/s',
    efeito: 'Download mais lento, memória e rede mais previsíveis.',
    enforcement: { onde: 'src/bandwidth.js, pelo valor efetivo que obterOtimizacao devolve', concessaoChega: true }
  },
  'hardware.bandwidthLimit.uploadBytesPerSecond': {
    rotulo: 'Banda de upload',
    tipo: 'inteiro, bytes por segundo',
    padrao: 0,
    regra: 'teto onde zero é ilimitado',
    minimo: 0,
    significado: 'Quanto a instância pode enviar por segundo. 0 = sem limite.',
    unidade: 'B/s',
    efeito: 'Envio mais lento, socket menos sujeito a engasgo.',
    enforcement: { onde: 'src/bandwidth.js, pelo valor efetivo que obterOtimizacao devolve', concessaoChega: true }
  },
  'hardware.comandosSimultaneos': {
    rotulo: 'Comandos ao mesmo tempo',
    tipo: 'inteiro',
    padrao: 2,
    regra: 'teto com piso',
    minimo: 1,
    significado: 'Quantos comandos a instância executa em paralelo.',
    efeito: 'Mais alto responde mais rápido em rajada e aperta o socket.',
    enforcement: { onde: 'src/engine/filasDeRecursos.js (fila socket)', concessaoChega: true }
  },
  'hardware.maxMidiaMB': {
    rotulo: 'Tamanho máximo de mídia',
    tipo: 'inteiro, MB',
    padrao: 60,
    regra: 'teto com piso',
    minimo: 1,
    significado: 'Maior arquivo que a instância aceita processar.',
    efeito: 'Acima disso a mídia é recusada antes de ocupar memória.',
    enforcement: { onde: 'src/mediaLimits.js (limitesDeMidia), pelo teto que chega no ambiente LCN_CONCESSOES', concessaoChega: true }
  },
  'hardware.cacheSqliteMB': {
    rotulo: 'Cache do banco',
    tipo: 'inteiro, MB',
    padrao: 4,
    regra: 'teto com piso',
    minimo: 1,
    significado: 'Páginas de banco que cada conexão mantém em memória.',
    efeito: 'Mais alto consulta mais rápido e custa RAM por processo.',
    enforcement: { onde: 'src/engine/server/db.js (abrirBanco), pelo teto que chega no ambiente LCN_CONCESSOES', concessaoChega: true }
  },
  'hardware.maxPendentes': {
    rotulo: 'Fila de ação',
    tipo: 'inteiro',
    padrao: MAX_PENDENTES_PADRAO,
    regra: 'teto com piso',
    minimo: 0,
    significado: 'Quantas ações podem esperar vaga em cada fila (socket, rede, CPU, admissão) antes de a nova ser recusada. Aqui 0 não é ilimitado: é nenhuma espera, recusa quando não há vaga.',
    efeito: 'Mais alto aguenta rajada maior e segura mais memória; acima do limite a ação é recusada em vez de acumular.',
    enforcement: { onde: 'src/engine/fila.js, pelo valor efetivo que filasDeRecursos.js e connection.js passam', concessaoChega: true }
  },
  'limites.maxConexoes': {
    rotulo: 'Conexões externas',
    tipo: 'inteiro',
    padrao: 0,
    regra: 'teto onde zero é ilimitado',
    minimo: 0,
    unidade: 'conexões',
    significado: 'Quantas conexões externas a instância mantém cadastradas, contando as que já vêm prontas. 0 = sem limite.',
    efeito: 'Acima do limite o cadastro de uma nova conexão é recusado; as existentes continuam funcionando.',
    enforcement: { onde: 'src/engine/server/routes/connections.js (POST /connections)', concessaoChega: true }
  },
  'limites.maxAutomacoes': {
    rotulo: 'Automações',
    tipo: 'inteiro',
    padrao: 0,
    regra: 'teto onde zero é ilimitado',
    minimo: 0,
    unidade: 'automações',
    significado: 'Quantas automações a instância mantém cadastradas, de qualquer origem (editor, modelo ou perfil). 0 = sem limite.',
    efeito: 'Acima do limite criar outra é recusado; as existentes continuam funcionando e podem ser editadas ou apagadas.',
    enforcement: { onde: 'src/engine/server/automationsService.js (criar), caminho único de toda automação nova', concessaoChega: true }
  },
  'hardware.modoEconomia': {
    rotulo: 'Modo economia',
    tipo: 'booleano',
    padrao: true,
    regra: 'travável',
    significado: 'Reduz trabalho de fundo e verbosidade.',
    efeito: 'Travado pelo administrador, o cliente não desliga.',
    enforcement: { onde: 'lido de config.json por quem consome modoEconomia', concessaoChega: true }
  },
  'hardware.aparelho.navegador': {
    rotulo: 'Aparelho anunciado',
    tipo: 'opção',
    padrao: 'chrome',
    regra: 'lista',
    opcoes: NAVEGADORES,
    significado: 'Como a instância se apresenta ao WhatsApp.',
    efeito: 'Aparece na lista de aparelhos conectados do celular.',
    enforcement: { onde: 'src/aparelho.js:resolverAparelho, que recusa valor fora da lista fechada', concessaoChega: true }
  },
  'confiabilidade.falhasConsecutivasParaQuarentena': {
    rotulo: 'Falhas até a quarentena',
    tipo: 'inteiro',
    padrao: 15,
    regra: 'teto com piso',
    minimo: 1,
    significado: 'Quantas falhas seguidas antes de a instância ser posta de lado.',
    // Por que é TETO e não piso: tolerar mais falhas é insistir mais numa
    // conexão que está dando errado, e insistir é o que arrisca a conta.
    // Baixar é sempre permitido; subir é o que precisa de concessão.
    efeito: 'Mais alto insiste mais antes de desistir.',
    enforcement: { onde: 'src/state.js, pelo valor efetivo que obterOtimizacao devolve', concessaoChega: true }
  },
  'download.limiteMB': {
    rotulo: 'Limite de download',
    tipo: 'inteiro, MB',
    padrao: 64,
    regra: 'teto com piso',
    minimo: 1,
    significado: 'Maior arquivo que o serviço de download entrega.',
    efeito: 'Acima disso o download é recusado na origem.',
    enforcement: { onde: 'src/mediaLimits.js (limitesDeMidia), cortado também pelo teto geral de mídia', concessaoChega: true }
  }
}

export const CAMPOS = Object.keys(PARAMETROS)

function pegar (objeto, chave) {
  return chave.split('.').reduce((atual, parte) => (atual == null ? undefined : atual[parte]), objeto)
}

// Resolve UM campo. Devolve sempre os quatro números da hierarquia, porque a
// tela precisa deles para dizer por que um valor não está disponível — e
// "não está disponível" sem motivo é a reclamação que o prompt manda evitar.
export function resolverCampo (chave, configurado, concedido) {
  const spec = PARAMETROS[chave]
  if (!spec) throw new Error(`Parâmetro desconhecido: ${chave}`)

  const pedido = configurado === undefined ? spec.padrao : configurado
  const base = { chave, rotulo: spec.rotulo, configurado: pedido, concedido: concedido ?? null }

  if (spec.regra === 'travável') {
    if (concedido === undefined || concedido === null) {
      return { ...base, efetivo: pedido, origem: 'preferência do cliente', motivo: null }
    }
    if (pedido === concedido) {
      return { ...base, efetivo: concedido, origem: 'concessão do administrador', motivo: null }
    }
    return {
      ...base,
      efetivo: concedido,
      origem: 'concessão do administrador',
      motivo: `A administração fixou "${spec.rotulo}" em ${concedido}.`
    }
  }

  if (spec.regra === 'lista') {
    const permitidas = Array.isArray(concedido) && concedido.length ? concedido : spec.opcoes
    if (permitidas.includes(pedido)) {
      return { ...base, concedido: permitidas, efetivo: pedido, origem: 'preferência do cliente', motivo: null }
    }
    const queda = permitidas.includes(spec.padrao) ? spec.padrao : permitidas[0]
    return {
      ...base,
      concedido: permitidas,
      efetivo: queda,
      origem: 'concessão do administrador',
      motivo: `"${pedido}" não está liberado. Disponíveis: ${permitidas.join(', ')}.`
    }
  }

  // Daqui para baixo é numérico. Sem concessão, o cliente manda — padrão
  // sensato sim, teto no código não.
  const piso = spec.minimo ?? 0
  let numero = Number.isFinite(pedido) ? pedido : spec.padrao

  if (spec.regra === 'teto onde zero é ilimitado') {
    const temTeto = Number.isFinite(concedido) && concedido > 0
    const unidade = spec.unidade ? ` ${spec.unidade}` : ''
    if (!temTeto) {
      return { ...base, efetivo: numero, origem: 'preferência do cliente', motivo: null }
    }
    // O ponto inteiro deste ramo: zero NÃO passa por Math.min. Zero significa
    // "sem limite", então pedir zero contra um teto concedido é justamente a
    // tentativa de elevação, e vira o teto.
    if (numero === 0 || numero > concedido) {
      return {
        ...base,
        efetivo: concedido,
        origem: 'concessão do administrador',
        motivo: numero === 0
          ? `Sem limite não está liberado; a administração concedeu ${concedido}${unidade}.`
          : `A administração concedeu até ${concedido}${unidade}.`
      }
    }
    return { ...base, efetivo: numero, origem: 'preferência do cliente', motivo: null }
  }

  // 'teto' e 'teto com piso'
  if (numero < piso) {
    return {
      ...base,
      efetivo: piso,
      origem: 'mínimo obrigatório',
      motivo: `${spec.rotulo} não pode ser menor que ${piso}.`
    }
  }
  if (Number.isFinite(concedido) && numero > concedido) {
    // Teto abaixo do mínimo obrigatório seria concessão impossível; o piso
    // vence, e validarConcessao recusa criar essa concessão.
    const efetivo = Math.max(concedido, piso)
    return {
      ...base,
      efetivo,
      origem: efetivo === piso && piso > concedido ? 'mínimo obrigatório' : 'concessão do administrador',
      motivo: `A administração concedeu até ${concedido}.`
    }
  }
  return { ...base, efetivo: numero, origem: 'preferência do cliente', motivo: null }
}

// A tabela inteira resolvida. `configurado` é o config.json da instância,
// `concessoes` é o pedaço do registro. Esta é a função que o runtime chama.
export function limitesEfetivos (configurado = {}, concessoes = {}) {
  const saida = {}
  for (const chave of CAMPOS) {
    saida[chave] = resolverCampo(chave, pegar(configurado, chave), concessoes[chave])
  }
  return saida
}

// Só os valores, para quem quer aplicar e não explicar.
export function valoresEfetivos (configurado = {}, concessoes = {}) {
  const resolvido = limitesEfetivos(configurado, concessoes)
  const saida = {}
  for (const chave of CAMPOS) saida[chave] = resolvido[chave].efetivo
  return saida
}

// Lado do ADMINISTRADOR: valida a concessão em si. Recusa teto que o mínimo
// obrigatório tornaria impossível de cumprir, em vez de aceitar e deixar o
// runtime desobedecer em silêncio.
export function validarConcessao (patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Corpo inválido.')
  const saida = {}
  for (const [chave, valor] of Object.entries(patch)) {
    const spec = PARAMETROS[chave]
    if (!spec) throw new Error(`Parâmetro desconhecido: ${chave}`)
    if (valor === null) { saida[chave] = null; continue } // null = retirar a concessão
    if (spec.regra === 'travável') {
      if (typeof valor !== 'boolean') throw new Error(`${chave} deve ser booleano.`)
      saida[chave] = valor
      continue
    }
    if (spec.regra === 'lista') {
      if (!Array.isArray(valor) || !valor.length) throw new Error(`${chave} deve ser uma lista não vazia.`)
      const invalido = valor.find((v) => !spec.opcoes.includes(v))
      if (invalido) throw new Error(`${chave}: "${invalido}" não é uma opção (${spec.opcoes.join(', ')}).`)
      saida[chave] = [...valor]
      continue
    }
    if (!Number.isInteger(valor) || valor < 0) throw new Error(`${chave} deve ser um inteiro >= 0.`)
    const piso = spec.minimo ?? 0
    if (spec.regra !== 'teto onde zero é ilimitado' && valor < piso) {
      throw new Error(`${chave}: conceder ${valor} é menor que o mínimo obrigatório (${piso}); a instância não conseguiria obedecer.`)
    }
    saida[chave] = valor
  }
  return saida
}

// Lado do CLIENTE: o valor que ele pediu cabe na concessão? Recusa com
// motivo em vez de aceitar e limitar calado — gravar um número e devolver
// outro é o que faz a pessoa achar que a tela está quebrada.
export function validarPedido (chave, valor, concessoes = {}) {
  const resolvido = resolverCampo(chave, valor, concessoes[chave])
  if (resolvido.motivo) {
    const erro = new Error(resolvido.motivo)
    erro.code = 'LCN_ACIMA_DA_CONCESSAO'
    erro.campo = chave
    erro.permitido = resolvido.efetivo
    throw erro
  }
  return resolvido.efetivo
}

// O que a tela mostra: valor configurado, limite permitido, o que está em
// vigor, de onde o limite vem, o que o campo significa e o que ele faz.
export function explicar (configurado = {}, concessoes = {}) {
  const resolvido = limitesEfetivos(configurado, concessoes)
  return CAMPOS.map((chave) => {
    const spec = PARAMETROS[chave]
    const r = resolvido[chave]
    return {
      chave,
      rotulo: spec.rotulo,
      tipo: spec.tipo,
      padrao: spec.padrao,
      opcoes: spec.opcoes ?? null,
      minimo: spec.minimo ?? null,
      configurado: r.configurado,
      // `r.configurado` já traz o padrão quando ninguém escolheu nada, porque
      // o resolvedor precisa de um número para resolver. A tela precisa saber
      // a diferença: dizer "você escolheu 2" a quem nunca abriu esta tela é
      // afirmar uma escolha que não houve.
      foiEscolhido: pegar(configurado, chave) !== undefined,
      permitido: r.concedido,
      // Se existe concessão para ESTE campo, mesmo quando ela não está
      // cortando nada agora (o cliente pediu abaixo do teto). É o que diz à
      // tela que uma mudança de concessão precisa de reinício para valer, e
      // não dá para inferir de `fonteDoLimite`: com o pedido abaixo do teto a
      // fonte é a preferência do cliente, e a concessão continua lá.
      temConcessao: concessoes[chave] !== undefined && concessoes[chave] !== null,
      emVigor: r.efetivo,
      fonteDoLimite: r.origem,
      indisponivelPorque: r.motivo,
      significado: spec.significado,
      efeito: spec.efeito,
      // Quando o limite não é nosso, a tela tem de dizer. O WhatsApp impõe
      // teto próprio de tamanho de mídia e a instância não negocia isso.
      limiteDoProvedor: chave === 'hardware.maxMidiaMB' || chave === 'download.limiteMB'
    }
  })
}

// Um campo só, para o caminho quente. `valoresEfetivos` resolve os nove a cada
// chamada, e `limitesDeMidia` é chamado por operação de mídia.
export function valorEfetivo (chave, configurado = {}, concessoes = {}) {
  return resolverCampo(chave, pegar(configurado, chave), concessoes[chave]).efetivo
}

// Valor inválido na config volta ao padrão (como a fila sempre fez) antes de o
// teto concedido entrar; negativo não pode virar "sem espera" pela porta dos fundos.
export function maxPendentesEfetivo (cfg, concessoes = concessoesDoProcesso()) {
  const pedido = cfg?.hardware?.maxPendentes
  const valido = Number.isSafeInteger(pedido) && pedido >= 0 ? pedido : undefined
  return valorEfetivo('hardware.maxPendentes', { hardware: { maxPendentes: valido } }, concessoes)
}

// Cota administrativa de criação: 0 = sem limite. Não há preferência do
// cliente aqui (ele não escolhe quantas conexões quer), só o teto concedido.
export function limiteAdministrativo (chave, concessoes = concessoesDoProcesso()) {
  return valorEfetivo(chave, {}, concessoes)
}

// ---------------------------------------------------------------------------
// COMO A CONCESSÃO CHEGA AO PROCESSO QUE A OBEDECE
//
// O registro NÃO é alcançável de dentro de uma instância gerenciada: o quadlet
// monta `sessao`, `midia`, `data`, `config.json` e o run do motor — e
// `registry.json` fica de fora (src/instances/quadlet.js:49-53). Isso é o
// isolamento funcionando, não um esquecimento: a instância não pode ler nem
// reescrever o teto que o administrador lhe deu.
//
// Então o teto entra pelo AMBIENTE, que é escrito pelo lado do administrador
// (no host, na unit do quadlet) e que o processo de dentro não reescreve —
// o mesmo caminho por onde `LCN_INSTANCE_ID` já chega.
//
// Fonte ÚNICA de propósito: ler o registro aqui também daria duas respostas
// diferentes para a mesma pergunta dependendo de onde o código roda, que é a
// divergência de camadas de sempre. E deixaria a bateria dependendo do
// registry.json real da máquina de quem roda os testes.
export const CHAVE_DE_AMBIENTE = 'LCN_CONCESSOES'

export function serializarConcessoes (concessoes) {
  const limpas = {}
  for (const [chave, valor] of Object.entries(concessoes || {})) {
    if (PARAMETROS[chave] && valor !== null && valor !== undefined) limpas[chave] = valor
  }
  return Object.keys(limpas).length ? JSON.stringify(limpas) : ''
}

let cacheDoProcesso = null

// Nunca lança: concessão ilegível não pode impedir o bot de subir. Erro de
// forma cai para "sem concessão", que é o comportamento de antes desta camada.
export function concessoesDoProcesso () {
  if (cacheDoProcesso) return cacheDoProcesso
  const bruto = process.env[CHAVE_DE_AMBIENTE]
  if (!bruto) { cacheDoProcesso = {}; return cacheDoProcesso }
  try {
    const lido = JSON.parse(bruto)
    cacheDoProcesso = validarConcessao(lido)
  } catch {
    cacheDoProcesso = {}
  }
  return cacheDoProcesso
}

// Só para teste: o cache existe porque limitesDeMidia roda por operação.
export function esquecerConcessoesDoProcesso () { cacheDoProcesso = null }
