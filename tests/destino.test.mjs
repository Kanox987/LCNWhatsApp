// Testes das funções puras de destino/permissão por contato.
import { estaAutoTranscricao, podeComandoTerceiros, resolverDestino } from '../src/capture.js'

const sockFake = { user: { id: '5599999999999@s.whatsapp.net' } }

let falhas = 0
function checar (nome, got, esperado) {
  const ok = JSON.stringify(got) === JSON.stringify(esperado)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome} exp=${JSON.stringify(esperado)} got=${JSON.stringify(got)}`)
}

// ————— resolverDestino —————
checar(
  'self-chat padrão',
  resolverDestino({ destino: { tipo: 'self' }, captura: {} }, sockFake, '5511888888888@s.whatsapp.net', '5511888888888'),
  '5599999999999@s.whatsapp.net'
)
checar(
  'destino número configurado',
  resolverDestino({ destino: { tipo: 'numero', jid: '5511777777777' }, captura: {} }, sockFake, '5511888888888@s.whatsapp.net', '5511888888888'),
  '5511777777777@s.whatsapp.net'
)
checar(
  'contato com destino próprio fura o destino global',
  resolverDestino(
    { destino: { tipo: 'numero', jid: '5511777777777' }, captura: { destinoProprioContatos: ['5511888888888'] } },
    sockFake,
    '5511888888888@s.whatsapp.net',
    '5511888888888'
  ),
  '5511888888888@s.whatsapp.net'
)
checar(
  'contato fora da lista de destino próprio cai no destino global',
  resolverDestino(
    { destino: { tipo: 'self' }, captura: { destinoProprioContatos: ['5511000000000'] } },
    sockFake,
    '5511888888888@s.whatsapp.net',
    '5511888888888'
  ),
  '5599999999999@s.whatsapp.net'
)

// ————— podeComandoTerceiros / estaAutoTranscricao —————
const cfgBase = {
  transcricao: {
    comandoTerceiros: false,
    conversas: [
      { id: '5511111111111', auto: true, comandoTerceiros: true },
      { id: '5511222222222', auto: false, comandoTerceiros: false }
    ]
  }
}

checar('padrão geral: comando só do dono', podeComandoTerceiros(cfgBase, '5511999999999@s.whatsapp.net'), false)
checar('override por conversa: libera terceiros', podeComandoTerceiros(cfgBase, '5511111111111@s.whatsapp.net'), true)
checar('override por conversa: bloqueia mesmo com geral true', podeComandoTerceiros({ transcricao: { comandoTerceiros: true, conversas: cfgBase.transcricao.conversas } }, '5511222222222@s.whatsapp.net'), false)
checar('auto ligado só na conversa configurada', estaAutoTranscricao(cfgBase, '5511111111111@s.whatsapp.net'), true)
checar('auto desligado em conversa não configurada', estaAutoTranscricao(cfgBase, '5511999999999@s.whatsapp.net'), false)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nDESTINO/PERMISSÃO OK')
process.exit(falhas ? 1 : 0)
