// Data e hora como valores prontos para colar numa resposta.
//
// Por que isto existe em vez de uma "função de data" dentro do texto: a
// interpolação é troca de texto pura, sem aritmética nem chamada de função —
// invariante do projeto. Um `{{formatar(data, 'dd/MM')}}` exigiria um parser
// de expressão e abriria precedência, coerção e custo arbitrário. Aqui os
// formatos úteis já vêm calculados, e a pessoa escolhe qual colar.
//
// O relógio é o da MÁQUINA no instante da avaliação, não o do carimbo da
// mensagem. A diferença aparece quando o bot volta de um período fora do ar e
// processa a fila: quem escreveu às 2h da manhã está lendo a resposta agora,
// de dia — "bom dia" tem que valer para quem lê, não para quem escreveu.

// 6h–11h59 bom dia · 12h–17h59 boa tarde · resto boa noite. A madrugada cai em
// "boa noite" de propósito: é o que se diz em português, não "boa madrugada".
function saudacaoPara (hora) {
  if (hora >= 6 && hora < 12) return 'Bom dia'
  if (hora >= 12 && hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

// Uma passada só de Intl para todos os campos, já no fuso pedido — calcular
// hora local somando offset à mão erra em horário de verão e em fuso com
// meia hora de diferença.
function partesEm (data, timeZone) {
  const formato = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  const partes = {}
  for (const { type, value } of formato.formatToParts(data)) partes[type] = value
  return partes
}

export function valoresDeAgora (agoraMs = Date.now(), { timeZone } = {}) {
  const data = new Date(agoraMs)
  if (Number.isNaN(data.getTime())) return {}

  let p
  try {
    p = partesEm(data, timeZone)
  } catch {
    // Fuso inválido vindo de configuração não pode derrubar a avaliação do
    // evento: cai para o fuso da máquina.
    p = partesEm(data, undefined)
  }

  return {
    date: `${p.day}/${p.month}/${p.year}`,
    time: `${p.hour}:${p.minute}`,
    weekday: p.weekday,
    day: p.day,
    month: p.month,
    year: p.year,
    hour: p.hour,
    minute: p.minute,
    greeting: saudacaoPara(Number(p.hour))
  }
}

export const CAMPOS_DE_AGORA = Object.freeze([
  'date', 'time', 'weekday', 'day', 'month', 'year', 'hour', 'minute', 'greeting'
])
