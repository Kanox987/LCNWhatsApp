// O registro persistente das escolhas de provisionamento de §8. A migração
// 013 guarda a FORMA; este módulo guarda as REGRAS que a forma não consegue
// expressar em CHECK:
//
//   · escopo que não se prova NÃO VIRA LINHA (D-30). A função que resolve o
//     escopo lança em vez de cair num padrão. Um registro de pacote preso a
//     uma identidade inventada é pior do que registro nenhum: ele promete
//     isolamento que o motor compartilhado não entrega;
//   · a composição gravada é a RESOLVIDA, vinda de `resolverPacote` — com
//     dependência transitiva incluída e `origem` por membro —, nunca a lista
//     crua do manifesto;
//   · instalação repetida no mesmo escopo RECONHECE a viva em vez de criar uma
//     paralela, que é o caso "repetição acidental do provisionamento";
//   · remover marca `removed_at`; não apaga. "Nunca instalei" e "instalei e
//     tirei" são estados diferentes, e §8 pede os dois.
import crypto from 'crypto'
import { hashCanonico } from '../templates/pacotes.js'

export const ESCOPOS = Object.freeze(['engine', 'instance'])
export const ESCOLHAS = Object.freeze(['vazia', 'pacote', 'especificas', 'personalizada'])

// Hoje o escopo que se prova é UM: este motor. `LCN_ENGINE_SOCKET` aponta para
// um socket só e o banco é um só, então dizer "instância X" seria afirmar o que
// não se mede. Quando o modelo de implantação der a cada instância o seu motor
// — ou uma identidade que falhe fechada —, esta função passa a devolver
// `{ kind: 'instance', id }` e nada mais no módulo muda.
export function escopoDoMotor (identidade) {
  if (identidade === undefined || identidade === null) {
    return { kind: 'engine', id: 'engine' }
  }
  const { kind, id } = identidade
  if (!ESCOPOS.includes(kind)) {
    throw new Error(`Escopo de instalação desconhecido: "${kind}". Use um de: ${ESCOPOS.join(', ')}.`)
  }
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Escopo de instalação sem identidade. Um pacote não se registra contra identidade que não se resolve — resolva o escopo ou recuse o provisionamento.')
  }
  return { kind, id: id.trim() }
}

function prepararEscolha ({ kind, packageId = null, packageVersion = null }) {
  if (!ESCOLHAS.includes(kind)) {
    throw new Error(`Escolha de provisionamento desconhecida: "${kind}". Use uma de: ${ESCOLHAS.join(', ')}.`)
  }
  if (kind === 'pacote') {
    if (!packageId) throw new Error('A escolha "pacote" exige packageId.')
    if (!Number.isInteger(packageVersion)) {
      throw new Error(`A escolha "pacote" exige packageVersion inteiro (recebi ${JSON.stringify(packageVersion)}).`)
    }
    return { kind, packageId, packageVersion }
  }
  // D-29: "funcionalidades específicas" e "configuração personalizada" são
  // ESCOLHAS persistidas, não pacotes. Carregar packageId nelas faria uma
  // automação feita à mão parecer vinda de template.
  if (packageId) {
    throw new Error(`A escolha "${kind}" não tem pacote, e recebi packageId "${packageId}".`)
  }
  return { kind, packageId: null, packageVersion: null }
}

// A IDENTIDADE de uma instalação. Para `pacote` é o pacote, e a seleção não
// entra: reprovisionar o mesmo pacote com outro parâmetro continua sendo "a
// repetição acidental" de §8, e tem de reconhecer a viva. Para `vazia` é a
// própria escolha, por construção única. Para "funcionalidades específicas" e
// "configuração personalizada" NÃO HÁ PACOTE, e aí a escolha É a identidade:
// sem isto as duas colidiam no mesmo `COALESCE(package_id, '')` vazio e um
// segundo conjunto de funcionalidades era descartado em silêncio, devolvendo a
// instalação do primeiro com `jaExistia: true`. Medido por sonda.
export function chaveDaSelecao ({ kind, packageId = null }, selecao = {}) {
  if (kind === 'pacote') return `pacote:${packageId}`
  if (kind === 'vazia') return 'vazia'
  return `${kind}:${hashCanonico(selecao ?? {})}`
}

export function instalacaoViva (db, escopo, escolha, selecao = {}) {
  const chave = chaveDaSelecao(escolha, selecao)
  return db.prepare(`
    SELECT * FROM package_installations
     WHERE scope_kind = ? AND scope_id = ? AND kind = ?
       AND selection_key = ?
       AND removed_at IS NULL
  `).get(escopo.kind, escopo.id, escolha.kind, chave) || null
}

export function itensDaInstalacao (db, installationId, { incluirRemovidos = false } = {}) {
  return db.prepare(`
    SELECT * FROM package_installation_items
     WHERE installation_id = ?${incluirRemovidos ? '' : ' AND removed_at IS NULL'}
     ORDER BY rowid
  `).all(installationId)
}

// Registra a instalação com os membros JÁ RESOLVIDOS. Se já existe uma viva
// para o mesmo escopo e a mesma escolha, devolve ela com `jaExistia: true` e
// não escreve nada — é o que torna o provisionamento repetido idempotente do
// lado do registro, do mesmo jeito que `classificarOrdem` o torna idempotente
// do lado das automações.
// Reencontrar a instalação viva NÃO é o fim do trabalho — e tratá-lo como fim
// era um defeito, achado por revisão externa e reproduzido por sonda: a
// chamada devolvia `jaExistia: true` com os itens ANTIGOS, e um membro que o
// pedido trazia a mais era descartado em silêncio. O caso real não é
// hipotético: o §8 exige "instalação parcial e recuperação após falha", e é
// exatamente o que acontece quando alguém apaga à mão uma automação do pacote
// e reprovisiona — a rota republica a automação e o registro ficava sem o item.
//
// Então a instalação viva é RECONCILIADA: item que falta é acrescentado, item
// que já está fica como está (a instalação é a identidade, não o pedido), e
// item que o pedido NÃO traz mais é apenas RELATADO, nunca apagado — sair do
// pacote é ato de `planejarRemocao`/`marcarRemovida`, com a posse conferida.
//
// Acrescentar respeita a posse: se outra instalação viva já conta aquela
// automação como `criada`, o índice parcial de 013 recusaria com erro cru de
// SQLite. A recusa vem antes, com texto legível e o id de quem reivindica.
function reconciliarInstalacaoViva (db, installationId, lista, agora) {
  const jaTem = new Map(itensDaInstalacao(db, installationId).map((i) => [i.item_key, i]))
  const faltando = lista.filter((m) => !jaTem.has(m.itemKey))
  const ausentes = [...jaTem.keys()].filter((chave) => !lista.some((m) => m.itemKey === chave))

  const reivindicada = db.prepare(`
    SELECT installation_id FROM package_installation_items AS item
     WHERE item.automation_id = ?
       AND item.installation_id <> ?
       AND item.binding = 'criada'
       AND item.removed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM package_installations AS inst
          WHERE inst.installation_id = item.installation_id
            AND inst.removed_at IS NULL
       )
     LIMIT 1
  `)
  for (const m of faltando) {
    if (m.binding !== 'criada') continue
    const outra = reivindicada.get(m.automationId, installationId)
    if (outra) {
      throw new Error(`A automação "${m.automationId}" já é posse da instalação ${outra.installation_id}. ` +
        'Um pacote não toma posse do que nasceu em outro — adote como "compartilhada" ou solte o item de lá.')
    }
  }

  if (faltando.length > 0) {
    const inserirItem = db.prepare(`
      INSERT INTO package_installation_items
        (installation_id, item_key, automation_id, template_id, template_version, origin, binding, initial_revision_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const gravar = db.transaction(() => {
      for (const m of faltando) {
        inserirItem.run(installationId, m.itemKey, m.automationId, m.templateId,
          m.templateVersion, m.origem, m.binding, m.initialRevisionId ?? null)
      }
      db.prepare('UPDATE package_installations SET reconciled_at = ? WHERE installation_id = ?')
        .run(agora, installationId)
    })
    gravar()
  }

  return {
    installationId,
    jaExistia: true,
    itens: itensDaInstalacao(db, installationId),
    acrescentados: faltando.map((m) => m.itemKey),
    ausentes
  }
}

export function registrarInstalacao (db, {
  escopo, escolha, selecao = {}, membros, agora = new Date().toISOString()
}) {
  const alvo = prepararEscolha(escolha)
  const lista = membros || []
  const chaves = new Set()
  for (const membro of lista) {
    for (const campo of ['itemKey', 'automationId', 'templateId', 'origem', 'binding']) {
      if (!membro[campo]) throw new Error(`Membro de instalação sem "${campo}": ${JSON.stringify(membro)}`)
    }
    if (!Number.isInteger(membro.templateVersion)) {
      throw new Error(`Membro "${membro.itemKey}" sem templateVersion inteiro.`)
    }
    if (chaves.has(membro.itemKey)) {
      throw new Error(`Membro repetido na instalação: "${membro.itemKey}".`)
    }
    chaves.add(membro.itemKey)
  }
  // "Instância vazia" é um estado alcançável de propósito (§8), então zero
  // membro é registro válido — e é o que distingue a instância vazia da
  // instância que nunca passou pelo provisionamento.
  if (alvo.kind === 'vazia' && lista.length > 0) {
    throw new Error('A escolha "vazia" não instala automação nenhuma, e recebi membros.')
  }

  // A idempotência vem DEPOIS da validação, de propósito: reconhecer a
  // instalação viva antes de conferir o pedido faria um provisionamento que se
  // contradiz (uma "instância vazia" com membros) passar calado só porque já
  // havia registro. Pedido malformado é recusado em qualquer estado do banco.
  const existente = instalacaoViva(db, escopo, alvo, selecao)
  if (existente) {
    return reconciliarInstalacaoViva(db, existente.installation_id, lista, agora)
  }

  const installationId = crypto.randomUUID()
  const gravar = db.transaction(() => {
    db.prepare(`
      INSERT INTO package_installations
        (installation_id, scope_kind, scope_id, kind, package_id, package_version, selection_key, selection_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(installationId, escopo.kind, escopo.id, alvo.kind, alvo.packageId, alvo.packageVersion,
      chaveDaSelecao(alvo, selecao), JSON.stringify(selecao), agora)
    const inserirItem = db.prepare(`
      INSERT INTO package_installation_items
        (installation_id, item_key, automation_id, template_id, template_version, origin, binding, initial_revision_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const m of lista) {
      inserirItem.run(installationId, m.itemKey, m.automationId, m.templateId,
        m.templateVersion, m.origem, m.binding, m.initialRevisionId ?? null)
    }
  })
  gravar()
  return {
    installationId,
    jaExistia: false,
    itens: itensDaInstalacao(db, installationId),
    acrescentados: lista.map((m) => m.itemKey),
    ausentes: []
  }
}

// Remover o pacote: só o que ESTA instalação criou sai da lista de removíveis.
// Automação adotada (`compartilhada`) e automação que a pessoa assumiu
// (`avulsa`) continuam no ar — o pacote não é dono do que não nasceu nele.
//
// E há um terceiro caso, que só existe desde que o índice de 013 passou a
// permitir adoção entre instalações: a automação é `criada` AQUI e
// `compartilhada` numa instalação VIVA de outro pacote. Apagá-la levaria com
// ela o que o outro pacote conta como dependência. Então a posse disputada
// também cai em `aSoltar`, com o motivo — remover o pacote nunca quebra o
// pacote do lado.
// Que `binding` dar a um membro cuja automação JÁ EXISTE no banco.
//
// Medido por sonda, porque duas IAs consultadas divergiam e nenhuma das duas
// havia rodado o caso. Reinstalar um pacote desinstalado, registrando o membro
// como 'compartilhada', faz `planejarRemocao` devolver
// `aSoltar: [{ motivo: 'naoNasceuAqui' }]` e `aRemover: []` — a automação
// NUNCA MAIS é removida pelo pacote que a criou. Com 'criada', a remoção volta
// a funcionar.
//
// Mas proveniência não é prova: classificar como 'criada' só porque o
// `template_id` coincide seria o pacote tomar posse do que a pessoa fez. Então
// a regra é POSSE REGISTRADA, em três casos, nesta ordem:
//
//   1. outra instalação VIVA já é dona      -> 'compartilhada' (D-35)
//   2. esta mesma seleção já foi dona antes -> 'criada', herdando a revisão
//                                              inicial que o registro guardou
//   3. nada prova nada                      -> 'compartilhada'
//
// O caso 2 é o único em que o registro PROVA que aquele pacote criou aquela
// automação: há uma linha gravada dizendo isso. Republicar não cria revisão
// inicial, então o `initialRevisionId` é HERDADO do item antigo, nunca
// inventado a partir da revisão que a republicação acabou de ativar.
export function bindingPorPosse (db, escopo, escolha, automationId, selecao = {}) {
  const viva = db.prepare(`
    SELECT item.installation_id FROM package_installation_items AS item
     WHERE item.automation_id = ?
       AND item.binding = 'criada'
       AND item.removed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM package_installations AS inst
          WHERE inst.installation_id = item.installation_id
            AND inst.removed_at IS NULL
       )
     LIMIT 1
  `).get(automationId)
  if (viva) {
    return {
      binding: 'compartilhada',
      initialRevisionId: null,
      motivo: 'posseDeOutraInstalacaoViva',
      porInstalacao: viva.installation_id
    }
  }

  const alvo = prepararEscolha(escolha)
  const chave = chaveDaSelecao(escolha, selecao)
  const antiga = db.prepare(`
    SELECT item.initial_revision_id FROM package_installation_items AS item
      JOIN package_installations AS inst
        ON inst.installation_id = item.installation_id
     WHERE item.automation_id = ?
       AND item.binding = 'criada'
       AND inst.scope_kind = ? AND inst.scope_id = ?
       AND inst.kind = ? AND inst.selection_key = ?
     ORDER BY inst.created_at DESC
     LIMIT 1
  `).get(automationId, escopo.kind, escopo.id, alvo.kind, chave)
  if (antiga) {
    return {
      binding: 'criada',
      initialRevisionId: antiga.initial_revision_id ?? null,
      motivo: 'posseAnteriorRegistrada'
    }
  }

  return { binding: 'compartilhada', initialRevisionId: null, motivo: 'semPosseProvada' }
}

export function planejarRemocao (db, installationId) {
  const itens = itensDaInstalacao(db, installationId)
  const reivindicada = db.prepare(`
    SELECT installation_id FROM package_installation_items AS item
     WHERE item.automation_id = ?
       AND item.installation_id <> ?
       AND item.removed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM package_installations AS inst
          WHERE inst.installation_id = item.installation_id
            AND inst.removed_at IS NULL
       )
     LIMIT 1
  `)
  // Automação apagada por fora (`routes/automations.js:131`) deixa o item vivo
  // sem FK. Mandá-la a `aRemover` faria `despublicar` lançar 404 no meio da
  // transação e a instalação nunca sairia do estado; não há o que despublicar,
  // então ela é solta, com o motivo dito.
  //
  // Existir não basta: apagada e recriada com o MESMO id por outra pessoa, ela
  // é outra automação, e despublicá-la desfaria o trabalho de quem não é o
  // pacote. `automation_revisions.id` é AUTOINCREMENT (nunca se repete) e nada
  // apaga revisões, então a revisão inicial registrada na instalação prova a
  // geração: se ela não pertence mais àquele id, a automação atual não é nossa.
  // Sem revisão inicial registrada (membro adotado, instalação antiga) não há
  // o que comparar, e o comportamento anterior se mantém.
  const existe = db.prepare('SELECT 1 AS ok FROM automations WHERE id = ?')
  const daGeracao = db.prepare('SELECT 1 AS ok FROM automation_revisions WHERE id = ? AND automation_id = ?')
  const aRemover = []
  const aSoltar = []
  for (const item of itens) {
    if (!existe.get(item.automation_id)) {
      aSoltar.push({ ...item, motivo: 'automacaoJaNaoExiste' })
      continue
    }
    if (item.initial_revision_id != null && !daGeracao.get(item.initial_revision_id, item.automation_id)) {
      aSoltar.push({ ...item, motivo: 'outraAutomacaoComOMesmoId' })
      continue
    }
    if (item.binding !== 'criada') {
      aSoltar.push({ ...item, motivo: 'naoNasceuAqui' })
      continue
    }
    const outra = reivindicada.get(item.automation_id, installationId)
    if (outra) {
      aSoltar.push({ ...item, motivo: 'reivindicadaPorOutraInstalacao', porInstalacao: outra.installation_id })
      continue
    }
    aRemover.push(item)
  }
  return { aRemover, aSoltar }
}

export function marcarRemovida (db, installationId, { agora = new Date().toISOString() } = {}) {
  const gravar = db.transaction(() => {
    db.prepare('UPDATE package_installation_items SET removed_at = ? WHERE installation_id = ? AND removed_at IS NULL')
      .run(agora, installationId)
    db.prepare('UPDATE package_installations SET removed_at = ? WHERE installation_id = ? AND removed_at IS NULL')
      .run(agora, installationId)
  })
  gravar()
  return db.prepare('SELECT * FROM package_installations WHERE installation_id = ?').get(installationId)
}

// "Atualização de template sem perda de personalização" precisa de uma pergunta
// respondível: a revisão no ar ainda é a que a instalação publicou? Quando
// `initial_revision_id` é nulo (membro adotado, ou instalação antiga), a
// resposta honesta é "não sei" — e não-sei BLOQUEIA a regeneração em vez de
// autorizá-la, que é a mesma regra de `naoVerificavel` do provisionamento.
// O registro NÃO tem chave estrangeira para `automations`, e isso é
// deliberado: `routes/automations.js:131` apaga a automação direto
// (`DELETE FROM automations WHERE id = ?`), e um CASCADE levaria embora a prova
// de que o pacote esteve instalado — exatamente o histórico que §8 pede. Mas
// sem FK o item fica VIVO apontando para automação que já não existe, e aí o
// índice parcial `package_installation_items_automacao_viva` continua
// reservando aquele automation_id: o operador não consegue reinstalar o item
// nem sair do estado. Esta função é o diagnóstico, e `liberarItemOrfao` é a
// única saída — explícita, porque adivinhar aqui é adotar automação que ninguém
// mandou adotar.
export function conciliarComAutomacoes (db, installationId) {
  const existe = db.prepare('SELECT 1 AS ok FROM automations WHERE id = ?')
  return itensDaInstalacao(db, installationId).map((item) => ({
    ...item,
    vinculo: existe.get(item.automation_id) ? 'presente' : 'orfao'
  }))
}

// Solta um item cuja automação foi apagada por fora do pacote. Recusa quando a
// automação EXISTE, e essa recusa é o ponto: sem ela isto viraria um jeito de
// desvincular automação viva sem passar pela remoção, e uma automação NOVA com
// o mesmo id herdaria calada o lugar da antiga no pacote.
export function liberarItemOrfao (db, installationId, itemKey, { agora = new Date().toISOString() } = {}) {
  const item = db.prepare(`
    SELECT * FROM package_installation_items
    WHERE installation_id = ? AND item_key = ? AND removed_at IS NULL
  `).get(installationId, itemKey)
  if (!item) {
    throw new Error(`Não há item vivo "${itemKey}" na instalação ${installationId}.`)
  }
  if (db.prepare('SELECT 1 AS ok FROM automations WHERE id = ?').get(item.automation_id)) {
    throw new Error(
      `A automação "${item.automation_id}" existe, então o item "${itemKey}" não está órfão. ` +
      'Para tirá-lo do pacote use a remoção do pacote; soltar item vivo por aqui esconderia o vínculo.')
  }
  db.prepare(`
    UPDATE package_installation_items SET removed_at = ?
    WHERE installation_id = ? AND item_key = ? AND removed_at IS NULL
  `).run(agora, installationId, itemKey)
  return { itemKey, automationId: item.automation_id, liberado: true }
}

// O estado de cada item em DOIS EIXOS, porque são duas perguntas diferentes e
// juntá-las num campo só produzia resposta errada.
//
// O DEFEITO MEDIDO que isto conserta: a versão anterior devolvia um campo
// `personalizacao` que começava por `if (ativa == null) return 'semRevisao'`.
// Dois estados reais caíam fora dela:
//
//   1. `PUT /automations/:id/enabled` com `false` e
//      `PUT /automations/:id/deployment-mode` com `shadow`
//      (`routes/automations.js:159` e `:173`) mudam comportamento SEM criar
//      revisão. `evaluator.js` exige `a.enabled = 1` em `candidatosPublicados`
//      e `a.deployment_mode = 'live'` em `automacoesVisiveisEm`, então a
//      automação está MORTA — e `active_revision_id` continua igual ao
//      `initial_revision_id`, então a listagem dizia "está exatamente como o
//      provisionamento a deixou". Executado contra a rota real: dizia.
//      O §8 pede o contrário em letra: "automação inativa ou incompatível
//      precisa ter estado visível e explicação".
//   2. automação editada E despublicada por fora saía só como `semRevisao`,
//      e a edição do cliente desaparecia do relatório — o eixo de
//      personalização nunca era avaliado.
//
// Então: ATIVIDADE responde "isto está no ar?" e PERSONALIZAÇÃO responde "o
// conteúdo ainda é o que o pacote instalou?". A personalização é medida contra
// a revisão MAIS RECENTE, não contra a ativa, pela mesma razão que
// `classificarOrdem` usa `lerUltimoDocumento`: é a revisão que `publicar`
// republicaria, então é ela que uma atualização de pacote sobrescreveria.
//
// O leitor recebe o id da automação e devolve
// `{ ativa, ultima, enabled, deploymentMode }`, ou `null` quando a automação
// não existe mais. Um objeto, e não o número da revisão ativa como antes,
// porque três das quatro informações não estão na revisão.
export function estadoDosItens (db, installationId, lerEstadoDaAutomacao) {
  return itensDaInstalacao(db, installationId).map((item) => {
    const estado = lerEstadoDaAutomacao(item.automation_id) || null
    return { ...item, atividade: atividadeDe(estado), personalizacao: personalizacaoDe(item, estado) }
  })
}

function atividadeDe (estado) {
  if (estado === null) return 'ausente'
  if (estado.ativa === null || estado.ativa === undefined) return 'despublicada'
  if (!estado.enabled) return 'desligada'
  if (estado.deploymentMode !== 'live') return 'sombra'
  return 'noAr'
}

// A ausência de revisão inicial gravada NÃO é "pode regerar": é "não há como
// dizer". Ela vence a comparação, porque comparar contra `null` responderia
// "editada" para qualquer coisa.
function personalizacaoDe (item, estado) {
  if (estado === null) return 'naoVerificavel'
  if (item.initial_revision_id === null) return 'naoVerificavel'
  const maisRecente = estado.ultima ?? estado.ativa
  if (maisRecente === null || maisRecente === undefined) return 'naoVerificavel'
  return maisRecente === item.initial_revision_id ? 'comoInstalada' : 'editada'
}
