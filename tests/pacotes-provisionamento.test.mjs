// §8 FRENTE D, de ponta a ponta pela rota real: "provisionamento vazio",
// "provisionamento com pacote", "repetição acidental do provisionamento",
// "dependência não configurada" e "remoção de pacote".
//
// POR QUE ESTES CASOS, e não só os de `provisionamento-idempotente`: aquele
// exercita `POST /templates/:id/install`, que instala UM template (e o par que
// ele arrasta). O §8 pede PACOTE, e o pacote traz duas coisas que o template
// sozinho não tem — a escolha persistida e a dependência compartilhada por
// todos os membros.
//
// A MEDIÇÃO que justifica o caso 3: os 121 templates do catálogo declaram
// `poolId` e NENHUM tem padrão (`render.js:46` lança quando o valor não vem e a
// definição não tem `default`). Então `instalavel: true` no `GET /pacotes` não
// era resposta suficiente: sem dizer QUAIS parâmetros faltam, provisionar o
// pacote de administração — onze membros — exigiria onze tentativas para
// descobrir a lista, porque `renderizarTemplate` recusa um de cada vez.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { decidirProvisionamento, classificarOrdem } from '../src/engine/server/provisionamento.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { carregarPacotes, resolverPacote } from '../src/engine/templates/pacotes.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { leitoresDeClassificacao } from '../src/engine/server/provisionarMembros.js'
import {
  escopoDoMotor, registrarInstalacao, planejarRemocao
} from '../src/engine/server/registroDePacotes.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const chamar = (db, metodo, caminho, body) => criarApi(db).resolver(metodo, caminho, contexto(body))
const tentar = async (fn) => { try { return { ok: await fn() } } catch (erro) { return { erro } } }
const quantas = (db) => db.prepare('SELECT COUNT(*) AS n FROM automations').get().n
const noAr = (db) => db.prepare('SELECT COUNT(*) AS n FROM automations WHERE active_revision_id IS NOT NULL').get().n

const ESCOPO = { include: [{ kind: 'everywhere' }], exclude: [] }
const criarPool = (db, id = 'pool-comum') => chamar(db, 'POST', '/pools', { id, label: 'Pool comum' })
const provisionarBasico = (db, extra = {}) => chamar(db, 'POST', '/pacotes/provisionar', {
  kind: 'pacote', packageId: 'basico', scope: ESCOPO, parametrosComuns: { poolId: 'pool-comum' }, ...extra
})

// ------------------------------------- 1. o catálogo diz o que cada pacote exige

{
  const db = abrirBanco(':memory:')
  const { pacotes } = await chamar(db, 'GET', '/pacotes')
  check('1. os quatro pacotes do manifesto aparecem', pacotes.length >= 4, `n=${pacotes.length}`)
  check('1. TODOS declaram `parametrosExigidos` com poolId',
    pacotes.every((p) => p.parametrosExigidos?.some((e) => e.key === 'poolId')))
  const adm = pacotes.find((p) => p.packageId === 'administracao')
  const exigido = adm?.parametrosExigidos?.find((e) => e.key === 'poolId')
  check('1. e dizem QUAIS templates pedem o parâmetro', exigido?.templates?.length === 11, `n=${exigido?.templates?.length}`)
  check('1. com o rótulo e a ajuda que o próprio template declara',
    typeof exigido?.rotulo === 'string' && typeof exigido?.ajuda === 'string')
  db.close()
}

// -------------------------------------------------- 2. provisionamento VAZIO

{
  const db = abrirBanco(':memory:')
  const r = await chamar(db, 'POST', '/pacotes/provisionar', { kind: 'vazia', scope: ESCOPO })
  check('2. instância vazia é aceita', r.status === 201, `status=${r.status}`)
  check('2. e não publica automação nenhuma', quantas(db) === 0, `n=${quantas(db)}`)
  check('2. mas a escolha FICA registrada', !!r.body?.installationId)
  const { instalacoes } = await chamar(db, 'GET', '/pacotes/provisionamento')
  check('2. e a listagem mostra a instalação vazia',
    instalacoes.length === 1 && instalacoes[0].kind === 'vazia' && instalacoes[0].itens.length === 0)
  db.close()
}

// --------------------------- 3. dependência não configurada: parâmetro ausente

{
  const db = abrirBanco(':memory:')
  const r = await tentar(() => chamar(db, 'POST', '/pacotes/provisionar', {
    kind: 'pacote', packageId: 'administracao', scope: ESCOPO
  }))
  check('3. pacote sem o parâmetro obrigatório é RECUSADO', r.erro?.status === 400, `status=${r.erro?.status}`)
  const faltando = r.erro?.detalhes?.parametrosFaltando
  check('3. e a resposta nomeia o parâmetro', faltando?.[0]?.key === 'poolId', faltando?.[0]?.key)
  check('3. e nomeia os ONZE membros de uma vez, não um por tentativa',
    faltando?.[0]?.templates?.length === 11, `n=${faltando?.[0]?.templates?.length}`)
  check('3. nada foi publicado', quantas(db) === 0)
  db.close()
}

// ----------------------------- 4. dependência não configurada: pool inexistente

{
  const db = abrirBanco(':memory:')
  const r = await tentar(() => provisionarBasico(db, { parametrosComuns: { poolId: 'pool-que-nao-existe' } }))
  check('4. poolId sem linha em `pools` é RECUSADO', r.erro?.status === 409, `status=${r.erro?.status}`)
  check('4. e o pool ausente é nomeado',
    r.erro?.detalhes?.poolsAusentes?.includes('pool-que-nao-existe'), JSON.stringify(r.erro?.detalhes))
  check('4. nada foi publicado — comando que não responde não vai ao ar', quantas(db) === 0)
  db.close()
}

// ------------------------------------------------ 5. provisionamento com PACOTE

{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const r = await provisionarBasico(db)
  check('5. pacote com a dependência atendida é aceito', r.status === 201, `status=${r.status}`)
  check('5. publica os cinco membros do `basico`', r.body?.installed?.length === 5, `n=${r.body?.installed?.length}`)
  check('5. e os cinco ficam no ar', noAr(db) === 5, `n=${noAr(db)}`)
  check('5. `parametrosComuns` valeu para TODOS, sem repetir onze vezes',
    db.prepare("SELECT COUNT(*) AS n FROM automation_template_provenance WHERE parameters_json LIKE '%pool-comum%'").get().n === 5)
  db.close()
}

// ------------------------------------- 6. repetição acidental não instala duplicado

{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const primeira = await provisionarBasico(db)
  const depois = quantas(db)
  const segunda = await provisionarBasico(db)
  check('6. repetir o provisionamento é aceito', segunda.status === 201, `status=${segunda.status}`)
  check('6. e é a MESMA instalação, não uma nova',
    segunda.body?.installationId === primeira.body?.installationId && segunda.body?.jaExistia === true)
  check('6. nada novo é publicado', segunda.body?.installed?.length === 0, `n=${segunda.body?.installed?.length}`)
  check('6. e o número de automações não muda', quantas(db) === depois, `${quantas(db)} vs ${depois}`)
  const { instalacoes } = await chamar(db, 'GET', '/pacotes/provisionamento')
  check('6. a listagem mostra UMA instalação, não duas', instalacoes.length === 1, `n=${instalacoes.length}`)
  check('6. com os cinco itens e explicação de estado para cada um',
    instalacoes[0].itens.length === 5 && instalacoes[0].itens.every((i) => typeof i.explicacao === 'string'))
  db.close()
}

// ------------------------------------------------------- 7. remoção de pacote

{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const r = await provisionarBasico(db)
  const id = r.body.installationId
  const removido = await chamar(db, 'DELETE', `/pacotes/provisionamento/${id}`)
  check('7. remover devolve o que o pacote criou', removido.removidas?.length === 5, `n=${removido.removidas?.length}`)
  check('7. e tira os cinco do ar', noAr(db) === 0, `n=${noAr(db)}`)
  check('7. sem APAGAR a automação — o histórico fica', quantas(db) === 5, `n=${quantas(db)}`)
  const depois = await chamar(db, 'GET', '/pacotes/provisionamento')
  check('7. a instalação sai da listagem', depois.instalacoes.length === 0, `n=${depois.instalacoes.length}`)
  const r2 = await tentar(() => chamar(db, 'DELETE', `/pacotes/provisionamento/${id}`))
  check('7. remover duas vezes é 404, não erro mudo', r2.erro?.status === 404, `status=${r2.erro?.status}`)
  db.close()
}

// ------------------------- 7b. remoção quando uma automação foi apagada por fora
//
// A trava medida: `DELETE /automations/:id` apaga a linha e o item do pacote
// fica vivo (sem FK, de propósito, para guardar o histórico). A remoção do
// pacote mandava esse item a `despublicar`, que lança 404 dentro da transação:
// a instalação nunca saía do estado e as outras quatro automações ficavam no ar.
{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const r = await provisionarBasico(db)
  const id = r.body.installationId
  await chamar(db, 'DELETE', '/automations/config-menu')
  const lista = await chamar(db, 'GET', '/pacotes/provisionamento')
  const orfao = lista.instalacoes[0].itens.find((i) => i.automationId === 'config-menu')
  check('7b. a listagem diz `ausente` para a apagada por fora', orfao?.atividade === 'ausente', orfao?.atividade)
  const removido = await tentar(() => chamar(db, 'DELETE', `/pacotes/provisionamento/${id}`))
  check('7b. remover o pacote NÃO trava no 404', !removido.erro, removido.erro?.message)
  check('7b. as outras quatro saem do ar', removido.ok?.removidas?.length === 4 && noAr(db) === 0,
    `removidas=${removido.ok?.removidas?.length} noAr=${noAr(db)}`)
  const solta = removido.ok?.soltas?.find((i) => i.automationId === 'config-menu')
  check('7b. e a apagada é solta com o motivo dito', solta?.motivo === 'automacaoJaNaoExiste', solta?.motivo)
  const vivos = db.prepare('SELECT COUNT(*) n FROM package_installation_items WHERE installation_id = ? AND removed_at IS NULL').get(id).n
  check('7b. nenhum item da instalação fica vivo', vivos === 0, `n=${vivos}`)
  const linhas = db.prepare('SELECT COUNT(*) n FROM package_installation_items WHERE installation_id = ?').get(id).n
  check('7b. o histórico dos cinco itens continua no banco', linhas === 5, `n=${linhas}`)
  db.close()
}

// ------------------- 7c. edição e desativação de automação instalada (dois eixos)
//
// São duas perguntas, não uma: ESTÁ NO AR? e FOI EDITADA? Desligar, pôr em
// sombra ou despublicar muda a primeira e NÃO a segunda; editar e publicar muda
// a segunda e deixa a primeira em `noAr`. Medido antes do conserto: a listagem
// respondia "exatamente como o provisionamento a deixou" para uma automação
// desligada, e a edição não aparecia em lugar nenhum.
{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  await provisionarBasico(db)
  const estadoDe = async (id) => {
    const l = await chamar(db, 'GET', '/pacotes/provisionamento')
    return l.instalacoes[0].itens.find((i) => i.automationId === id)
  }
  const par = (i) => `${i?.atividade}/${i?.personalizacao}`

  check('7c. recém-instalada: no ar e como instalada', par(await estadoDe('config-menu')) === 'noAr/comoInstalada')

  await chamar(db, 'PUT', '/automations/config-menu/enabled', { enabled: false })
  let i = await estadoDe('config-menu')
  check('7c. desligar muda a atividade e NÃO a personalização', par(i) === 'desligada/comoInstalada', par(i))
  check('7c. e a explicação diz que está desligada', /desligada/.test(i?.explicacao ?? ''))

  await chamar(db, 'PUT', '/automations/config-menu/enabled', { enabled: true })
  await chamar(db, 'PUT', '/automations/config-menu/deployment-mode', { mode: 'shadow' })
  i = await estadoDe('config-menu')
  check('7c. sombra é outro estado, ainda como instalada', par(i) === 'sombra/comoInstalada', par(i))

  await chamar(db, 'PUT', '/automations/config-menu/deployment-mode', { mode: 'live' })
  await chamar(db, 'POST', '/automations/config-menu/unpublish')
  i = await estadoDe('config-menu')
  check('7c. despublicar: sem revisão ativa, conteúdo intacto', par(i) === 'despublicada/comoInstalada', par(i))
  check('7c. despublicada continua sendo item do pacote (não some da listagem)', i?.itemKey === 'config-menu')

  await chamar(db, 'POST', '/automations/config-menu/publish', {
    revision: db.prepare('SELECT initial_revision_id AS r FROM package_installation_items WHERE automation_id = ?').get('config-menu').r
  })
  i = await estadoDe('config-menu')
  check('7c. republicar a revisão inicial volta a noAr/comoInstalada', par(i) === 'noAr/comoInstalada', par(i))

  const g = await chamar(db, 'GET', '/automations/config-menu')
  const doc = JSON.parse(JSON.stringify(g.draft.document))
  doc.name = `${doc.name} (editado)`
  const salvo = await chamar(db, 'PUT', '/automations/config-menu/draft', doc)
  await chamar(db, 'POST', '/automations/config-menu/publish', { revision: salvo.revision })
  i = await estadoDe('config-menu')
  check('7c. editar e publicar: continua no ar, mas `editada`', par(i) === 'noAr/editada', par(i))
  check('7c. e a explicação avisa que atualizar não sobrescreve a edição', /não sobrescreve/.test(i?.explicacao ?? ''))
  const outro = await estadoDe('ping')
  check('7c. as outras automações do pacote não são afetadas', !outro || par(outro) === 'noAr/comoInstalada', par(outro))
  db.close()
}

// ------------- 7e. id reaproveitado: a remoção do pacote não toca na automação alheia
// Apontado por revisão externa e PROVADO por execução antes do conserto: apagar
// `config-menu`, outra pessoa criar e publicar uma automação nova com o mesmo id,
// e então remover o pacote despublicava a automação NOVA (existir bastava).
{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const inst = await provisionarBasico(db)
  const alvo = 'config-menu'
  const doc = (await chamar(db, 'GET', `/automations/${alvo}`)).draft.document
  await chamar(db, 'DELETE', `/automations/${alvo}`)
  await chamar(db, 'POST', '/automations', { id: alvo, document: doc })
  const rev = (await chamar(db, 'GET', `/automations/${alvo}`)).draft.revision
  await chamar(db, 'POST', `/automations/${alvo}/publish`, { revision: rev })
  const ativa = () => db.prepare('SELECT active_revision_id AS a FROM automations WHERE id = ?').get(alvo)?.a != null
  check('7e. preparo: a automação nova de mesmo id está no ar', ativa())
  const r = await chamar(db, 'DELETE', `/pacotes/provisionamento/${inst.body.installationId}`)
  check('7e. a remoção do pacote NÃO despublica a automação de mesmo id que não é dele', ativa())
  check('7e. e a solta dizendo o motivo',
    r.soltas?.some((x) => x.automationId === alvo && x.motivo === 'outraAutomacaoComOMesmoId'), JSON.stringify(r.soltas))
  check('7e. as outras quatro, que são dele, saem do ar',
    r.removidas?.length === 4 && !r.removidas.some((x) => x.automationId === alvo), `n=${r.removidas?.length}`)
  db.close()
}

// ------------------------------- 7d. instalação parcial e recuperação após falha
// "Parcial" não pode existir por construção: a rota publica os membros e grava
// o registro numa ÚNICA `db.transaction`. O que o teste prova é a atomicidade.
// A falha é plantada no ÚLTIMO passo (gravar a instalação), depois de os cinco
// membros terem sido publicados — é a pior hora para falhar. O gatilho só dispara
// quando as cinco automações já existem dentro da transação, então o erro
// carrega a prova de que a falha não veio cedo demais (um pré-voo que recusasse
// antes de escrever nada tornaria o teste vazio).
{
  const TABELAS = [
    'automations', 'automation_revisions', 'automation_template_provenance', 'automation_scopes',
    'declared_variables', 'package_installations', 'package_installation_items'
  ]
  const fotografia = (db) => Object.fromEntries(TABELAS.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]))
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const antes = fotografia(db)
  db.exec(`CREATE TRIGGER falha_plantada BEFORE INSERT ON package_installations
    WHEN (SELECT COUNT(*) FROM automations) = 5
    BEGIN SELECT RAISE(ABORT, 'falha plantada com 5 automacoes ja publicadas'); END`)
  const r = await tentar(() => provisionarBasico(db))
  check('7d. a falha plantada no último passo chega como erro', !!r.erro, r.ok ? `status=${r.ok.status}` : undefined)
  check('7d. e é a plantada DEPOIS dos cinco membros publicados (o teste não é vazio)',
    /5 automacoes ja publicadas/.test(r.erro?.message ?? ''), r.erro?.message)
  const depois = fotografia(db)
  check('7d. nada fica para trás em nenhuma das sete tabelas', JSON.stringify(depois) === JSON.stringify(antes),
    JSON.stringify(depois))
  check('7d. e nenhuma automação ficou no ar', noAr(db) === 0)
  const { instalacoes } = await chamar(db, 'GET', '/pacotes/provisionamento')
  check('7d. a listagem não mostra instalação nenhuma', instalacoes.length === 0, `n=${instalacoes.length}`)

  db.exec('DROP TRIGGER falha_plantada')
  const retomada = await provisionarBasico(db)
  check('7d. recuperação: refazer depois da falha instala normalmente', retomada.status === 201, `status=${retomada.status}`)
  check('7d. e instala os cinco, sem sobra da tentativa que falhou',
    retomada.body?.installed?.length === 5 && quantas(db) === 5 && noAr(db) === 5, `n=${quantas(db)}`)
  const lista = await chamar(db, 'GET', '/pacotes/provisionamento')
  check('7d. com UMA instalação registrada e cinco itens vivos',
    lista.instalacoes.length === 1 && lista.instalacoes[0].itens.length === 5)
  db.close()
}

// ---------------- 8. estado 'naoVerificavel': chamar de fato decidirProvisionamento
//
// §8 e DECISIONS.md: automação cuja procedência ou conteúdo não se pode provar
// cai em `naoVerificavel`. O teste anterior não chamava `decidirProvisionamento`
// de verdade para este estado. Aqui provamos:
//   (1) a classificação como `naoVerificavel` de automação existente sem revisão;
//   (2) a chamada direta a `decidirProvisionamento` afirmando a recusa (`podeInstalar: false`)
//       e o membro nos impedimentos;
//   (3) a recusa de ponta a ponta na rota `POST /pacotes/provisionar` com status 409.
{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const catalogo = carregarCatalogo()
  const servicoAutomacoes = criarServicoAutomacoes(db)
  const obterProvenance = db.prepare('SELECT * FROM automation_template_provenance WHERE automation_id = ?')
  const leitores = leitoresDeClassificacao({ db, servicoAutomacoes, obterProvenance })

  // Semeia linha REAL em `automations` e proveniência para 'ping', mas SEM revisão em
  // `automation_revisions`: a automação existe no banco mas não tem revisão nenhuma.
  const agora = new Date().toISOString()
  db.prepare(`
    INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at)
    VALUES ('ping', 1, 1, 'live', ?, ?)
  `).run(agora, agora)
  db.prepare(`
    INSERT INTO automation_template_provenance (automation_id, template_id, template_version, parameters_json, installed_at)
    VALUES ('ping', 'ping', 1, '{}', ?)
  `).run(agora)

  const classificacao = classificarOrdem({
    ordem: ['ping'],
    catalogo,
    automationIds: {},
    parametrosPorTemplate: { ping: { poolId: 'pool-comum' } },
    ...leitores
  })

  check('8. classificarOrdem classifica automação sem revisão como naoVerificavel',
    classificacao[0]?.estado === 'naoVerificavel', classificacao[0]?.estado)

  // (a) Chama de fato decidirProvisionamento e afirma a decisão devolvida
  const decisao = decidirProvisionamento(classificacao)
  check('8. decidirProvisionamento RECUSA provisionamento com membro naoVerificavel',
    decisao.podeInstalar === false, `podeInstalar=${decisao.podeInstalar}`)
  check('8. e inclui o membro na lista de impedimentos com motivo explicado',
    decisao.impedem?.length === 1 && decisao.impedem[0]?.estado === 'naoVerificavel' &&
    typeof decisao.impedem[0]?.motivo === 'string' && /não tem revisão nenhuma/.test(decisao.impedem[0]?.motivo),
    JSON.stringify(decisao.impedem))
  check('8. nenhum membro é aprovado para instalação ou restauração',
    decisao.aInstalar.length === 0 && decisao.aRestaurar.length === 0 && decisao.jaInstalados.length === 0)

  // Provando a mesma trava pela rota real:
  const r = await tentar(() => provisionarBasico(db))
  check('8. rota POST /pacotes/provisionar é recusada com 409 devido a naoVerificavel',
    r.erro?.status === 409, `status=${r.erro?.status}`)
  check('8. erro da rota detalha o item como naoVerificavel',
    r.erro?.detalhes?.itens?.find((i) => i.automationId === 'ping')?.estado === 'naoVerificavel')
  check('8. nada novo foi publicado no banco', quantas(db) === 1)

  db.close()
}

// ----------------- 9. remoção com linhas REAIS em automations (sem dados fabricados)
//
// O defeito corrigido: no registro de pacotes, a remoção com itens adotados ou compartilhados
// era exercitada com dados fabricados (inserts manuais sem documentos nem revisões) ou mocks
// em memória. Aqui semeamos automações REAIS publicadas (com revisões ativas e nós válidos),
// registramos a instalação no banco real, planejamos a remoção e executamos a rota DELETE:
// o item criado é despublicado no banco real (active_revision_id vira null) e o adotado
// ('compartilhada') PERMANECE no ar com active_revision_id intacto.
{
  const db = abrirBanco(':memory:')
  await criarPool(db)
  const servicoAutomacoes = criarServicoAutomacoes(db)

  const docValido = (id, comando) => ({
    id,
    schemaVersion: 1,
    name: id,
    enabled: true,
    scope: ESCOPO,
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'pool-comum' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: comando, match: 'exact', allowFrom: 'any' } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: 'ok' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  })

  // Semeia automações REAIS e publicadas no banco
  const criadaReal = servicoAutomacoes.criarEPublicar({ id: 'auto-criada', document: docValido('auto-criada', '/criada') })
  const adotadaReal = servicoAutomacoes.criarEPublicar({ id: 'auto-adotada', document: docValido('auto-adotada', '/adotada') })

  check('9. preparo: as duas automações reais estão no ar no banco',
    noAr(db) === 2 && quantas(db) === 2)

  const r = registrarInstalacao(db, {
    escopo: escopoDoMotor(),
    escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    membros: [
      {
        itemKey: 'auto-criada',
        automationId: 'auto-criada',
        templateId: 'ping',
        templateVersion: 1,
        origem: 'pedido',
        binding: 'criada',
        initialRevisionId: criadaReal.activeRevisionId
      },
      {
        itemKey: 'auto-adotada',
        automationId: 'auto-adotada',
        templateId: 'ajuda',
        templateVersion: 1,
        origem: 'pedido',
        binding: 'compartilhada',
        initialRevisionId: adotadaReal.activeRevisionId
      }
    ]
  })

  // Confere que planejarRemocao separa a que nasceu aqui da adotada
  const plano = planejarRemocao(db, r.installationId)
  check('9. planejarRemocao separa a criada para aRemover',
    plano.aRemover.length === 1 && plano.aRemover[0].automation_id === 'auto-criada')
  check('9. e solta a adotada com motivo naoNasceuAqui',
    plano.aSoltar.length === 1 && plano.aSoltar[0].automation_id === 'auto-adotada' &&
    plano.aSoltar[0].motivo === 'naoNasceuAqui')

  // Remove o pacote através da rota real DELETE
  const removido = await chamar(db, 'DELETE', `/pacotes/provisionamento/${r.installationId}`)
  check('9. remoção via API relata auto-criada em removidas',
    removido.removidas?.some((x) => x.automationId === 'auto-criada'), JSON.stringify(removido.removidas))
  check('9. e relata auto-adotada em soltas com motivo naoNasceuAqui',
    removido.soltas?.some((x) => x.automationId === 'auto-adotada' && x.motivo === 'naoNasceuAqui'),
    JSON.stringify(removido.soltas))

  // Efeito REAL nas tabelas de banco (não em estruturas de memória):
  const ativaCriada = db.prepare('SELECT active_revision_id AS a FROM automations WHERE id = ?').get('auto-criada')?.a
  const ativaAdotada = db.prepare('SELECT active_revision_id AS a FROM automations WHERE id = ?').get('auto-adotada')?.a
  check('9. auto-criada teve active_revision_id zerado no banco (fora do ar)', ativaCriada === null)
  check('9. auto-adotada PERMANECE ativa no banco real', ativaAdotada === adotadaReal.activeRevisionId)
  check('9. exatamente uma automação continua no ar', noAr(db) === 1)
  check('9. e as duas linhas continuam em automations (histórico preservado)', quantas(db) === 2)

  db.close()
}

// ----------------- 10. resolverPacote de verdade no lugar do mock 'membro()'
//
// O mock 'membro()' fabricava objetos de membro manualmente, sem testar a resolução
// de dependências transitivas, versões fixadas e derivação real de conexões.
// Aqui exercitamos `resolverPacote` de verdade contra o catálogo real, e usamos a
// composição resultante para registrar e persistir a instalação no banco.
{
  const db = abrirBanco(':memory:')
  const catalogo = carregarCatalogo()
  const pacotes = carregarPacotes()
  const basicoManifesto = pacotes.get('basico')

  // Chama resolverPacote de verdade
  const resolvido = resolverPacote(catalogo, basicoManifesto)

  check('10. resolverPacote devolve os metadados do pacote',
    resolvido.packageId === 'basico' && resolvido.packageVersion === 1)
  check('10. resolverPacote resolve 5 membros reais (4 pedidos + 1 dependência)',
    resolvido.membros.length === 5, `n=${resolvido.membros.length}`)

  // Prova que a dependência transitiva veio da resolução real, não de mock
  const dep = resolvido.membros.find((m) => m.templateId === 'config-menu')
  check('10. config-menu foi resolvido como dependencia transitiva de menu',
    dep?.origem === 'dependencia')
  check('10. dependência transitiva vem posicionada antes do template dependente',
    resolvido.membros.findIndex((m) => m.templateId === 'config-menu') <
    resolvido.membros.findIndex((m) => m.templateId === 'menu'))
  check('10. cada membro resolvido possui contentHash canônico calculado',
    resolvido.membros.every((m) => typeof m.contentHash === 'string' && m.contentHash.length === 64))

  // Usa os membros reais resolvidos para registrar a instalação
  const escopo = escopoDoMotor()
  const escolha = { kind: 'pacote', packageId: resolvido.packageId, packageVersion: resolvido.packageVersion }
  const membrosReais = resolvido.membros.map((m) => ({
    itemKey: m.itemKey,
    automationId: m.itemKey,
    templateId: m.templateId,
    templateVersion: m.templateVersion,
    origem: m.origem,
    binding: 'criada'
  }))

  const reg = registrarInstalacao(db, { escopo, escolha, membros: membrosReais })
  check('10. registrarInstalacao aceita e grava os membros vindos de resolverPacote',
    reg.itens.length === 5 && !reg.jaExistia)

  const itemDep = db.prepare(
    'SELECT origin, template_version FROM package_installation_items WHERE installation_id = ? AND item_key = ?'
  ).get(reg.installationId, 'config-menu')
  check('10. o banco gravou a dependência resolvida com origin dependencia',
    itemDep?.origin === 'dependencia')

  const itemMenu = db.prepare(
    'SELECT origin, template_version FROM package_installation_items WHERE installation_id = ? AND item_key = ?'
  ).get(reg.installationId, 'menu')
  check('10. o item pedido gravou origin pedido e versão 2 do catálogo',
    itemMenu?.origin === 'pedido' && itemMenu?.template_version === 2)

  // Idempotência com membros resolvidos reais
  const segunda = registrarInstalacao(db, { escopo, escolha, membros: membrosReais })
  check('10. repetição com resolverPacote de verdade reconhece a instalação viva',
    segunda.jaExistia === true && segunda.installationId === reg.installationId)

  db.close()
}

console.log(falhas === 0 ? '\nPROVISIONAMENTO POR PACOTE: VAZIO, PACOTE, REPETIÇÃO, DEPENDÊNCIA E REMOÇÃO (inclusive com automação apagada por fora) E ATOMICIDADE DA INSTALAÇÃO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
