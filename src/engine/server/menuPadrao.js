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
import { criarServicoAutomacoes, salvarScopes } from './automationsService.js'
import { validarAutomacao } from './validate.js'

// O id que o motor semeava quando o menu era nativo. Instâncias que já
// existem têm esta linha, com histórico de execução pendurado nela, então a
// migração CONVERTE em vez de recriar: o id, as revisões e os `automation_runs`
// continuam valendo.
const ID_MENU_ANTIGO = '__native_menu__'
// Em instância nova, o menu nasce com o id natural do template, como qualquer
// automação instalada pelo painel (`routes/templates.js` usa o templateId
// quando ninguém escolhe outro id).
const ID_MENU_NOVO = 'menu'
const POOL_RESERVADO = '__native__'
// O pool comum que a instância ganha quando não tem nenhum. Sem ele o menu
// não pode existir: `responder.poolId` é obrigatório no schema com
// `minLength: 1`, e o único pool semeado por este projeto sempre foi o
// reservado `__native__` — que o painel esconde do seletor de instalação, de
// propósito, para um comando do usuário não nascer num pool do sistema.
const ID_POOL_COMUM = 'padrao'

export const TEMPLATE_DO_MENU = 'menu'
// Casado com `template menu v2` em src/engine/templates/catalog/menu.lcn.
// Quem subir a versão do template tem de subir aqui também — e o teste
// tests/menu-padrao.test.mjs falha se os dois saírem de sincronia.
export const VERSAO_TEMPLATE_MENU = 2

// O documento que `renderizarTemplate(menu.lcn, { poolId: 'padrao' })`
// produz, com o escopo "qualquer conversa" preenchido.
//
// Está escrito à mão aqui, e não carregado do catálogo, por custo de boot:
// `carregarCatalogo()` compila os 121 templates em ~63 ms, e isto roda em
// todo `abrirBanco()`, inclusive o de cada arquivo da bateria. A guarda
// contra defasagem não é confiança — é o teste, que renderiza o template de
// verdade e exige documento idêntico a este.
export function documentoDoMenu (poolId = ID_POOL_COMUM) {
  return {
    schemaVersion: 1,
    enabled: true,
    name: 'Menu de comandos',
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId },
    scheduling: { priority: 'normal', onNoSlot: { kind: 'discard' } },
    flow: {
      nodes: [
        {
          id: 'gatilho-comando',
          type: 'trigger.command',
          config: { command: '/menu', match: 'exact', allowFrom: 'external' }
        },
        {
          type: 'action.menu.render',
          config: {
            numbered: false,
            header: 'Comandos disponíveis:',
            emptyText: 'Nenhum comando disponível por aqui ainda.'
          },
          id: 'mostrar-menu'
        }
      ],
      edges: [{ from: 'gatilho-comando', to: 'mostrar-menu', on: 'matched' }]
    },
    display: {
      menuLabel: '/menu',
      menuDescription: 'Mostra esta lista de comandos',
      family: 'utilitarios'
    }
  }
}

// Devolve o id de um pool que o dono pode editar e apagar. Prefere um que já
// exista: se a instância já tem pool próprio, o menu entra nele em vez de
// ganhar um pool a mais sem razão.
function garantirPoolComum (db, agora) {
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

function semearMenuNovo (db, poolId, agora) {
  const servico = criarServicoAutomacoes(db)
  const automacao = servico.criarEPublicar({ id: ID_MENU_NOVO, document: documentoDoMenu(poolId) })
  db.prepare("UPDATE automations SET deployment_mode = 'live', updated_at = ? WHERE id = ?")
    .run(agora, automacao.id)
  // Provenance é o que faz `GET /templates/atualizacoes` avisar o dono quando
  // `menu.lcn` ganhar versão nova. Sem isso o menu semeado seria o único
  // comando da instância que não sabe de que template nasceu.
  db.prepare(`INSERT INTO automation_template_provenance
    (automation_id, template_id, template_version, parameters_json, installed_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(automacao.id, TEMPLATE_DO_MENU, VERSAO_TEMPLATE_MENU, JSON.stringify({ poolId }), agora)
  return automacao.id
}

export function garantirMenuPadrao (db) {
  const jaSemeado = db.prepare('SELECT 1 FROM menu_padrao_semeadura WHERE id = 1').get()
  if (jaSemeado) return
  const agora = new Date().toISOString()
  const transacao = db.transaction(() => {
    const poolId = garantirPoolComum(db, agora)
    const nativa = db.prepare('SELECT id, active_revision_id FROM automations WHERE id = ?').get(ID_MENU_ANTIGO)
    const automationId = nativa
      ? converterMenuNativo(db, nativa, poolId, agora)
      : semearMenuNovo(db, poolId, agora)
    db.prepare(`INSERT INTO menu_padrao_semeadura (id, automation_id, semeado_em)
      VALUES (1, ?, ?)`).run(automationId, agora)
  })
  transacao()
}

export const IDS_DO_MENU = { antigo: ID_MENU_ANTIGO, novo: ID_MENU_NOVO, poolComum: ID_POOL_COMUM }
