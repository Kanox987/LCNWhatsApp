// Expressões de tempo da linguagem: "daqui 30 min", "23 de agosto de 2030 às 14h",
// "todo dia às 8h", "a cada 2 horas".
//
// É um módulo PURO, sem banco e sem relógio próprio: quem chama passa `agora`.
// Isso é o que deixa o compilador, o painel e o motor lerem a mesma frase do
// mesmo jeito — a frase do cabeçalho `quando:` tem UM intérprete só.
//
// O resultado descreve a regra, nunca um instante calculado a partir de um
// relógio escondido:
//   { ok: true, tipo: 'unico', modo: 'relativo', ms }       daqui N unidades
//   { ok: true, tipo: 'unico', modo: 'absoluto', local }    data e hora na parede do fuso
//   { ok: true, tipo: 'recorrente', regra }                  todo dia / toda segunda / a cada N
// `daqui 30 min` fica RELATIVO de propósito: o ponto zero é o momento em que a
// revisão entra no ar, e só o motor sabe qual é esse momento. Reeditar a
// automação recomeça a contagem.
//
// Data e hora absolutas são guardadas como relógio de parede ("2030-08-23T14:30")
// mais o fuso. Converter para instante é função à parte (`instanteDe`) porque a
// regra do fuso (horário de verão) pode mudar entre escrever e disparar.

const UNIDADES_MS = Object.freeze({
  segundo: 1000,
  minuto: 60_000,
  hora: 3_600_000,
  dia: 86_400_000,
  semana: 604_800_000
})

// Cada apelido aponta para a unidade. Sem acento: o texto é normalizado antes.
const APELIDOS_DE_UNIDADE = Object.freeze({
  s: 'segundo', seg: 'segundo', segs: 'segundo', segundo: 'segundo', segundos: 'segundo',
  m: 'minuto', min: 'minuto', mins: 'minuto', minuto: 'minuto', minutos: 'minuto',
  h: 'hora', hr: 'hora', hrs: 'hora', hora: 'hora', horas: 'hora',
  d: 'dia', dia: 'dia', dias: 'dia',
  sem: 'semana', semana: 'semana', semanas: 'semana'
})

const MESES = Object.freeze({
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4,
  maio: 5, mai: 5, junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8,
  setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12
})

// 0 = domingo, igual a Date#getUTCDay.
const DIAS_DA_SEMANA = Object.freeze({
  domingo: 0, dom: 0, segunda: 1, seg: 1, terca: 2, ter: 2, quarta: 3, qua: 3,
  quinta: 4, qui: 4, sexta: 5, sex: 5, sabado: 6, sab: 6
})

export const NOMES_DE_DIA = Object.freeze(['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'])

// O intervalo mínimo é PADRÃO, não teto: quem administra o motor muda por
// configuração (`recorrenciaMinimaMs`). Sem mínimo, "a cada 1 segundo" é uma
// inundação escrita em português.
export const INTERVALO_MINIMO_PADRAO_MS = 60_000

const erro = (mensagem) => ({ ok: false, erro: mensagem })

function normalizar (texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// "1h30", "14:30", "14h", "8 da noite", "meio-dia". Devolve { hora, minuto, resto }
// onde `resto` é o texto sem a hora, ou null quando não há hora nenhuma.
function lerHora (texto) {
  let t = texto
  if (/\bmeio[- ]?dia\b/.test(t)) return { hora: 12, minuto: 0, resto: t.replace(/\bmeio[- ]?dia\b/, ' ') }
  if (/\bmeia[- ]?noite\b/.test(t)) return { hora: 0, minuto: 0, resto: t.replace(/\bmeia[- ]?noite\b/, ' ') }

  const m = t.match(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?| ?horas?)(?: ?(?:da|de) (manha|tarde|noite|madrugada))?\b/) ||
    t.match(/\b(\d{1,2})()()(?: (?:da|de)) (manha|tarde|noite|madrugada)\b/)
  if (!m) return null
  let hora = Number(m[1])
  const minuto = Number(m[2] ?? m[3] ?? 0)
  const periodo = m[4]
  if (periodo === 'tarde' || periodo === 'noite') {
    if (hora >= 1 && hora <= 11) hora += 12
  } else if ((periodo === 'manha' || periodo === 'madrugada') && hora === 12) {
    hora = 0
  }
  if (hora > 23 || minuto > 59) return { invalida: true }
  t = t.replace(m[0], ' ')
  return { hora, minuto, resto: t }
}

function tiraEnfeites (texto) {
  return texto
    .replace(/\b(as|a|em|no|na|dia)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Soma de pedaços: "1 hora e 30 minutos", "2h30", "1h 30min", "90 min".
function lerDuracao (texto) {
  let resto = texto.replace(/\be\b/g, ' ').replace(/(?<!\d),|,(?!\d)/g, ' ').replace(/\s+/g, ' ').trim()
  // "1h30" → "1h 30min": o número colado sem unidade herda minutos.
  resto = resto.replace(/\b(\d+)h(\d{1,2})\b/g, '$1h $2min')
  const pedaco = /^(\d+(?:[.,]\d+)?) ?([a-z]+)\b ?/
  let ms = 0
  let achou = false
  while (resto) {
    const m = resto.match(pedaco)
    if (!m) return null
    const unidade = APELIDOS_DE_UNIDADE[m[2]]
    if (!unidade) return null
    ms += Math.round(Number(m[1].replace(',', '.')) * UNIDADES_MS[unidade])
    resto = resto.slice(m[0].length)
    achou = true
  }
  return achou ? ms : null
}

function diasNoMes (ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

function dataValida (ano, mes, dia) {
  return Number.isInteger(ano) && mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes)
}

const pad = (n, largura = 2) => String(n).padStart(largura, '0')

// --- fuso -----------------------------------------------------------------

function fusoValido (fuso) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso })
    return true
  } catch {
    return false
  }
}

// Relógio de parede de um instante, no fuso. Uma passada de Intl: somar offset
// à mão erra em horário de verão e em fuso de meia hora.
export function paredeEm (instante, fuso) {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  const p = {}
  for (const { type, value } of formato.formatToParts(instante)) p[type] = value
  const ano = Number(p.year)
  const mes = Number(p.month)
  const dia = Number(p.day)
  return {
    ano,
    mes,
    dia,
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
    diaDaSemana: new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
  }
}

// Relógio de parede → instante. Duas passadas corrigem o offset (que muda
// quando a parede cruza uma virada de horário de verão). Hora que não existe
// (pulo da primavera) cai na hora seguinte; hora repetida usa a primeira.
export function instanteDe (local, fuso) {
  const m = String(local).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) throw new RangeError(`relógio de parede inválido: ${local}`)
  const alvo = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  let palpite = alvo
  for (let i = 0; i < 3; i++) {
    const p = paredeEm(new Date(palpite), fuso)
    const vista = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
    const diferenca = alvo - vista
    if (diferenca === 0) return new Date(palpite)
    palpite += diferenca
  }
  return new Date(palpite)
}

function localIso ({ ano, mes, dia, hora, minuto }) {
  return `${pad(ano, 4)}-${pad(mes)}-${pad(dia)}T${pad(hora)}:${pad(minuto)}`
}

function somaDias ({ ano, mes, dia }, dias) {
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias))
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() }
}

// --- interpretação --------------------------------------------------------

function interpretarRecorrencia (t, minimoMs) {
  // a cada 30 min / a cada 2 horas
  let m = t.match(/^a cada (.+)$/)
  if (m) {
    const ms = lerDuracao(m[1])
    if (ms == null || ms <= 0) return erro(`Não entendi o intervalo "${m[1]}". Exemplos: a cada 30 min, a cada 2 horas.`)
    if (ms < minimoMs) return erro(`O intervalo mais curto permitido é ${Math.round(minimoMs / 1000)} segundos. "a cada ${m[1]}" é menor que isso.`)
    return { ok: true, tipo: 'recorrente', regra: { freq: 'intervalo', ms } }
  }

  // todo dia 15 [às 10h]; todo mês no dia 15 — mensal. Vem antes de "todo dia" para o número não virar sobra.
  m = t.match(/^todo dia (\d{1,2})(?![h:\d])(?: (.*))?$/) || t.match(/^(?:mensalmente|todo mes) (?:no )?(?:dia )?(\d{1,2})(?![h:\d])(?: (.*))?$/)
  if (m) {
    const dia = Number(m[1])
    if (dia < 1 || dia > 31) return erro('Dia do mês inválido. Use de 1 a 31.')
    const h = lerHora(tiraEnfeites(m[2] ?? ''))
    if (h?.invalida) return erro('Hora inválida. Use de 0h a 23h59.')
    if (!h) return erro('Faltou a hora. Exemplo: todo dia 15 às 10h.')
    if (tiraEnfeites(h.resto)) return erro(`Sobrou "${tiraEnfeites(h.resto)}" na frase. Exemplo: todo dia 15 às 10h.`)
    return { ok: true, tipo: 'recorrente', regra: { freq: 'mensal', dia, hora: h.hora, minuto: h.minuto } }
  }

  // todo dia / todos os dias [às 8h]
  m = t.match(/^(?:todo dia|todos os dias|diariamente)(?: (.*))?$/)
  if (m) {
    const h = lerHora(tiraEnfeites(m[1] ?? ''))
    if (h?.invalida) return erro('Hora inválida. Use de 0h a 23h59.')
    if (!h) return erro('Faltou a hora. Exemplo: todo dia às 8h.')
    if (tiraEnfeites(h.resto)) return erro(`Sobrou "${tiraEnfeites(h.resto)}" na frase. Exemplo: todo dia às 8h.`)
    return { ok: true, tipo: 'recorrente', regra: { freq: 'diaria', hora: h.hora, minuto: h.minuto } }
  }

  // toda segunda [e quarta] [às 9h]; todas as segundas
  m = t.match(/^(?:toda|todas as|todo|todos os) ((?:segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|ter|qua|qui|sex|sab|dom)(?:-?feira)?s?(?:(?:,| e) ?(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|ter|qua|qui|sex|sab|dom)(?:-?feira)?s?)*)(?: (.*))?$/)
  if (m) {
    const dias = [...new Set(
      m[1].replace(/-?feiras?/g, '').split(/,| e /).map((x) => x.trim().replace(/s$/, ''))
        .map((x) => DIAS_DA_SEMANA[x])
    )]
    if (dias.some((d) => d === undefined)) return erro(`Não entendi o dia da semana em "${m[1]}".`)
    const h = lerHora(tiraEnfeites(m[2] ?? ''))
    if (h?.invalida) return erro('Hora inválida. Use de 0h a 23h59.')
    if (!h) return erro('Faltou a hora. Exemplo: toda segunda às 9h.')
    if (tiraEnfeites(h.resto)) return erro(`Sobrou "${tiraEnfeites(h.resto)}" na frase. Exemplo: toda segunda às 9h.`)
    return { ok: true, tipo: 'recorrente', regra: { freq: 'semanal', dias: dias.sort((a, b) => a - b), hora: h.hora, minuto: h.minuto } }
  }

  return null
}

/**
 * Lê a frase do cabeçalho `quando:` de uma automação agendada.
 *
 * @param {string} frase
 * @param {{ agora?: Date, fuso?: string, recorrenciaMinimaMs?: number, permitirPassado?: boolean }} [opcoes]
 *   `agora` só é usado para decidir o ano de datas sem ano ("23 de agosto") e
 *   para recusar datas no passado; nunca entra no resultado. Com
 *   `permitirPassado`, data vencida volta `ok` com `passado: true` em vez de erro.
 */
export function interpretarTempo (frase, { agora = new Date(), fuso = 'America/Sao_Paulo', recorrenciaMinimaMs = INTERVALO_MINIMO_PADRAO_MS, permitirPassado = false } = {}) {
  if (!fusoValido(fuso)) return erro(`Fuso desconhecido: ${fuso}. Exemplo: America/Sao_Paulo.`)
  let t = normalizar(frase)
  if (!t) return erro('Faltou dizer quando. Exemplos: daqui 30 min, 23 de agosto de 2030 às 14h, todo dia às 8h.')

  const recorrente = interpretarRecorrencia(t, recorrenciaMinimaMs)
  if (recorrente) return recorrente.ok ? { ...recorrente, fuso } : recorrente

  // daqui 30 min / daqui a 2 horas / em 1h30 / dentro de 10 minutos
  // "em 23 de agosto" e "em 2030-08-23" são data, não duração: só `em` deixa passar adiante.
  let m = t.match(/^(?:daqui(?: a)?|dentro de|em|apos) (.+)$/)
  const eDuracao = m && /^\d/.test(m[1]) && (!/^em /.test(t) || lerDuracao(m[1]) != null)
  if (eDuracao) {
    const ms = lerDuracao(m[1])
    if (ms == null) return erro(`Não entendi a duração "${m[1]}". Exemplos: daqui 30 min, daqui 2 horas, daqui 1h30.`)
    if (ms <= 0) return erro('A duração precisa ser maior que zero.')
    return { ok: true, tipo: 'unico', modo: 'relativo', ms }
  }

  // Daqui para baixo é data e/ou hora de parede. Tira o "em"/"no dia" do começo.
  t = t.replace(/^(?:em|no dia|dia) /, '')
  const hora = lerHora(t)
  if (hora?.invalida) return erro('Hora inválida. Use de 0h a 23h59.')
  let resto = tiraEnfeites(hora ? hora.resto : t)

  const hoje = paredeEm(agora, fuso)
  let data = null

  if (/^(?:hoje)$/.test(resto)) data = { ano: hoje.ano, mes: hoje.mes, dia: hoje.dia }
  else if (/^amanha$/.test(resto)) data = somaDias(hoje, 1)
  else if (/^depois de amanha$/.test(resto)) data = somaDias(hoje, 2)
  else if ((m = resto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/))) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    data = { ano, mes: Number(m[2]), dia: Number(m[1]) }
  } else if ((m = resto.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    data = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) }
  } else if ((m = resto.match(/^(\d{1,2})\/(\d{1,2})$/))) {
    data = { ano: null, mes: Number(m[2]), dia: Number(m[1]) }
  } else if ((m = resto.match(/^(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?$/)) || (m = resto.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/))) {
    const mes = MESES[m[2]]
    if (!mes) return erro(`Não conheço o mês "${m[2]}".`)
    data = { ano: m[3] ? Number(m[3]) : null, mes, dia: Number(m[1]) }
  } else if (resto === '' && hora) {
    // só a hora ("às 18h"): hoje, ou amanhã se já passou
    data = { ano: hoje.ano, mes: hoje.mes, dia: hoje.dia }
    const candidata = instanteDe(localIso({ ...data, hora: hora.hora, minuto: hora.minuto }), fuso)
    if (candidata.getTime() <= agora.getTime()) data = somaDias(hoje, 1)
  } else {
    return erro(`Não entendi "${frase}". Exemplos: daqui 30 min, amanhã às 8h, 23 de agosto de 2030 às 14h, todo dia às 8h.`)
  }

  // Data sem ano: a próxima vez que ela acontece.
  if (data.ano == null) {
    let ano = hoje.ano
    if (!dataValida(ano, data.mes, data.dia)) {
      // 29 de fevereiro cai no próximo ano bissexto
      let tentativas = 0
      while (!dataValida(ano, data.mes, data.dia) && tentativas++ < 8) ano++
    }
    const parede = { ano, mes: data.mes, dia: data.dia, hora: hora?.hora ?? 0, minuto: hora?.minuto ?? 0 }
    if (dataValida(parede.ano, parede.mes, parede.dia) && instanteDe(localIso(parede), fuso).getTime() <= agora.getTime()) {
      ano++
      while (!dataValida(ano, data.mes, data.dia) && ano < hoje.ano + 9) ano++
    }
    data.ano = ano
  }

  if (!dataValida(data.ano, data.mes, data.dia)) {
    return erro(`Essa data não existe: ${pad(data.dia)}/${pad(data.mes)}/${data.ano}.`)
  }

  const parede = { ...data, hora: hora?.hora ?? 0, minuto: hora?.minuto ?? 0 }
  const local = localIso(parede)
  if (instanteDe(local, fuso).getTime() <= agora.getTime()) {
    // Reler um .lcn antigo (descompilar, importar, abrir no editor) não pode falhar
    // só porque a data já passou: quem decide o que fazer com um agendamento vencido é o motor.
    if (permitirPassado) return { ok: true, tipo: 'unico', modo: 'absoluto', local, fuso, passado: true }
    return erro(`Essa data e hora já passaram (${pad(parede.dia)}/${pad(parede.mes)}/${parede.ano} ${pad(parede.hora)}:${pad(parede.minuto)} em ${fuso}).`)
  }
  return { ok: true, tipo: 'unico', modo: 'absoluto', local, fuso }
}

/**
 * Próximo disparo de uma regra recorrente, estritamente DEPOIS de `depoisDe`.
 * Para `intervalo` a conta é âncora + N·ms, então um atraso do motor não
 * desloca a série inteira.
 *
 * @param {object} regra regra devolvida por `interpretarTempo`
 * @param {Date} depoisDe
 * @param {string} fuso
 * @param {Date} [ancora] só para `intervalo`: de onde a série conta (padrão: depoisDe)
 */
export function proximaOcorrencia (regra, depoisDe, fuso, ancora = depoisDe) {
  if (regra.freq === 'intervalo') {
    const passados = Math.floor((depoisDe.getTime() - ancora.getTime()) / regra.ms) + 1
    return new Date(ancora.getTime() + Math.max(1, passados) * regra.ms)
  }
  const base = paredeEm(depoisDe, fuso)
  for (let i = 0; i <= 400; i++) {
    const d = somaDias(base, i)
    const diaDaSemana = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay()
    if (regra.freq === 'semanal' && !regra.dias.includes(diaDaSemana)) continue
    if (regra.freq === 'mensal' && (d.dia !== regra.dia)) continue
    const instante = instanteDe(localIso({ ...d, hora: regra.hora, minuto: regra.minuto }), fuso)
    if (instante.getTime() > depoisDe.getTime()) return instante
  }
  return null
}

/** Instante do primeiro disparo de um resultado de `interpretarTempo`. */
export function primeiroDisparo (resultado, { agora = new Date() } = {}) {
  if (!resultado?.ok) return null
  if (resultado.tipo === 'unico') {
    return resultado.modo === 'relativo'
      ? new Date(agora.getTime() + resultado.ms)
      : instanteDe(resultado.local, resultado.fuso)
  }
  return proximaOcorrencia(resultado.regra, agora, resultado.fuso)
}

const DUR_PARTES = [['semana', 604_800_000], ['dia', 86_400_000], ['hora', 3_600_000], ['minuto', 60_000], ['segundo', 1000]]
const PLURAL = { semana: 'semanas', dia: 'dias', hora: 'horas', minuto: 'minutos', segundo: 'segundos' }

function textoDeDuracao (ms) {
  const partes = []
  let resto = ms
  for (const [nome, valor] of DUR_PARTES) {
    const n = Math.floor(resto / valor)
    if (n > 0) {
      partes.push(`${n} ${n === 1 ? nome : PLURAL[nome]}`)
      resto -= n * valor
    }
  }
  return partes.join(' e ') || '0 segundos'
}

const horaTexto = (h, m) => `${pad(h)}:${pad(m)}`

/**
 * A frase canônica de uma regra — o que o descompilador escreve e o painel
 * mostra. `interpretarTempo(escrever(x))` devolve o mesmo `x`: é a garantia de
 * ida e volta do `.lcn`.
 */
export function escreverTempo (resultado) {
  if (resultado.tipo === 'unico') {
    if (resultado.modo === 'relativo') return `daqui ${textoDeDuracao(resultado.ms)}`
    const [data, hm] = resultado.local.split('T')
    const [a, mes, d] = data.split('-')
    return `${d}/${mes}/${a} às ${hm}`
  }
  const r = resultado.regra
  if (r.freq === 'intervalo') return `a cada ${textoDeDuracao(r.ms)}`
  if (r.freq === 'diaria') return `todo dia às ${horaTexto(r.hora, r.minuto)}`
  if (r.freq === 'semanal') return `toda ${r.dias.map((d) => NOMES_DE_DIA[d].normalize('NFD').replace(/[̀-ͯ]/g, '')).join(' e ')} às ${horaTexto(r.hora, r.minuto)}`
  return `todo dia ${r.dia} às ${horaTexto(r.hora, r.minuto)}`
}
