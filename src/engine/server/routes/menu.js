import { ErroHttp } from '../transport.js'
import { FORMATOS, alvoDeConfig, apagarConfigDeMenu, gravarConfigDeMenu, lerConfigDeMenu, resolverConfigDeMenu } from '../menuConfig.js'

const ALVOS = ['group_default', 'direct_default', 'group', 'contact']

function exigirAlvo (kind, id) {
  if (!ALVOS.includes(kind)) {
    throw new ErroHttp(400, `Alvo de menu inválido. Use um destes: ${ALVOS.join(', ')}.`)
  }
  const alvo = alvoDeConfig(kind, id)
  if (!alvo) throw new ErroHttp(400, 'Para configurar um grupo ou contato específico, informe o id dele.')
  return alvo
}

export function registrarRotasMenu (roteador, db) {
  // Como o menu VAI SAIR numa conversa específica, já com a cascata aplicada
  // (config da conversa > padrão do tipo > padrão do sistema). É o que a UI
  // mostra como pré-visualização, para a pessoa não precisar adivinhar qual
  // configuração venceu.
  roteador.get('/menu-config/effective', ({ query }) => {
    const chatId = query?.get('chatId')
    const chatKind = query?.get('chatKind') === 'group' ? 'group' : 'direct'
    if (!chatId) throw new ErroHttp(400, 'Informe chatId para ver a configuração efetiva.')
    return { chatId, chatKind, config: resolverConfigDeMenu(db, { id: chatId, kind: chatKind }) }
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
