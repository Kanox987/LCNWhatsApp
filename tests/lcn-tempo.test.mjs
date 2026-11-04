// Expressões de tempo da linguagem: "daqui 30 min", "23 de agosto de 2030", "todo dia às 8h".
//
// O relógio é sempre passado de fora (`agora`): nada aqui depende da hora em que
// o teste roda. Referência: 04/11/2026 12:00 em São Paulo (UTC-3, sem horário de
// verão desde 2019), que é 15:00 UTC.
import {
  interpretarTempo,
  primeiroDisparo,
  proximaOcorrencia,
  escreverTempo,
  instanteDe,
  paredeEm
} from '../src/lcn/tempo.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const AGORA = new Date('2026-11-04T15:00:00Z')
const SP = 'America/Sao_Paulo'
const ler = (frase, extra = {}) => interpretarTempo(frase, { agora: AGORA, fuso: SP, ...extra })
const iso = (r) => primeiroDisparo(r, { agora: AGORA })?.toISOString()

// --- relativo: ancorado em quem chama, nunca resolvido aqui --------------------
{
  const casos = [
    ['daqui 30 min', 30 * 60_000],
    ['daqui a 2 horas', 2 * 3_600_000],
    ['em 1h30', 90 * 60_000],
    ['daqui 1 hora e 30 minutos', 90 * 60_000],
    ['dentro de 10 minutos', 10 * 60_000],
    ['daqui 2 dias', 2 * 86_400_000],
    ['daqui 1 semana', 604_800_000],
    ['DAQUI 45 SEG', 45_000],
    ['daqui 1,5 horas', 5_400_000]
  ]
  for (const [frase, ms] of casos) {
    const r = ler(frase)
    check(`relativo: "${frase}"`, r.ok && r.tipo === 'unico' && r.modo === 'relativo' && r.ms === ms, JSON.stringify(r))
  }
  const r = ler('daqui 30 min')
  check('relativo conta a partir do `agora` que o chamador der',
    iso(r) === '2026-11-04T15:30:00.000Z' &&
    primeiroDisparo(r, { agora: new Date('2030-01-01T00:00:00Z') }).toISOString() === '2030-01-01T00:30:00.000Z')
}

// --- absoluto: a data do pedido do dono ----------------------------------------
{
  const r = ler('23 de agosto de 2030')
  check('"23 de agosto de 2030" lê como 00:00 de parede', r.ok && r.modo === 'absoluto' && r.local === '2030-08-23T00:00', JSON.stringify(r))
  const h = ler('23 de agosto de 2030 às 14:30')
  check('com hora: 14:30 em São Paulo = 17:30 UTC', h.ok && h.local === '2030-08-23T14:30' && iso(h) === '2030-08-23T17:30:00.000Z', JSON.stringify(h))
  for (const f of ['em 23 de agosto de 2030 às 14h30', 'em 23/08/2030 14h30', 'em 2030-08-23 14:30', '23/08/2030 14h30', '23/08/2030 às 14h30', '2030-08-23 14:30', '23 ago 2030 14:30', 'dia 23 de agosto de 2030 às 14h30']) {
    check(`mesma data em outra escrita: "${f}"`, ler(f).local === '2030-08-23T14:30', JSON.stringify(ler(f)))
  }
}

// --- palavras de dia, hora por extenso, ano omitido ----------------------------
{
  check('amanhã às 8h', ler('amanhã às 8h').local === '2026-11-05T08:00')
  check('amanha sem acento e com caixa', ler('AMANHA AS 8H').local === '2026-11-05T08:00')
  check('depois de amanhã', ler('depois de amanhã às 9h').local === '2026-11-06T09:00')
  check('hoje às 18:30 (ainda no futuro)', ler('hoje às 18:30').local === '2026-11-04T18:30')
  check('hoje às 10h (já passou) é recusado', ler('hoje às 10h').ok === false)
  check('só a hora: 18h → hoje', ler('às 18h').local === '2026-11-04T18:00')
  check('só a hora que já passou → amanhã', ler('às 9h').local === '2026-11-05T09:00')
  check('meio-dia / meia-noite', ler('amanhã meio-dia').local === '2026-11-05T12:00' && ler('amanhã meia-noite').local === '2026-11-05T00:00')
  check('8 da noite = 20h; 8 da manhã = 8h', ler('amanhã 8 da noite').local === '2026-11-05T20:00' && ler('amanhã 8 da manhã').local === '2026-11-05T08:00')
  check('12 da manhã não vira 24h', ler('amanhã 12 da madrugada').local === '2026-11-05T00:00')
  check('sem ano e ainda por vir: este ano', ler('25 de dezembro às 8h').local === '2026-12-25T08:00')
  check('sem ano e já passou: o próximo ano', ler('23 de agosto às 8h').local === '2027-08-23T08:00')
  check('29 de fevereiro cai no próximo bissexto', ler('29 de fevereiro às 9h').local === '2028-02-29T09:00')
}

// --- o que tem de ser recusado, com a razão -----------------------------------
{
  const recusas = [
    ['', 'vazio'],
    ['banana', 'sem sentido'],
    ['daqui 5 parsecs', 'unidade desconhecida'],
    ['daqui 0 min', 'zero'],
    ['daqui 23 de agosto', 'daqui é duração, não data'],
    ['31 de abril de 2030', 'data inexistente'],
    ['30 de fevereiro de 2030', 'data inexistente'],
    ['32/01/2030', 'dia 32'],
    ['10/13/2030', 'mês 13'],
    ['1 de nada de 2030', 'mês desconhecido'],
    ['amanhã às 25h', 'hora 25'],
    ['amanhã às 10:75', 'minuto 75'],
    ['01/01/2020', 'no passado'],
    ['toda segunda', 'recorrente sem hora'],
    ['todo dia', 'recorrente sem hora'],
    ['todo dia 32 às 10h', 'dia do mês 32'],
    ['toda segunda às 9h e banana', 'sobra no fim'],
    ['a cada 10 segundos', 'abaixo do mínimo'],
    ['a cada banana', 'intervalo sem sentido']
  ]
  for (const [frase, motivo] of recusas) {
    const r = ler(frase)
    check(`recusa (${motivo}): "${frase}"`, r.ok === false && typeof r.erro === 'string' && r.erro.length > 5, JSON.stringify(r))
  }
  check('fuso desconhecido é recusado, não ignorado', ler('amanhã às 8h', { fuso: 'Marte/Olimpo' }).ok === false)
  check('o mínimo de recorrência é configuração, não teto', ler('a cada 10 segundos', { recorrenciaMinimaMs: 1000 }).ok === true)
  const v = ler('01/01/2020', { permitirPassado: true })
  check('permitirPassado devolve ok marcando `passado` (reler um .lcn antigo não quebra)', v.ok && v.passado === true && v.local === '2020-01-01T00:00', JSON.stringify(v))
}

// --- recorrente ----------------------------------------------------------------
{
  const d = ler('todo dia às 8h')
  check('todo dia às 8h', d.ok && d.tipo === 'recorrente' && d.regra.freq === 'diaria' && d.regra.hora === 8 && iso(d) === '2026-11-05T11:00:00.000Z', JSON.stringify(d))
  check('"todos os dias" e "diariamente" são o mesmo', ler('todos os dias às 8h').regra.freq === 'diaria' && ler('diariamente às 8h').regra.freq === 'diaria')

  const s = ler('toda segunda e quarta às 9h')
  check('toda segunda e quarta às 9h', s.ok && s.regra.freq === 'semanal' && s.regra.dias.join() === '1,3' && s.regra.hora === 9, JSON.stringify(s))
  check('quarta 04/11 12:00: a próxima é segunda 09/11 09:00', iso(s) === '2026-11-09T12:00:00.000Z', iso(s))
  const sexta = ler('todas as sextas às 17h30')
  check('"todas as sextas às 17h30"', sexta.ok && sexta.regra.dias.join() === '5' && sexta.regra.minuto === 30, JSON.stringify(sexta))
  check('terça-feira e abreviações', ler('toda terça-feira às 9h').regra.dias.join() === '2' && ler('toda ter e qui às 9h').regra.dias.join() === '2,4')

  const m = ler('todo dia 15 às 10h')
  check('todo dia 15 às 10h é MENSAL, não "diário com sobra"', m.ok && m.regra.freq === 'mensal' && m.regra.dia === 15 && iso(m) === '2026-11-15T13:00:00.000Z', JSON.stringify(m))
  check('todo dia 8h continua diário (o 8 é hora, não dia do mês)', ler('todo dia 8h').regra?.freq === 'diaria', JSON.stringify(ler('todo dia 8h')))

  const i = ler('a cada 30 min')
  check('a cada 30 min', i.ok && i.regra.freq === 'intervalo' && i.regra.ms === 1_800_000, JSON.stringify(i))
}

// --- próxima ocorrência --------------------------------------------------------
{
  const diaria = ler('todo dia às 8h').regra
  const depoisDasOito = new Date('2026-11-05T11:00:00Z')
  check('estritamente DEPOIS: às 08:00 em ponto a próxima é amanhã', proximaOcorrencia(diaria, depoisDasOito, SP).toISOString() === '2026-11-06T11:00:00.000Z')

  const mensal = ler('todo dia 31 às 10h').regra
  const nov = proximaOcorrencia(mensal, AGORA, SP)
  check('dia 31 pula os meses que não têm 31 (nov → dez)', nov.toISOString() === '2026-12-31T13:00:00.000Z', nov?.toISOString())

  const cada = { freq: 'intervalo', ms: 600_000 }
  const ancora = new Date('2026-11-04T10:00:00Z')
  const atrasado = new Date('2026-11-04T10:25:00Z')
  check('intervalo: um atraso do motor não desloca a série (âncora + N·ms)',
    proximaOcorrencia(cada, atrasado, SP, ancora).toISOString() === '2026-11-04T10:30:00.000Z')
  check('intervalo no instante exato da âncora avança um passo',
    proximaOcorrencia(cada, ancora, SP, ancora).toISOString() === '2026-11-04T10:10:00.000Z')
}

// --- fuso: Intl, nunca offset fixo ----------------------------------------------
{
  check('mesma frase, outro fuso, outro instante',
    iso(ler('23 de agosto de 2030 às 14:30', { fuso: 'America/New_York' })) === '2030-08-23T18:30:00.000Z' &&
    iso(ler('23 de agosto de 2030 às 14:30', { fuso: 'Asia/Kolkata' })) === '2030-08-23T09:00:00.000Z')
  // Nova York em horário de verão (UTC-4) e fora dele (UTC-5): somar offset fixo erra uma das duas.
  check('horário de verão: julho UTC-4, janeiro UTC-5',
    instanteDe('2030-07-01T12:00', 'America/New_York').toISOString() === '2030-07-01T16:00:00.000Z' &&
    instanteDe('2030-01-01T12:00', 'America/New_York').toISOString() === '2030-01-01T17:00:00.000Z')
  // Pulo da primavera: 02:30 de 10/03/2030 não existe em Nova York; cai na hora seguinte, nunca em outro dia.
  const pulo = instanteDe('2030-03-10T02:30', 'America/New_York')
  const p = paredeEm(pulo, 'America/New_York')
  check('hora que não existe (pulo do verão) cai logo depois, no mesmo dia', p.dia === 10 && p.hora === 3, JSON.stringify(p))
  const ida = instanteDe('2030-08-23T14:30', SP)
  const volta = paredeEm(ida, SP)
  check('instanteDe e paredeEm são inversas', volta.dia === 23 && volta.hora === 14 && volta.minuto === 30)
}

// --- ida e volta: a frase que o descompilador escreve volta ao mesmo valor ----------
{
  const frases = [
    'daqui 30 min', 'daqui 1h30', 'daqui 2 semanas', '23 de agosto de 2030 às 14:30', 'amanhã às 8h',
    'todo dia às 8h', 'toda segunda e quarta às 9h', 'todas as sextas às 17h30', 'todo dia 15 às 10h', 'a cada 2 horas', 'a cada 90 min'
  ]
  for (const f of frases) {
    const a = ler(f)
    const escrita = a.ok ? escreverTempo(a) : ''
    const b = a.ok ? ler(escrita) : null
    check(`ida e volta: "${f}" → "${escrita}"`, a.ok && JSON.stringify(a) === JSON.stringify(b), JSON.stringify(b))
  }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE TEMPO PASSARAM')
process.exit(falhas ? 1 : 0)
