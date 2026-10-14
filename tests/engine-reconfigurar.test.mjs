// Reconfigurar um comando já instalado, sem abrir arquivo nenhum.
//
// O pedido do dono: quem ESCREVE o comando declara o formulário (bloco
// `configurável` do .lcn); quem USA preenche pelo painel, e pode voltar depois
// e mudar — "sem precisar mudar nos arquivos toda vez".
//
// As duas metades já existiam e ninguém tinha ligado: o esquema vive no
// template, os valores da instalação em automation_template_provenance. E
// `src/reconfiguracao.js` estava escrito, correto, e órfão — sem rota, sem
// tela e sem teste.
//
// O PERIGO é o que a maior parte destes casos guarda: regerar o documento a
// partir do template DESCARTA qualquer edição feita à mão depois da instalação.
// Por isso nada é regerado antes de conferir, e quando o documento divergiu, o
// formulário se fecha dizendo o que mudou — nunca apaga em silêncio.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const agora = new Date().toISOString()

async function capturarErro (method, pathname, body) {
  try {
    await api.resolver(method, pathname, contexto(body))
    return null
  } catch (erro) {
    return erro
  }
}

const comandoDe = (doc) => doc.flow.nodes.find((n) => n.type === 'trigger.command')?.config?.command

try {
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)

  await api.resolver('POST', '/templates/ping/install', contexto({
    automationIds: { ping: 'meu-ping' },
    parameters: { ping: { command: '/antes', poolId: 'p' } },
    scope: { include: [{ kind: 'contact', id: '5511@s.whatsapp.net' }] }
  }))

  // --- o formulário abre com os valores ATUAIS -----------------------------
  const form = await api.resolver('GET', '/automations/meu-ping/reconfigure', contexto())
  check('o formulário abre para automação vinda de template', form.podeReconfigurar === true, form.motivo)
  const campoComando = form.parameters.find((p) => p.key === 'command')
  check('e cada campo traz o valor ATUAL, não o padrão do template',
    campoComando?.value === '/antes', campoComando?.value)
  check('e traz o rótulo declarado no .lcn, para a tela não inventar nome', typeof campoComando?.label === 'string')

  // --- aplicar troca o valor e republica -----------------------------------
  await api.resolver('PUT', '/automations/meu-ping/reconfigure', contexto({
    parameters: { command: '/depois', poolId: 'p' }
  }))
  const depois = await api.resolver('GET', '/automations/meu-ping', contexto())
  const ativa = await api.resolver('GET', `/automations/meu-ping/revisions/${depois.draft.revision}`, contexto())
  check('o comando mudou no documento publicado', comandoDe(ativa.document) === '/depois', comandoDe(ativa.document))
  check('e a automação continua publicada (não ficou como rascunho solto)', depois.activeRevisionId !== null)

  // O escopo é o campo que mais dói perder: lista vazia nunca casa com
  // ninguém, então regerá-lo do template deixaria a automação inerte sem que
  // ninguém entendesse por quê.
  check('o destino escolhido na instalação SOBREVIVE à reconfiguração',
    ativa.document.scope.include[0]?.id === '5511@s.whatsapp.net', JSON.stringify(ativa.document.scope))

  // --- a proveniência acompanha, senão o formulário mente na próxima vez ---
  const prov = await api.resolver('GET', '/automations/meu-ping/provenance', contexto())
  check('a proveniência guarda os valores NOVOS', prov.parameters.command === '/depois', prov.parameters.command)
  const form2 = await api.resolver('GET', '/automations/meu-ping/reconfigure', contexto())
  check('e reabrir o formulário mostra o valor novo',
    form2.parameters.find((p) => p.key === 'command')?.value === '/depois')
  check('e ele continua reconfigurável depois de reconfigurado', form2.podeReconfigurar === true, form2.motivo)

  // --- valor fora da lista de um enum não passa ----------------------------
  await api.resolver('POST', '/templates/auto-download/install', contexto({
    automationIds: { 'auto-download': 'auto-dow' },
    parameters: { 'auto-download': { poolId: 'p' } },
    scope: { include: [{ kind: 'tagged', id: 'auto_download' }] }
  }))
  const foraDaLista = await capturarErro('PUT', '/automations/auto-dow/reconfigure', {
    parameters: { allowFrom: 'any', modo: 'gif', ackText: 'a', errorText: 'b', poolId: 'p' }
  })
  check('reconfigurar com valor fora da lista do enum -> 400', foraDaLista?.status === 400, foraDaLista?.message)

  // --- e o caso que o módulo existe para proteger --------------------------
  const antesDaEdicao = await api.resolver('GET', '/automations/meu-ping', contexto())
  const docEditado = JSON.parse(JSON.stringify(antesDaEdicao.draft.document))
  docEditado.flow.nodes.find((n) => n.type === 'action.whatsapp.reply').config.text = 'resposta escrita à mão'
  await api.resolver('PUT', '/automations/meu-ping/draft', contexto({ document: docEditado }))
  await api.resolver('POST', '/automations/meu-ping/publish', contexto())

  const fechado = await api.resolver('GET', '/automations/meu-ping/reconfigure', contexto())
  check('automação editada à mão FECHA o formulário', fechado.podeReconfigurar === false)
  check('e o motivo diz o que divergiu, em vez de só negar',
    Array.isArray(fechado.divergencias) && fechado.divergencias.length > 0, JSON.stringify(fechado.divergencias))

  const recusado = await capturarErro('PUT', '/automations/meu-ping/reconfigure', {
    parameters: { command: '/outro', poolId: 'p' }
  })
  check('e aplicar mesmo assim é recusado (409), não sobrescreve', recusado?.status === 409, String(recusado?.status))
  const intacta = await api.resolver('GET', '/automations/meu-ping', contexto())
  check('a edição à mão continua lá, intacta',
    intacta.draft.document.flow.nodes.find((n) => n.type === 'action.whatsapp.reply').config.text === 'resposta escrita à mão')

  // --- automação que não veio de template ----------------------------------
  await api.resolver('POST', '/automations', contexto({
    id: 'na-mao',
    document: {
      schemaVersion: 1,
      enabled: true,
      name: 'Na mão',
      scope: { include: [{ kind: 'everywhere' }], exclude: [] },
      inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
      responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
      flow: {
        nodes: [
          { id: 'g', type: 'trigger.command', config: { command: '/x', match: 'exact', allowFrom: 'any' } },
          { id: 'r', type: 'action.whatsapp.reply', config: { text: 'y' } }
        ],
        edges: [{ from: 'g', to: 'r', on: 'matched' }]
      }
    }
  }))
  const semTemplate = await api.resolver('GET', '/automations/na-mao/reconfigure', contexto())
  check('automação feita à mão não tem formulário, e diz isso', semTemplate.podeReconfigurar === false)
  check('sem quebrar: devolve lista de campos vazia', Array.isArray(semTemplate.parameters))

  const inexistente = await capturarErro('GET', '/automations/nao-existe/reconfigure', null)
  check('automação inexistente -> 404', inexistente?.status === 404)

  // --- O TEMPLATE MUDOU, e isso não é culpa de quem instalou ---------------
  //
  // A comparação de documento sozinha não distingue "editado à mão" de "o
  // template é outro agora", e a tela acusava a pessoa nos dois casos. Medido
  // no ar: o `figurinha` passou de v1 para v2 quando ganhou tamanho, segundos,
  // qualidade e peso, e o formulário fechou dizendo "você alterou à mão" — com
  // o efeito de deixar os campos NOVOS inalcançáveis exatamente para quem já
  // tinha o comando instalado.
  //
  // A versão da instalação está guardada; é ela que responde o que a diferença
  // de documento não responde.
  const versaoGuardada = (id) => db.prepare('SELECT template_version FROM automation_template_provenance WHERE automation_id = ?').get(id)?.template_version
  const fingirVersaoAntiga = (id) => db.prepare('UPDATE automation_template_provenance SET template_version = 0 WHERE automation_id = ?').run(id)

  {
    // O caso duro: versão antiga E documento divergente (o `meu-ping` foi
    // editado à mão nos casos acima). Não há como saber se a divergência vem
    // do template novo ou da edição — o template antigo não existe mais no
    // catálogo. Então não se adivinha: abre, e diz o que salvar vai fazer.
    fingirVersaoAntiga('meu-ping')
    const r = await api.resolver('GET', '/automations/meu-ping/reconfigure', contexto())
    check('template em versão nova ABRE o formulário, em vez de acusar',
      r.podeReconfigurar === true, r.motivo)
    check('e não sobra acusação nenhuma de edição à mão',
      !/alterada à mão/.test(r.motivo || ''), r.motivo)
    check('o aviso diz as duas versões, a instalada e a do catálogo',
      /versão 0/.test(r.aviso || '') && /1/.test(String(r.versaoDoCatalogo)),
      `${r.versaoInstalada} -> ${r.versaoDoCatalogo}`)
    // Honestidade sobre o que não se sabe: pode haver edição à mão por baixo.
    check('e avisa que uma edição à mão por baixo se perderia',
      /se perde/.test(r.aviso || ''), r.aviso)
    check('a tela recebe a versão do catálogo para mostrar', r.templateVersion === 1, String(r.templateVersion))

    // E aplicar FUNCIONA — é o ponto: era isto que estava bloqueado.
    await api.resolver('PUT', '/automations/meu-ping/reconfigure', contexto({
      parameters: { command: '/depois-da-versao', poolId: 'p' }
    }))
    const ativa = await api.resolver('GET', '/automations/meu-ping', contexto())
    check('salvar com o template novo publica o valor novo',
      comandoDe(ativa.draft.document) === '/depois-da-versao', comandoDe(ativa.draft.document))
    // Sem isto o aviso voltaria para sempre, mesmo depois de adotada a versão.
    check('e a proveniência passa a guardar a versão do catálogo',
      versaoGuardada('meu-ping') === 1, String(versaoGuardada('meu-ping')))

    const depois = await api.resolver('GET', '/automations/meu-ping/reconfigure', contexto())
    check('reabrindo, o aviso de versão já não aparece', !depois.aviso, depois.aviso)
  }

  {
    // Versão antiga e documento IGUAL ao que o template produz: nada da pessoa
    // está em jogo, e o aviso precisa dizer isso em vez de assustar.
    fingirVersaoAntiga('meu-ping')
    const r = await api.resolver('GET', '/automations/meu-ping/reconfigure', contexto())
    check('sem divergência, o aviso não ameaça perder nada',
      r.podeReconfigurar === true && /nada seu se perde/.test(r.aviso || ''), r.aviso)
  }
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE RECONFIGURAÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
