import { ErroHttp } from '../transport.js'
import { automacaoRespondeNaConversa, grupoAtivo } from '../evaluator.js'
import { FORMATOS, alvoDeConfig, apagarConfigDeMenu, gravarConfigDeMenu, lerConfigDeMenu, limparConfigDeMenu, resolverConfigDeMenu } from '../menuConfig.js'

const ALVOS = ['group_default', 'direct_default', 'group', 'contact']

function exigirAlvo (kind, id) {
  if (!ALVOS.includes(kind)) {
    throw new ErroHttp(400, `Alvo de menu inválido. Use um destes: ${ALVOS.join(', ')}.`)
  }
  const alvo = alvoDeConfig(kind, id)
  if (!alvo) throw new ErroHttp(400, 'Para configurar um grupo ou contato específico, informe o id dele.')
  return alvo
}

// A aba Menu saiu do painel: GRAVAR a configuração é pelo comando
// `configura menu` (action.menu.config no avaliador). O painel ainda usa duas
// coisas daqui, na aba Dados de cada conversa: ver o que vale nela (leitura) e
// apagar a configuração própria dela, que é o único jeito de limpar uma linha
// de uma conversa onde o comando não roda mais (o bot saiu do grupo, id
// errado). O PUT fica como API do motor; o BFF não o repassa.
export function registrarRotasMenu (roteador, db) {
  const menusAoVivo = db.prepare(`
    SELECT a.id AS automation_id, a.active_revision_id AS revision_id, r.doc_json
    FROM automations a
    JOIN automation_revisions r ON r.id = a.active_revision_id
    WHERE a.enabled = 1 AND a.active_revision_id IS NOT NULL AND a.deployment_mode = 'live'
    ORDER BY a.id
  `)

  // Como o menu VAI SAIR numa conversa específica, já com a cascata aplicada
  // (config da conversa > padrão do tipo > o que o documento do menu traz >
  // padrão do código), para quem chama não precisar adivinhar qual
  // configuração venceu — e sem mandar /menu na conversa, o que num grupo
  // publicaria o menu para todo mundo.
  //
  // `config` é a cascata sem o documento (o que valia antes). `menus` traz uma
  // por automação de menu no ar QUE RESPONDE NESTA CONVERSA (escopo casa e
  // não está desligada aqui — as mesmas perguntas do avaliador), com o que o
  // documento dela define (`doDocumento`). `propria` e `padraoDoTipo` são os dois níveis
  // gravados, crus, para a tela mostrar de onde veio cada coisa. `grupoAtivo`
  // diz se o bot responde neste grupo (no privado, sempre true).
  roteador.get('/menu-config/effective', ({ query }) => {
    const chatId = query?.get('chatId')
    const chatKind = query?.get('chatKind') === 'group' ? 'group' : 'direct'
    if (!chatId) throw new ErroHttp(400, 'Informe chatId para ver a configuração efetiva.')
    const chat = { id: chatId, kind: chatKind }
    const menus = []
    for (const linha of menusAoVivo.all()) {
      let doc = null
      try { doc = JSON.parse(linha.doc_json) } catch { continue }
      if (!(doc?.flow?.nodes || []).some((no) => no?.type === 'action.menu.render')) continue
      if (!automacaoRespondeNaConversa(db, { automationId: linha.automation_id, revisionId: linha.revision_id, documento: doc }, chat)) continue
      for (const no of doc?.flow?.nodes || []) {
        if (no?.type !== 'action.menu.render') continue
        menus.push({
          automationId: linha.automation_id,
          name: doc.name || linha.automation_id,
          config: resolverConfigDeMenu(db, chat, no.config || {}),
          doDocumento: limparConfigDeMenu(no.config || {})
        })
      }
    }
    return {
      chatId,
      chatKind,
      grupoAtivo: grupoAtivo(db, chat),
      config: resolverConfigDeMenu(db, chat),
      menus,
      propria: lerConfigDeMenu(db, alvoDeConfig(chatKind === 'group' ? 'group' : 'contact', chatId)),
      padraoDoTipo: lerConfigDeMenu(db, alvoDeConfig(chatKind === 'group' ? 'group_default' : 'direct_default'))
    }
  })

  roteador.get('/menu-config/:kind', ({ params, query }) => {
    const alvo = exigirAlvo(params.kind, query?.get('id'))
    return { kind: params.kind, id: query?.get('id') || null, config: lerConfigDeMenu(db, alvo) }
  })

  roteador.put('/menu-config/:kind', ({ params, query, body }) => {
    const alvo = exigirAlvo(params.kind, query?.get('id') || body?.id)
    if (body?.format !== undefined && !FORMATOS.includes(body.format)) {
      throw new ErroHttp(400, `Formato de menu inválido. Use ${FORMATOS.join(' ou ')}.`)
    }
    return { kind: params.kind, config: gravarConfigDeMenu(db, alvo, body || {}) }
  })

  roteador.delete('/menu-config/:kind', ({ params, query }) => {
    const alvo = exigirAlvo(params.kind, query?.get('id'))
    return { removed: apagarConfigDeMenu(db, alvo) }
  })
}
