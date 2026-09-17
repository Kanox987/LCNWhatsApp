// Comandos que ficaram sem resposta quando o gateway caiu no meio.
//
// Existe por causa de um caso real: um deploy reiniciou o container enquanto
// dois downloads rodavam. Os comandos ficaram `pending` para sempre, e como o
// download manda "⏳ Baixando…" ANTES de baixar, quem pediu ficou esperando
// uma mídia que nunca veio — sem nada dizendo que falhou. Quatro vezes.
import { fecharOrfaos } from '../src/engine/orfaos.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

function cenario (pendentes, { falharAoListar = false } = {}) {
  const enviadas = []
  const confirmados = []
  const client = { message: { send: async (chatId, conteudo) => { enviadas.push({ chatId, conteudo }); return { id: 'X' } } } }
  const clienteEngine = {
    execucoes: {
      pendentes: async () => { if (falharAoListar) throw new Error('motor fora'); return pendentes },
      confirmar: async (id, body) => { confirmados.push({ id, body }) }
    }
  }
  return { client, clienteEngine, enviadas, confirmados }
}

const download = (extra = {}) => ({
  id: 'cmd-1',
  commandType: 'media.download',
  status: 'pending',
  payload: { chatId: '5511@s.whatsapp.net', url: 'https://x.com/a', ackText: '⏳ Baixando…', ...extra }
})

// --- o caso que motivou tudo ---------------------------------------------
{
  const c = cenario([download()])
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('quem prometeu "baixando" é avisado de que não vai vir', c.enviadas.length === 1,
    JSON.stringify(c.enviadas))
  check('o aviso vai para a conversa certa', c.enviadas[0]?.chatId === '5511@s.whatsapp.net')
  check('e o comando é fechado', c.confirmados.length === 1)
  // Invariante 3: ambíguo nunca vira falha. O download PODE ter terminado
  // antes da queda, e registrar falha faria alguém refazer à mão o que já foi.
  check('fechado como "não sei", nunca como falha',
    c.confirmados[0]?.body?.status === 'outcome_unknown', JSON.stringify(c.confirmados[0]))
  check('o resultado conta o que fez', r.fechados === 1 && r.avisados === 1, JSON.stringify(r))
}

// --- texto de erro próprio da automação ganha do padrão ------------------
{
  const c = cenario([download({ errorText: 'Deu ruim: {{erro}}' })])
  await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  const texto = c.enviadas[0]?.conteudo?.text || ''
  check('usa o texto de erro configurado na automação', texto.startsWith('Deu ruim:'), texto)
  check('e o {{erro}} é preenchido, nunca deixado cru', !texto.includes('{{erro}}'), texto)
}

// --- quem não prometeu nada não recebe aviso do nada ---------------------
// Uma resposta que nunca saiu não deixou ninguém esperando: um aviso solto,
// minutos depois, confunde mais do que ajuda.
{
  const c = cenario([{ id: 'c2', commandType: 'whatsapp.reply', status: 'pending', payload: { chatId: '55@s.whatsapp.net', text: 'oi' } }])
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('resposta comum interrompida não gera aviso', c.enviadas.length === 0)
  check('mas é fechada mesmo assim, para não ficar invisível', r.fechados === 1)
}

// --- download sem promessa também não avisa ------------------------------
{
  const c = cenario([download({ ackText: undefined })])
  await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('download que não avisou o início também não avisa o fim', c.enviadas.length === 0)
}

// --- queda antiga: fecha, mas não ressuscita a conversa ------------------
{
  const antigo = { ...download(), createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() }
  const c = cenario([antigo])
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('comando de dois dias atrás não vira mensagem nova', c.enviadas.length === 0)
  check('mas sai de "pending"', r.fechados === 1)
}

// --- falhar em avisar não pode impedir de fechar -------------------------
{
  const c = cenario([download()])
  c.client.message.send = async () => { throw new Error('sem sessão') }
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('aviso falhando, o comando ainda é fechado', r.fechados === 1 && r.avisados === 0, JSON.stringify(r))
}

// --- motor fora do ar não impede o gateway de subir ----------------------
{
  const c = cenario([], { falharAoListar: true })
  let estourou = false
  try { await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} }) } catch { estourou = true }
  check('motor inalcançável não derruba a conexão', estourou === false)
}

// --- sem conta, não faz nada ---------------------------------------------
{
  const c = cenario([download()])
  const r = await fecharOrfaos(c.client, c.clienteEngine, null, { log: () => {} })
  check('sem accountId não sai mensagem nem confirmação', r.fechados === 0 && c.enviadas.length === 0)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE COMANDO ÓRFÃO PASSARAM')
process.exit(falhas ? 1 : 0)
