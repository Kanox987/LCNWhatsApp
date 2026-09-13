// Escopos de variável/contador. Centralizado aqui porque três lugares
// precisam concordar sobre a MESMA regra: o avaliador (ao ler e gravar
// durante uma execução), as rotas de /entities (o painel) e a validação de
// documento. Antes disso a regra vivia espalhada em evaluator.js e a
// consequência foi um bug real: gravava-se no remetente e lia-se da conversa,
// então em grupo um contador por pessoa nunca era lido de volta.

export const ESCOPOS = Object.freeze(['contact', 'group', 'group_member', 'category', 'global'])

export const ID_GLOBAL = '__global__'

// O separador não pode aparecer num JID do WhatsApp (que usa dígitos, '-',
// '@', '.' e ':'), senão dois pares grupo/pessoa diferentes colidiriam na
// mesma linha da tabela.
const SEPARADOR_MEMBRO = '|'

export function ehEscopoValido (kind) {
  return ESCOPOS.includes(kind)
}

export function montarIdMembro (grupoId, pessoaId) {
  if (typeof grupoId !== 'string' || !grupoId) return null
  if (typeof pessoaId !== 'string' || !pessoaId) return null
  if (grupoId.includes(SEPARADOR_MEMBRO) || pessoaId.includes(SEPARADOR_MEMBRO)) return null
  return `${grupoId}${SEPARADOR_MEMBRO}${pessoaId}`
}

export function separarIdMembro (scopeId) {
  if (typeof scopeId !== 'string') return null
  const partes = scopeId.split(SEPARADOR_MEMBRO)
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null
  return { groupId: partes[0], memberId: partes[1] }
}

function kindDaConversa (chat) {
  return chat?.kind === 'group' ? 'group' : 'contact'
}

// Quem o comando está mirando: o primeiro mencionado (@fulano) ou, na falta
// de menção, o autor da mensagem citada. É o que faz "/adv @fulano" punir o
// fulano e não quem digitou. Sem alvo, devolve null — e a ação é ignorada em
// vez de cair no remetente por engano, que puniria a pessoa errada.
export function resolverAlvo (evento) {
  const mencionado = evento?.message?.mentions?.[0]
  if (typeof mencionado === 'string' && mencionado) return mencionado
  const citado = evento?.message?.quotedRef?.participant
  if (typeof citado === 'string' && citado) return citado
  return null
}

// Resolve o par (scope_kind, scope_id) que uma ação/condição endereça, a
// partir do escopo declarado no documento e do evento em avaliação. Devolve
// null quando o escopo não faz sentido para este evento — por exemplo
// 'group_member' numa conversa direta, onde não existe "membro de grupo".
// Nunca lança: quem chama decide o que fazer com o null.
export function resolverEscopo (escopoDeclarado, evento, { categoryKey } = {}) {
  switch (escopoDeclarado) {
    case 'chat':
      return { scopeKind: kindDaConversa(evento?.chat), scopeId: evento?.chat?.id || null }
    case 'contact':
    case 'sender':
      return { scopeKind: 'contact', scopeId: evento?.sender?.id || null }
    case 'group':
      return evento?.chat?.kind === 'group'
        ? { scopeKind: 'group', scopeId: evento.chat.id }
        : null
    case 'group_member': {
      if (evento?.chat?.kind !== 'group') return null
      const id = montarIdMembro(evento.chat.id, evento?.sender?.id)
      return id ? { scopeKind: 'group_member', scopeId: id } : null
    }
    case 'target': {
      const alvo = resolverAlvo(evento)
      return alvo ? { scopeKind: 'contact', scopeId: alvo } : null
    }
    case 'target_group_member': {
      if (evento?.chat?.kind !== 'group') return null
      const alvo = resolverAlvo(evento)
      if (!alvo) return null
      const id = montarIdMembro(evento.chat.id, alvo)
      return id ? { scopeKind: 'group_member', scopeId: id } : null
    }
    case 'category':
      return typeof categoryKey === 'string' && categoryKey
        ? { scopeKind: 'category', scopeId: categoryKey }
        : null
    case 'global':
      return { scopeKind: 'global', scopeId: ID_GLOBAL }
    default:
      return null
  }
}

function lerLinhas (db, scopeKind, scopeId) {
  const rows = db.prepare('SELECT key, value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ?')
    .all(scopeKind, scopeId)
  const mapa = Object.create(null)
  for (const row of rows) {
    try { mapa[row.key] = JSON.parse(row.value_json) } catch {}
  }
  return mapa
}

// Monta o ramo de variáveis do contexto de execução. Cada escopo é um mapa
// separado — nunca misturados, senão um contador de grupo sobrescreveria
// silenciosamente o da pessoa. Fica sob contexto.var justamente porque
// contexto.sender/chat já carregam os DADOS do evento (sender.id, chat.kind):
// {{sender.id}} é o remetente, {{var.sender.avisos}} é a variável dele.
export function carregarVariaveis (db, evento) {
  const ler = (escopo) => {
    const alvo = resolverEscopo(escopo, evento)
    return alvo?.scopeId ? lerLinhas(db, alvo.scopeKind, alvo.scopeId) : Object.create(null)
  }

  return {
    chat: ler('chat'),
    sender: ler('contact'),
    member: ler('group_member'),
    target: ler('target'),
    targetMember: ler('target_group_member'),
    global: lerLinhas(db, 'global', ID_GLOBAL),
    // Categoria é sob demanda: carregar todas em todo evento seria varrer a
    // tabela inteira sem saber se alguma automação sequer usa categoria.
    category: Object.create(null)
  }
}

export function carregarCategoria (db, variaveis, categoryKey) {
  if (!variaveis || typeof categoryKey !== 'string' || !categoryKey) return
  if (Object.hasOwn(variaveis.category, categoryKey)) return
  variaveis.category[categoryKey] = lerLinhas(db, 'category', categoryKey)
}

// Espelha em memória o que acabou de ser gravado no banco, para que uma ação
// ou condição seguinte na MESMA cadeia já enxergue o valor novo.
export function aplicarNasVariaveis (variaveis, escopoDeclarado, chave, valor, { categoryKey } = {}) {
  if (!variaveis) return
  switch (escopoDeclarado) {
    case 'chat':
    case 'group':
      // Numa conversa de grupo, a variável do grupo É a variável da conversa.
      variaveis.chat[chave] = valor
      break
    case 'contact':
    case 'sender':
      variaveis.sender[chave] = valor
      break
    case 'group_member':
      variaveis.member[chave] = valor
      break
    case 'target':
      variaveis.target[chave] = valor
      break
    case 'target_group_member':
      variaveis.targetMember[chave] = valor
      break
    case 'category':
      if (typeof categoryKey === 'string' && categoryKey) {
        if (!variaveis.category[categoryKey]) variaveis.category[categoryKey] = Object.create(null)
        variaveis.category[categoryKey][chave] = valor
      }
      break
    case 'global':
      variaveis.global[chave] = valor
      break
  }
}

export function gravarAtributo (db, { scopeKind, scopeId }, chave, valor) {
  db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at`)
    .run(scopeKind, scopeId, chave, JSON.stringify(valor), new Date().toISOString())
}

export class ErroDeContador extends Error {}

// Incremento ATÔMICO: uma operação só de banco, nunca "ler em JS, somar,
// gravar". Ausente começa em zero; valor existente que não seja inteiro é
// erro explícito, jamais conversão silenciosa (um "abc" virando 1 esconderia
// um erro de configuração até alguém ser removido de um grupo por engano).
export function incrementarAtributo (db, { scopeKind, scopeId }, chave, passo) {
  if (!Number.isSafeInteger(passo)) throw new ErroDeContador('O passo do contador precisa ser um número inteiro.')

  const atual = db.prepare('SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .get(scopeKind, scopeId, chave)

  if (atual) {
    let valor
    try { valor = JSON.parse(atual.value_json) } catch { valor = undefined }
    if (!Number.isSafeInteger(valor)) {
      throw new ErroDeContador(`A variável "${chave}" guarda um valor que não é número inteiro — não dá pra somar nela.`)
    }
  }

  // Uma operação só: insere com o passo (partindo de zero) ou soma sobre a
  // linha existente. value_json guarda o número como texto JSON puro ("3"),
  // que é exatamente o que JSON.parse devolve como número na leitura.
  const resultado = db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
    VALUES (:kind, :id, :key, :valor, :agora)
    ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
      value_json = printf('%d', CAST(entity_attributes.value_json AS INTEGER) + :passo),
      updated_at = excluded.updated_at
    RETURNING value_json`)
    .get({ kind: scopeKind, id: scopeId, key: chave, valor: String(passo), agora: new Date().toISOString(), passo })
  const novo = Number(resultado?.value_json)
  if (!Number.isSafeInteger(novo)) throw new ErroDeContador('O contador passou do limite seguro de número inteiro.')
  return novo
}
