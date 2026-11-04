// O /menu como automação COMUM — substitui o nativeAutomations.js.
//
// Antes, o /menu era uma automação `native = 1`, e isso lhe dava três
// privilégios que nenhuma automação do usuário tem: pulava a checagem de
// escopo no avaliador, ficava fora das três listagens do painel (então não
// era editável nem removível pela tela) e ficava fora do conferidor de
// conflitos de comando. Mais um quarto, por tabela: o pool dela era o
// `__native__`, que o painel mostra mas não deixa editar nem apagar.
//
// Nada disso era necessário. A medição que motivou a troca:
//   - `refCasa` já tem `case 'everywhere'` nas quatro camadas (schema,
//     vocabulário, painel e avaliador), então o escopo "qualquer conversa"
//     é escrevível por qualquer usuário — o bypass de escopo era privilégio
//     sem razão técnica;
//   - `menu.lcn` já existe no catálogo como template editável v2, com bloco
//     `configurável` completo (comando, quem aciona, cabeçalho, numeração,
//     texto de vazio e pool), e `config-menu.lcn` entrega a configuração
//     pelo WhatsApp. Instalar, editar e criar um menu alternativo já eram
//     possíveis pelo painel;
//   - todas as rotas POR ID de `routes/automations.js` (GET, DELETE, draft,
//     publish, unpublish, enabled, deployment-mode) nunca filtraram por
//     `native`, então desativar e remover já funcionavam pela API. O que
//     faltava era a tela — e sobreviver ao reinício.
//
// O QUE FALTAVA DE VERDADE, e é o que esta troca conserta: o código antigo
// fazia `if (jaExiste) return`. Isso protege uma automação DESATIVADA (a
// linha continua no banco), mas RESSUSCITA uma automação REMOVIDA no
// próximo boot. Então "remover o menu" e "rodar sem menu nenhum" eram
// estados impossíveis de manter. A marca em `menu_padrao_semeadura`
// (migration 012) é o que distingue "o dono apagou" de "nunca existiu".
//
// ----------------------------------------------------------------------
// INICIALIZAÇÃO NÃO É PROVISIONAMENTO — mudança da frente D.
//
// A primeira versão deste módulo fazia DUAS coisas no mesmo lugar: convertia
// o menu nativo de quem já tinha um (migração, sempre correta) e SEMEAVA um
// menu novo em banco recém-criado (provisionamento, decisão de quem instala).
// A segunda metade tornava impossível o primeiro requisito da frente D —
// "uma instância deve poder começar completamente vazia" —, porque todo
// `abrirBanco()` de banco novo publicava um /menu ligado antes de alguém
// escolher pacote nenhum.
//
// Agora são operações separadas:
//   - INICIALIZAÇÃO (aqui): cria só o que o motor precisa para funcionar, e
//     converte estado legado. Em banco novo não instala automação nenhuma.
//   - PROVISIONAMENTO (fora daqui): instala o que a configuração inicial
//     escolhida autorizou, pelo caminho normal de
//     `POST /templates/:id/install`. O menu é um template como os outros.
//
// A marca em `menu_padrao_semeadura` continua gravada nos dois casos, com
// `automation_id` NULO quando nada foi semeado (a coluna é nullable desde a
// migration 012). É o que impede uma versão futura de interpretar "não tem
// menu" como "nunca passou por aqui" e semear por cima de uma escolha.
//
// O pool comum CONTINUA sendo criado na inicialização, e isso é deliberado:
// pool é infraestrutura, não automação. Sem nenhum pool nada é instalável
// (`responder.poolId` é obrigatório no schema, com `minLength: 1`), então um
// banco sem pool deixaria o painel sem como instalar o primeiro comando. Uma
// instância "vazia" tem zero automações; um pool vazio não responde nada.
import { salvarScopes } from './automationsService.js'
import { validarAutomacao } from './validate.js'

// O id que o motor semeava quando o menu era nativo. Instâncias que já
// existem têm esta linha, com histórico de execução pendurado nela, então a
// migração CONVERTE em vez de recriar: o id, as revisões e os `automation_runs`
// continuam valendo.
const ID_MENU_ANTIGO = '__native_menu__'
// O id que o menu ganha quando é instalado pelo catálogo: o id natural do
// template, como qualquer automação instalada pelo painel
// (`routes/templates.js` usa o templateId quando ninguém escolhe outro id).
const ID_MENU_NOVO = 'menu'
const POOL_RESERVADO = '__native__'
// O pool comum que a instância ganha quando não tem nenhum. Sem ele nenhuma
// automação pode existir: `responder.poolId` é obrigatório no schema com
// `minLength: 1`, e o único pool semeado por este projeto sempre foi o
// reservado `__native__` — que o painel esconde do seletor de instalação, de
// propósito, para um comando do usuário não nascer num pool do sistema.
const ID_POOL_COMUM = 'padrao'

export const TEMPLATE_DO_MENU = 'menu'

// Devolve o id de um pool que o dono pode editar e apagar. Prefere um que já
// exista: se a instância já tem pool próprio, o menu entra nele em vez de
// ganhar um pool a mais sem razão.
export function garantirPoolComum (db, agora = new Date().toISOString()) {
  const existente = db.prepare(
    "SELECT id FROM pools WHERE id NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY created_at LIMIT 1"
  ).get()
  if (existente) return existente.id
  db.prepare(`INSERT INTO pools (id, label, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(ID_POOL_COMUM, 'Padrão', agora, agora)
  return ID_POOL_COMUM
}

// Conversão da automação nativa que já está no banco. É SURGICAL de
// propósito: mexe só no que dava privilégio, e preserva o resto do documento.
// As rotas por id nunca filtraram `native`, então é possível que alguém tenha
// editado este documento pela API — sobrescrever tudo apagaria essa edição
// em silêncio, que é exatamente o que o pedido proíbe.
function converterMenuNativo (db, linha, poolId, agora) {
  const revisao = db.prepare('SELECT * FROM automation_revisions WHERE id = ?').get(linha.active_revision_id)
  if (!revisao) return null
  let documento
  try { documento = JSON.parse(revisao.doc_json) } catch { return null }

  if (documento?.responder?.poolId === POOL_RESERVADO) documento.responder.poolId = poolId
  const include = Array.isArray(documento?.scope?.include) ? documento.scope.include : []
  if (include.length === 0) {
    // Escopo vazio NUNCA casa com tudo — essa regra vale para conteúdo do
    // usuário e é o que o bypass de `native` contornava. Sem o bypass, o
    // menu precisa dizer onde responde, e "qualquer conversa" é o que ele
    // fazia de fato.
    documento.scope = { include: [{ kind: 'everywhere' }], exclude: Array.isArray(documento?.scope?.exclude) ? documento.scope.exclude : [] }
  }
  if (documento?.name === 'Menu de comandos (nativo)') documento.name = 'Menu de comandos'

  const erros = validarAutomacao(db, documento)
  if (erros.length) {
    throw new Error(`Menu convertido ficou inválido (bug interno): ${JSON.stringify(erros)}`)
  }
  db.prepare('UPDATE automation_revisions SET doc_json = ? WHERE id = ?')
    .run(JSON.stringify(documento), revisao.id)
  salvarScopes(db, revisao.id, documento)
  db.prepare('UPDATE automations SET native = 0, updated_at = ? WHERE id = ?').run(agora, linha.id)
  return linha.id
}

// Inicialização do banco: converte o menu legado, cria o pool comum, e NÃO
// instala nada em instância nova. Roda em todo `abrirBanco()`, uma vez por
// banco — a marca é o que faz a segunda passada não fazer nada.
export function migrarMenuLegado (db) {
  const jaDecidido = db.prepare('SELECT 1 FROM menu_padrao_semeadura WHERE id = 1').get()
  if (jaDecidido) return
  const agora = new Date().toISOString()
  const transacao = db.transaction(() => {
    const poolId = garantirPoolComum(db, agora)
    const nativa = db.prepare('SELECT id, active_revision_id FROM automations WHERE id = ?').get(ID_MENU_ANTIGO)
    // Sem linha legada, não há o que converter — e instalar o menu é escolha
    // do provisionamento, não da abertura do banco. `automation_id` nulo
    // registra justamente isso: esta instância passou por aqui e nada foi
    // semeado.
    const automationId = nativa ? converterMenuNativo(db, nativa, poolId, agora) : null
    db.prepare(`INSERT INTO menu_padrao_semeadura (id, automation_id, semeado_em)
      VALUES (1, ?, ?)`).run(automationId, agora)
  })
  transacao()
}

export const IDS_DO_MENU = { antigo: ID_MENU_ANTIGO, novo: ID_MENU_NOVO, poolComum: ID_POOL_COMUM }
