// ADOTAR A VERSÃO NOVA DE UM COMANDO JÁ INSTALADO.
//
// O caminho existia pela metade: o formulário de reconfigurar já detectava a
// troca de versão e avisava o que mudaria ao salvar. Faltavam as duas pontas —
// SABER que existe versão nova (ninguém abre o formulário de um comando que
// está funcionando) e sobreviver ao valor guardado que a versão nova não
// conhece mais.
//
// O caso real: o /melhorar guardava `modo: "4k"`, e a versão nova separou o
// tratamento (auto, classico, ia, ambos) de até onde a foto cresce (4k,
// original, 2x, 4x). Com o valor velho, reconstruir a partir do template
// LANÇAVA, e o formulário fechava dizendo "não consegui reconstruir" — um beco
// sem saída para quem não tem terminal.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { sanearValores, analisarReconfiguracao } from '../src/reconfiguracao.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const TEMPLATE_NOVO = {
  templateId: 'melhorar-foto',
  templateVersion: 3,
  name: 'Melhorar a foto',
  parameters: [
    { key: 'command', type: 'string', default: '/melhorar', label: 'Comando' },
    { key: 'modo', type: 'enum', options: ['auto', 'classico', 'ia', 'ambos'], default: 'auto', label: 'Tratamento' },
    { key: 'alvo', type: 'enum', options: ['4k', 'original', '2x', '4x'], default: '4k', label: 'Até onde crescer' },
    { key: 'intensidade', type: 'number', default: 1, label: 'Intensidade do clássico' }
  ],
  documentTemplate: {
    schemaVersion: 1,
    enabled: true,
    name: 'Melhorar a foto',
    scope: { include: [], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [{ id: 'g', type: 'trigger.command', config: { command: '{{params.command}}' } }],
      edges: []
    }
  }
}

// --- o valor que a versão nova não conhece mais ---------------------------
{
  const { valores, ajustes } = sanearValores({
    template: TEMPLATE_NOVO,
    valores: { command: '/melhorar', modo: '4k', qualidade: 92 }
  })
  check('o valor fora da lista nova vira o padrão da versão nova', valores.modo === 'auto', valores.modo)
  check('e o ajuste é DITO, com o de e o para',
    ajustes.some((a) => a.chave === 'modo' && a.de === '4k' && a.para === 'auto'), JSON.stringify(ajustes))
  // Parâmetro que sumiu do template não pode viajar para o render: ele seria
  // ignorado em silêncio e continuaria guardado para sempre.
  check('parâmetro que não existe mais some', !Object.hasOwn(valores, 'qualidade'))
  check('e some DIZENDO', ajustes.some((a) => a.chave === 'qualidade' && a.para === null))
  check('o que continua válido atravessa intacto', valores.command === '/melhorar')
}

// --- a análise deixa de ser um beco sem saída ------------------------------
{
  const documento = renderizarTemplate({ ...TEMPLATE_NOVO, templateVersion: 2 }, { command: '/melhorar', modo: 'auto' })
  const analise = analisarReconfiguracao({
    documento,
    template: TEMPLATE_NOVO,
    valores: { command: '/melhorar', modo: '4k' },
    renderizar: renderizarTemplate,
    versaoInstalada: 2
  })
  check('com valor velho, o formulário ABRE em vez de travar', analise.podeReconfigurar === true, analise.motivo)
  check('e o aviso diz o que vai mudar sozinho', /4k vira auto/.test(analise.aviso || ''), analise.aviso)
}

// --- a rota que diz quais comandos têm versão nova -------------------------
{
  const db = abrirBanco(':memory:')
  const api = criarApi(db)
  const contexto = (body = null, query = '') => ({ body, query: new URLSearchParams(query), req: { headers: {} } })
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('pool-local', 'Pool', agora, agora)

  const vazio = await api.resolver('GET', '/templates/atualizacoes', contexto())
  check('sem nada instalado, nada a atualizar', Array.isArray(vazio) && vazio.length === 0)

  // Instala de verdade e depois finge que foi numa versão anterior — é
  // exatamente o estado de quem instalou antes da melhoria.
  await api.resolver('POST', '/templates/melhorar-foto/install', contexto({
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    automationIds: { 'melhorar-foto': 'melhorar' },
    parameters: { 'melhorar-foto': { command: '/melhorar', poolId: 'pool-local' } }
  }))
  const nadaAinda = await api.resolver('GET', '/templates/atualizacoes', contexto())
  check('recém-instalado não aparece como desatualizado', nadaAinda.length === 0, JSON.stringify(nadaAinda))

  db.prepare('UPDATE automation_template_provenance SET template_version = 1, parameters_json = ? WHERE automation_id = ?')
    .run(JSON.stringify({ command: '/melhorar', poolId: 'pool-local' }), 'melhorar')
  const pendentes = await api.resolver('GET', '/templates/atualizacoes', contexto())
  check('instalado numa versão antiga aparece', pendentes.length === 1, JSON.stringify(pendentes))
  check('dizendo de qual para qual', pendentes[0].de === 1 && pendentes[0].para >= 3, `${pendentes[0]?.de} -> ${pendentes[0]?.para}`)
  check('e quais campos estão sem valor guardado',
    pendentes[0].semValorGuardado.length > 0, JSON.stringify(pendentes[0]?.semValorGuardado))

  // O formulário abre, e o valor morto já aparece saneado.
  db.prepare('UPDATE automation_template_provenance SET parameters_json = ? WHERE automation_id = ?')
    .run(JSON.stringify({ command: '/melhorar', poolId: 'pool-local', modo: '4k' }), 'melhorar')
  const form = await api.resolver('GET', '/automations/melhorar/reconfigure', contexto())
  check('o formulário abre para o comando desatualizado', form.podeReconfigurar === true, form.motivo)
  const modo = form.parameters.find((p) => p.key === 'modo')
  check('e o campo mostra um valor que existe nesta versão',
    (modo.options || []).includes(modo.value), `${modo.value} em ${JSON.stringify(modo.options)}`)
  db.close()
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\natualizar comando: tudo certo')
