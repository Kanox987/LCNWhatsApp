// Configuração do /menu por conversa.
//
// O pedido: cada grupo pode ter o SEU menu, e o privado pode ter outro — tanto
// no texto quanto no formato (lista de texto simples ou mensagem interativa
// com botões). Nenhum dos bots de referência tem isso; lá o menu é único.
//
// Guardado em entity_attributes numa chave reservada, pelo mesmo motivo dos
// donos: reaproveita CRUD, tela e escopos que já existem, em vez de criar mais
// uma tabela para guardar quatro campos.
import { ID_GLOBAL } from './attributeScopes.js'

export const CHAVE_MENU = '__menu_config__'
export const CHAVE_MENU_PADRAO_GRUPO = '__menu_default_group__'
export const CHAVE_MENU_PADRAO_PRIVADO = '__menu_default_direct__'

export const FORMATOS = Object.freeze(['text', 'interactive'])

const PADRAO = Object.freeze({
  format: 'text',
  header: 'Comandos disponíveis:',
  footer: '',
  emptyText: 'Nenhum comando disponível por aqui ainda.',
  buttonTitle: 'Ver comandos'
})

function lerJson (db, scopeKind, scopeId, chave) {
  const linha = db.prepare('SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .get(scopeKind, scopeId, chave)
  if (!linha) return null
  try {
    const valor = JSON.parse(linha.value_json)
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : null
  } catch {
    return null
  }
}

// Só campos conhecidos entram, e cada um com o tipo certo. Um valor
// adulterado no banco vira "campo ausente", nunca um menu quebrado.
function limpar (bruto) {
  if (!bruto) return {}
  const limpo = {}
  if (FORMATOS.includes(bruto.format)) limpo.format = bruto.format
  if (typeof bruto.numbered === 'boolean') limpo.numbered = bruto.numbered
  for (const campo of ['header', 'footer', 'emptyText', 'buttonTitle']) {
    if (typeof bruto[campo] === 'string') limpo[campo] = bruto[campo]
  }
  const familias = limparFamilias(bruto.families)
  if (familias !== undefined) limpo.families = familias
  return limpo
}

// O que um documento de menu define, só com os campos que a cascata usa —
// para a aba Dados dizer "veio do comando de menu" sem adivinhar.
export const limparConfigDeMenu = limpar

// AS FAMÍLIAS QUE O MENU MOSTRA NESTA CONVERSA.
//
// Ausente = herda do nível de cima; e se ninguém disser nada, o menu mostra
// todas — padrão não é teto, nem trava. `'*'` diz "todas" de propósito, para
// um grupo específico desfazer a restrição do padrão dos grupos. Uma lista
// diz exatamente quais. Aceita texto com vírgula pelo mesmo motivo de
// `familias.js`: quem escreve à mão pela aba Dados escreve texto.
// Sem acento e com hífen no lugar de espaço: quem escreve "Módulos
// especializados" quer a família `modulos-especializados` do catálogo.
export const normalizarFamilia = (texto) => String(texto ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/[\s_-]+/g, '-')

function limparFamilias (bruto) {
  if (bruto === '*' || (typeof bruto === 'string' && normalizarFamilia(bruto) === 'todas')) return '*'
  const lista = Array.isArray(bruto) ? bruto : typeof bruto === 'string' ? bruto.split(',') : null
  if (!lista) return undefined
  const limpas = [...new Set(lista.filter((f) => typeof f === 'string').map(normalizarFamilia).filter(Boolean))]
  return limpas
}

/**
 * As famílias que o menu daquela configuração mostra, já normalizadas, ou
 * `null` quando mostra todas.
 */
export function familiasDoMenu (config) {
  return Array.isArray(config?.families) ? new Set(config.families.map(normalizarFamilia)) : null
}

// O que alguém escreve depois do comando de configurar a numeração. Devolve
// `null` para o que não é sim nem não — quem chama responde pedindo de novo,
// em vez de adivinhar.
const SIM = new Set(['sim', 's', 'true', '1', 'liga', 'ligar', 'ligado', 'numerar'])
const NAO = new Set(['não', 'nao', 'n', 'false', '0', 'desliga', 'desligar', 'desligado'])
export function lerNumeracao (texto) {
  const palavra = String(texto ?? '').trim().toLowerCase()
  if (SIM.has(palavra)) return true
  if (NAO.has(palavra)) return false
  return null
}

// O formato como alguém escreve no WhatsApp. Aceita as mesmas palavras que a
// linguagem usa no `mostra menu` ("texto", "com botões") e o código interno
// ("text", "interactive"). `null` para o resto.
const semAcento = (texto) => String(texto ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim().toLowerCase().replace(/\s+/g, ' ')
const FORMATO_POR_PALAVRA = Object.freeze({
  text: 'text', texto: 'text', 'so texto': 'text',
  interactive: 'interactive', 'com botoes': 'interactive', botoes: 'interactive',
  interativo: 'interactive', lista: 'interactive'
})
export function lerFormato (texto) {
  return FORMATO_POR_PALAVRA[semAcento(texto)] || null
}

export const CAMPOS_DE_TEXTO = Object.freeze(['header', 'footer', 'emptyText', 'buttonTitle'])

// O VALOR QUE O COMANDO `configura menu` VAI GRAVAR, a partir do que a pessoa
// escreveu depois dele. Devolve um de três:
//   { valor }   grava este valor no nível escolhido
//   { herdar }  tira SÓ este campo do nível, que volta a seguir o de cima
//   { erro }    não grava nada; o texto explica o que escrever
//
// Duas palavras são especiais, porque sem elas o comando não alcançava o que a
// aba Menu alcançava:
//   - "herdar" devolve um campo só à herança (a aba tinha "Herdar" por campo;
//     "volta ao padrão" apaga o nível inteiro, outros campos junto).
//   - "em branco" grava '' num campo de texto: rodapé vazio mesmo quando o
//     padrão tem rodapé, e o texto de vazio em branco, que quer dizer "não
//     responda nada". Comando sem nada depois só mostra o jeito de usar.
// Quem quiser gravar literalmente a palavra "herdar" ou "em branco" põe entre
// aspas; aspas sem nada dentro também gravam em branco.
export function valorDoComando (campo, argumento) {
  const bruto = String(argumento ?? '').trim()
  const palavra = semAcento(bruto)
  if (palavra === 'herdar') return { herdar: true }

  if (CAMPOS_DE_TEXTO.includes(campo)) {
    const entreAspas = bruto.match(/^["“”](.*)["“”]$/s)
    if (entreAspas) return { valor: entreAspas[1] }
    if (palavra === 'em branco') return { valor: '' }
    return { valor: bruto }
  }
  if (campo === 'format') {
    const formato = lerFormato(bruto)
    return formato ? { valor: formato } : { erro: 'Formato: escreva texto ou com botões depois do comando (ou herdar, para seguir o padrão).' }
  }
  if (campo === 'numbered') {
    const numerar = lerNumeracao(bruto)
    return numerar === null ? { erro: 'Numeração: escreva sim ou não depois do comando (ou herdar, para seguir o padrão).' } : { valor: numerar }
  }
  // `families`: o texto vai como foi escrito; `limpar` separa por vírgula,
  // normaliza e entende "todas".
  return { valor: bruto }
}

// O que explicar quando o comando vem sem nada depois, conforme o campo.
export function usoDoCampo (campo, comOutraConversa = false) {
  const antes = comOutraConversa ? 'o número ou o id da conversa e depois ' : ''
  const textos = {
    header: 'o cabeçalho novo',
    footer: 'o rodapé novo',
    emptyText: 'o texto para quando não houver comando',
    buttonTitle: 'o título novo do botão',
    format: 'o formato: texto ou com botões',
    numbered: 'sim ou não',
    families: 'as famílias, separadas por vírgula, ou todas'
  }
  // Só chega aqui com outra conversa: nos outros alvos, voltar ao padrão não
  // precisa de nada depois do comando.
  if (campo === 'reset') return 'Escreva depois do comando o número ou o id da conversa que volta ao padrão.'
  const extra = CAMPOS_DE_TEXTO.includes(campo)
    ? ' Escreva "em branco" para deixar vazio, ou "herdar" para voltar a seguir o padrão.'
    : ' Ou escreva "herdar" para voltar a seguir o padrão.'
  return `Escreva depois do comando ${antes}${textos[campo] || 'o valor novo'}.${extra}`
}

// Uma conversa indicada pelo que alguém digitou: o id inteiro (de grupo ou de
// contato) ou só o número, que vira contato. Mesmas formas que o destino de
// um comando aceita (`resolverDestinoConfigurado` no avaliador).
export function alvoDaConversa (texto) {
  const limpo = String(texto ?? '').trim()
  if (!limpo) return null
  if (/@g\.us$/.test(limpo)) return { scopeKind: 'group', scopeId: limpo, key: CHAVE_MENU }
  if (/@(s\.whatsapp\.net|lid)$/.test(limpo)) return { scopeKind: 'contact', scopeId: limpo, key: CHAVE_MENU }
  if (!/^\+?[\d().-]+$/.test(limpo)) return null
  const digitos = limpo.replace(/\D/g, '')
  return digitos.length >= 8 ? { scopeKind: 'contact', scopeId: `${digitos}@s.whatsapp.net`, key: CHAVE_MENU } : null
}

// Cascata, do mais específico para o mais geral:
//   1. a configuração daquela conversa exata (este grupo, este contato)
//   2. o padrão do tipo de conversa (todos os grupos / todo o privado)
//   3. o que o próprio nó action.menu.render trouxer no documento
//   4. o padrão do código
// Assim dá para ter um menu diferente num grupo específico sem precisar
// configurar todos os outros.
export function resolverConfigDeMenu (db, chat, configDoNo = {}) {
  const ehGrupo = chat?.kind === 'group'
  const scopeKind = ehGrupo ? 'group' : 'contact'
  const especifica = chat?.id ? limpar(lerJson(db, scopeKind, chat.id, CHAVE_MENU)) : {}
  const chavePadrao = ehGrupo ? CHAVE_MENU_PADRAO_GRUPO : CHAVE_MENU_PADRAO_PRIVADO
  const padraoDoTipo = limpar(lerJson(db, 'global', ID_GLOBAL, chavePadrao))
  const doNo = limpar(configDoNo)

  return { ...PADRAO, ...doNo, ...padraoDoTipo, ...especifica }
}

export function gravarConfigDeMenu (db, alvo, config) {
  const limpo = limpar(config)
  db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
      value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run(alvo.scopeKind, alvo.scopeId, alvo.key, JSON.stringify(limpo), new Date().toISOString())
  return limpo
}

export function lerConfigDeMenu (db, alvo) {
  return limpar(lerJson(db, alvo.scopeKind, alvo.scopeId, alvo.key))
}

export function apagarConfigDeMenu (db, alvo) {
  return db.prepare('DELETE FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .run(alvo.scopeKind, alvo.scopeId, alvo.key).changes > 0
}

// Traduz o alvo vindo da API para a linha real da tabela. Os dois padrões
// moram no escopo 'global' (que o CHECK aceita) em chaves diferentes — o
// "tipo" só existe na API, nunca como scope_kind inventado no banco.
export function alvoDeConfig (kind, id) {
  if (kind === 'group_default') return { scopeKind: 'global', scopeId: ID_GLOBAL, key: CHAVE_MENU_PADRAO_GRUPO }
  if (kind === 'direct_default') return { scopeKind: 'global', scopeId: ID_GLOBAL, key: CHAVE_MENU_PADRAO_PRIVADO }
  if (kind === 'group' && id) return { scopeKind: 'group', scopeId: id, key: CHAVE_MENU }
  if (kind === 'contact' && id) return { scopeKind: 'contact', scopeId: id, key: CHAVE_MENU }
  return null
}
