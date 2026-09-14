// Data e hora prontas para colar numa resposta.
//
// O fuso é fixado em cada caso de propósito: sem isso o teste passaria ou
// falharia conforme a máquina de quem roda, que é o tipo de teste que some do
// radar até quebrar no servidor de outra pessoa.
import { valoresDeAgora, CAMPOS_DE_AGORA } from '../src/engine/server/momento.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const SP = 'America/Sao_Paulo'
// 2026-09-14T13:31:00Z = segunda-feira, 10:31 em São Paulo (UTC-3).
const segundaDeManha = Date.parse('2026-09-14T13:31:00Z')
const v = valoresDeAgora(segundaDeManha, { timeZone: SP })

check('data no formato brasileiro', v.date === '14/09/2026', v.date)
check('hora em 24 horas', v.time === '10:31', v.time)
check('dia da semana por extenso', v.weekday === 'segunda-feira', v.weekday)
check('dia com dois dígitos', v.day === '14', v.day)
check('mês com dois dígitos', v.month === '09', v.month)
check('ano com quatro dígitos', v.year === '2026', v.year)
check('hora e minuto separados', v.hour === '10' && v.minute === '31', `${v.hour}:${v.minute}`)

// --- a saudação, que é o motivo principal disto existir -------------------
const saudacaoEm = (isoUtc) => valoresDeAgora(Date.parse(isoUtc), { timeZone: SP }).greeting
check('06:00 já é bom dia', saudacaoEm('2026-09-14T09:00:00Z') === 'Bom dia')
check('11:59 ainda é bom dia', saudacaoEm('2026-09-14T14:59:00Z') === 'Bom dia')
check('12:00 vira boa tarde', saudacaoEm('2026-09-14T15:00:00Z') === 'Boa tarde')
check('17:59 ainda é boa tarde', saudacaoEm('2026-09-14T20:59:00Z') === 'Boa tarde')
check('18:00 vira boa noite', saudacaoEm('2026-09-14T21:00:00Z') === 'Boa noite')
// Madrugada é "boa noite" em português, não "boa madrugada".
check('03:00 é boa noite, não madrugada', saudacaoEm('2026-09-14T06:00:00Z') === 'Boa noite')
check('05:59 ainda é boa noite', saudacaoEm('2026-09-14T08:59:00Z') === 'Boa noite')

// --- o fuso muda o resultado de verdade ----------------------------------
// Se este caso passasse com os dois iguais, o parâmetro de fuso estaria sendo
// ignorado e todo mundo receberia a hora do servidor.
const emTokyo = valoresDeAgora(segundaDeManha, { timeZone: 'Asia/Tokyo' })
check('o fuso é respeitado, não é a hora do servidor', emTokyo.time !== v.time && emTokyo.time === '22:31', emTokyo.time)
check('fuso adiantado pode virar o dia', emTokyo.date === '14/09/2026', emTokyo.date)

// --- entrada ruim não derruba a avaliação do evento ----------------------
const fusoInvalido = valoresDeAgora(segundaDeManha, { timeZone: 'Nao/Existe' })
check('fuso inválido cai para o da máquina em vez de lançar', typeof fusoInvalido.date === 'string' && fusoInvalido.date.length === 10, fusoInvalido.date)

const dataInvalida = valoresDeAgora(Number.NaN)
check('data inválida devolve vazio em vez de lançar', Object.keys(dataInvalida).length === 0)

// --- o catálogo bate com o que a função devolve --------------------------
// É o que impede documentar no painel uma variável que não existe, ou
// esconder uma que passou a existir.
const devolvidos = Object.keys(v).sort()
check('CAMPOS_DE_AGORA lista exatamente o que é devolvido',
  JSON.stringify(devolvidos) === JSON.stringify([...CAMPOS_DE_AGORA].sort()),
  devolvidos.join(','))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE DATA E HORA PASSARAM')
process.exit(falhas ? 1 : 0)
