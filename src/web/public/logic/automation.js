const MATCH_LABELS = {
  exact: 'exatamente igual',
  prefix: 'começa com',
  keyword: 'contém a palavra isolada',
  exact_or_args: 'igual ou seguido de argumentos'
}

export function suggestAutomationId (name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function emptyScopeBlocksSave (scopeInclude) {
  return !Array.isArray(scopeInclude) || scopeInclude.length === 0
}

export function buildAutomationDocument (state) {
  const include = Array.isArray(state.scopeInclude)
    ? state.scopeInclude.map(({ kind, id }) => ({ kind, id }))
    : []
  const menuLabel = String(state.menuLabel || '').trim()
  const menuDescription = String(state.menuDescription || '').trim()
  const display = menuLabel || menuDescription
    ? { ...(menuLabel ? { menuLabel } : {}), ...(menuDescription ? { menuDescription } : {}) }
    : null
  return {
    schemaVersion: 1,
    id: String(state.id || '').trim(),
    revision: Number.isInteger(state.revision) && state.revision > 0 ? state.revision : 1,
    enabled: Boolean(state.enabled),
    name: String(state.name || '').trim(),
    ...(display ? { display } : {}),
    scope: { include, exclude: [] },
    inputPolicy: {
      acceptedMessageKinds: ['text'],
      historyPolicy: 'live_only'
    },
    responder: {
      strategy: 'weighted_rendezvous',
      poolId: String(state.poolId || '').trim()
    },
    flow: {
      nodes: [
        {
          id: 'gatilho-comando',
          type: 'trigger.command',
          config: {
            command: String(state.command || '').trim(),
            match: state.match || 'exact_or_args',
            allowFrom: 'external'
          }
        },
        {
          id: 'resposta-whatsapp',
          type: 'action.whatsapp.reply',
          config: { text: String(state.replyText || '').trim() }
        }
      ],
      edges: [{ from: 'gatilho-comando', to: 'resposta-whatsapp', on: 'matched' }]
    }
  }
}

export function automationSummary (state) {
  const places = Array.isArray(state.scopeInclude) ? state.scopeInclude : []
  const placeLabels = places.map((item) => item.label || item.id)
  return [
    `A automação "${state.name || 'sem nome'}" usa o identificador "${state.id || 'não definido'}".`,
    `Ela executa quando uma mensagem ${MATCH_LABELS[state.match] || 'corresponde a'} "${state.command || 'comando não definido'}".`,
    places.length
      ? `Pode executar em ${places.length} destino(s): ${placeLabels.join(', ')}.`
      : 'Não há contatos ou grupos autorizados; o salvamento deve permanecer bloqueado.',
    `A resposta sai pelo pool "${state.poolId || 'não definido'}".`,
    `O texto enviado será: "${state.replyText || 'não definido'}".`,
    state.menuLabel
      ? `Vai aparecer no comando /menu como "${state.menuLabel}"${state.menuDescription ? ` — ${state.menuDescription}` : ''}.`
      : 'Não vai aparecer no comando /menu (nenhum rótulo definido).',
    state.enabled ? 'Depois de publicada, ficará habilitada.' : 'Depois de publicada, ficará pausada.'
  ]
}

// O assistente sabe montar UMA forma só: um comando digitado que responde um
// texto. Tudo que ele gera passa por `buildAutomationDocument`, que emite
// exatamente dois nós fixos.
//
// Isso vira DESTRUIÇÃO quando a automação aberta tem outra forma: abrir um
// anti-link, uma figurinha ou uma regra de download e salvar reescreveria o
// documento como um comando vazio respondendo texto vazio — a regra some sem
// aviso, e quem salvou só queria trocar o nome.
//
// Por isso esta análise existe ANTES da tela: documento que o assistente não
// consegue reproduzir fielmente é aberto em SOMENTE LEITURA. Perder capacidade
// de edição é chato; perder a automação em silêncio é inaceitável.
export function analisarForma (documento) {
  const nos = documento?.flow?.nodes
  if (!Array.isArray(nos) || !nos.length) return { suportada: false, motivo: 'O documento não tem nenhum passo.' }

  const gatilhos = nos.filter((n) => typeof n?.type === 'string' && n.type.startsWith('trigger.'))
  const gatilho = gatilhos[0]

  if (gatilhos.length !== 1) {
    return { suportada: false, motivo: 'A automação tem mais de um gatilho.' }
  }
  if (gatilho?.type !== 'trigger.command') {
    return { suportada: false, motivo: 'Esta automação começa sozinha, sem alguém digitar um comando — o assistente só monta comando digitado.' }
  }
  if (nos.length !== 2) {
    return { suportada: false, motivo: `A automação tem ${nos.length} passos, e o assistente só monta dois (o comando e uma resposta de texto).` }
  }

  const acao = nos.find((n) => n !== gatilho)
  if (acao?.type !== 'action.whatsapp.reply') {
    return { suportada: false, motivo: 'A automação faz algo além de responder texto, e o assistente ainda não sabe montar isso.' }
  }

  const tipos = documento?.inputPolicy?.acceptedMessageKinds
  if (!Array.isArray(tipos) || tipos.length !== 1 || tipos[0] !== 'text') {
    return { suportada: false, motivo: 'A automação olha outros tipos de mensagem além de texto.' }
  }
  if (gatilho.config?.allowFrom && gatilho.config.allowFrom !== 'external') {
    return { suportada: false, motivo: 'A automação também responde às mensagens do próprio número, e o assistente ainda não tem esse campo.' }
  }
  if (gatilho.config?.requireOwner === true) {
    return { suportada: false, motivo: 'A automação é restrita ao dono, e o assistente ainda não tem esse campo.' }
  }
  if (Array.isArray(documento?.scope?.exclude) && documento.scope.exclude.length) {
    return { suportada: false, motivo: 'A automação tem destinos EXCLUÍDOS, e o assistente só sabe listar os autorizados.' }
  }
  return { suportada: true, motivo: null }
}

export function stateFromDocument (document, labels = new Map()) {
  const trigger = document?.flow?.nodes?.find((node) => node.type === 'trigger.command')
  const reply = document?.flow?.nodes?.find((node) => node.type === 'action.whatsapp.reply')
  return {
    id: document?.id || '',
    revision: document?.revision || 1,
    enabled: Boolean(document?.enabled),
    name: document?.name || '',
    menuLabel: document?.display?.menuLabel || '',
    menuDescription: document?.display?.menuDescription || '',
    command: trigger?.config?.command || '',
    match: trigger?.config?.match || 'exact_or_args',
    scopeInclude: (document?.scope?.include || []).map((item) => ({ ...item, label: labels.get(item.id) || item.id })),
    poolId: document?.responder?.poolId || '',
    replyText: reply?.config?.text || '',
    // Vai junto do estado para a tela decidir se abre para edição ou só para
    // leitura — a decisão não pode depender de quem chama lembrar de perguntar.
    ...analisarForma(document)
  }
}
