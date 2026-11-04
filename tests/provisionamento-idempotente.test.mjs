// §8: "o provisionamento deve ser idempotente", "reiniciar o sistema não pode
// instalar comandos duplicados", "atualizar o sistema não pode sobrescrever
// alterações personalizadas sem autorização".
//
// O defeito que estes casos guardam, e que existia até agora: o id padrão da
// automação É o id do template, então reprovisionar um pacote em que UM membro
// já estava instalado batia no `409 Automação já cadastrada` de dentro de
// `automationsService.criar` e derrubava a transação INTEIRA — os outros
// membros não entravam, e a resposta não dizia qual deles tinha parado tudo.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { TEMPLATE_DO_MENU, IDS_DO_MENU } from '../src/engine/server/menuPadrao.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const PAR_DO_MENU = 'config-menu'
const poolId = IDS_DO_MENU.poolComum

// `menu.lcn` declara `depende de: config-menu`, então instalar o menu publica
// DOIS: é o par mais parecido com um pacote que o catálogo já tem.
async function instalar (db, templateId = TEMPLATE_DO_MENU) {
  return criarApi(db).resolver('POST', `/templates/${templateId}/install`, contexto({
    scope: { include: [{ kind: 'everywhere' }] },
    parameters: { [TEMPLATE_DO_MENU]: { poolId }, [PAR_DO_MENU]: { poolId } }
  }))
}

const tentar = async (fn) => { try { return { ok: await fn() } } catch (erro) { return { erro } } }
const quantas = (db) => db.prepare('SELECT COUNT(*) AS n FROM automations').get().n
const revisoes = (db, id) => db.prepare('SELECT COUNT(*) AS n FROM automation_revisions WHERE automation_id = ?').get(id).n

// ------------------------------------------- 1. repetição acidental não duplica

{
  const db = abrirBanco(':memory:')
  const primeira = await instalar(db)
  const depoisDaPrimeira = quantas(db)
  check('1. a primeira instalação publica o par inteiro', primeira.body.installed.length === 2,
    primeira.body.installed.map((a) => a.id).join(', '))

  const segunda = await tentar(() => instalar(db))
  check('1. reprovisionar NÃO estoura 409', !segunda.erro, segunda.erro?.message)
  check('1. e não publica nada de novo', segunda.ok?.body?.installed?.length === 0)
  check('1. relatando os dois como já instalados', segunda.ok?.body?.alreadyInstalled?.length === 2,
    (segunda.ok?.body?.alreadyInstalled || []).map((m) => m.automationId).join(', '))
  check('1. nenhuma automação duplicada', quantas(db) === depoisDaPrimeira, `${quantas(db)} vs ${depoisDaPrimeira}`)
  check('1. nem revisão nova sobre o que já estava íntegro', revisoes(db, IDS_DO_MENU.novo) === 1,
    `${revisoes(db, IDS_DO_MENU.novo)} revisões`)
  db.close()
}

// ------------------------- 2. instalação PARCIAL: o membro que falta é instalado

{
  const db = abrirBanco(':memory:')
  await instalar(db, PAR_DO_MENU)
  check('2. o dependente sozinho instala sozinho', quantas(db) === 1)

  const completando = await tentar(() => instalar(db))
  check('2. completar o par não estoura', !completando.erro, completando.erro?.message)
  check('2. e instala SÓ o que faltava', completando.ok?.body?.installed?.length === 1,
    completando.ok?.body?.installed?.map((a) => a.id).join(', '))
  check('2. o membro instalado era o menu', completando.ok?.body?.installed?.[0]?.id === IDS_DO_MENU.novo)
  check('2. o que já existia aparece como já instalado',
    completando.ok?.body?.alreadyInstalled?.[0]?.automationId === PAR_DO_MENU)
  db.close()
}

// --------------- 3. edição à mão NUNCA é sobrescrita, e para a operação inteira

{
  const db = abrirBanco(':memory:')
  await instalar(db)
  // A pessoa abriu o comando em Programar e trocou o texto. É exatamente o que
  // §8 proíbe o provisionamento de descartar.
  const servico = criarServicoAutomacoes(db)
  const doc = JSON.parse(db.prepare(
    'SELECT r.doc_json AS d FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id WHERE a.id = ?'
  ).get(IDS_DO_MENU.novo).d)
  doc.name = 'Meu menu, do jeito que eu escrevi'
  servico.salvarRascunho(IDS_DO_MENU.novo, { document: doc })
  servico.publicar(IDS_DO_MENU.novo)
  const revisoesAntes = revisoes(db, IDS_DO_MENU.novo)

  const r = await tentar(() => instalar(db))
  check('3. reprovisionar por cima de edição à mão é RECUSADO', r.erro?.status === 409, `status=${r.erro?.status}`)
  check('3. a recusa nomeia a automação editada', (r.erro?.message || '').includes(IDS_DO_MENU.novo), r.erro?.message)
  check('3. e diz que foi alterada à mão', /alterada à mão/.test(r.erro?.message || ''))
  check('3. o relatório vem item por item', Array.isArray(r.erro?.detalhes?.itens) && r.erro.detalhes.itens.length === 2)
  check('3. com o estado "modificado" no membro certo',
    r.erro?.detalhes?.itens?.find((m) => m.automationId === IDS_DO_MENU.novo)?.estado === 'modificado')
  check('3. a edição da pessoa continua lá', revisoes(db, IDS_DO_MENU.novo) === revisoesAntes)
  db.close()
}

// ------------- 4. automação do usuário com o mesmo id nunca é adotada pelo pacote

{
  const db = abrirBanco(':memory:')
  // Mesmo id, feita à mão: sem proveniência de template nenhum.
  criarServicoAutomacoes(db).criar({
    id: IDS_DO_MENU.novo,
    document: {
      id: IDS_DO_MENU.novo,
      schemaVersion: 1,
      name: 'o meu, que eu fiz na mão',
      enabled: true,
      scope: { include: [{ kind: 'everywhere' }], exclude: [] },
      trigger: { type: 'trigger.command', config: { command: '/meumenu' } },
      flow: { nodes: [{ id: 'n1', type: 'action.whatsapp.reply', config: { text: 'oi' } }], edges: [] }
    }
  })

  const r = await tentar(() => instalar(db))
  check('4. o pacote NÃO assume uma automação sem proveniência', r.erro?.status === 409, `status=${r.erro?.status}`)
  check('4. e explica que ela não veio de template', /não veio de template/.test(r.erro?.message || ''), r.erro?.message)
  check('4. marcada como conflito',
    r.erro?.detalhes?.itens?.find((m) => m.automationId === IDS_DO_MENU.novo)?.estado === 'conflito')
  check('4. nada mais foi publicado', quantas(db) === 1, `${quantas(db)} automações`)
  db.close()
}

// ------- 5. pacote REMOVIDO (despublicado) volta ao ar, sem recriar nada
//
// §8: "remoção de pacote". Remover é despublicar — o documento e as revisões
// ficam no banco, só `active_revision_id` é zerado. Antes deste caso, pedir o
// pacote de novo depois disso batia em `naoVerificavel` nos dois membros e o
// pacote removido ficava IMPOSSÍVEL de reinstalar: medido, 409 nos dois.

{
  const db = abrirBanco(':memory:')
  const servico = criarServicoAutomacoes(db)
  await instalar(db)
  const revisoesAntes = { [IDS_DO_MENU.novo]: revisoes(db, IDS_DO_MENU.novo), [PAR_DO_MENU]: revisoes(db, PAR_DO_MENU) }
  servico.despublicar(IDS_DO_MENU.novo)
  servico.despublicar(PAR_DO_MENU)
  const noAr = () => db.prepare(
    'SELECT COUNT(*) AS n FROM automations WHERE active_revision_id IS NOT NULL AND enabled = 1'
  ).get().n
  check('5. despublicar tira os dois do ar', noAr() === 0, `${noAr()} no ar`)

  const r = await tentar(() => instalar(db))
  check('5. provisionar de novo NÃO é recusado', r.erro === undefined, r.erro?.message)
  check('5. os dois voltaram ao ar', noAr() === 2, `${noAr()} no ar`)
  check('5. e vieram como RESTAURADOS, não como instalados',
    r.ok?.body?.restored?.length === 2 && r.ok?.body?.installed?.length === 0,
    `restored=${r.ok?.body?.restored?.length} installed=${r.ok?.body?.installed?.length}`)
  check('5. nenhuma automação nova foi criada', quantas(db) === 2, `${quantas(db)} automações`)
  check('5. e nenhuma revisão nova foi escrita',
    revisoes(db, IDS_DO_MENU.novo) === revisoesAntes[IDS_DO_MENU.novo] &&
    revisoes(db, PAR_DO_MENU) === revisoesAntes[PAR_DO_MENU])
  db.close()
}

// --- 6. restaurar NUNCA publica um rascunho que a pessoa escreveu depois
//
// A armadilha do caso 5: `publicar` republica a revisão de número MAIS ALTO,
// de qualquer status. Se alguém salvou um rascunho depois de remover o pacote,
// restaurar colocaria ESSE texto no ar como se fosse do template. Por isso a
// classificação compara contra a revisão mais recente, não contra uma qualquer.

{
  const db = abrirBanco(':memory:')
  const servico = criarServicoAutomacoes(db)
  await instalar(db)
  const doc = JSON.parse(db.prepare(
    'SELECT r.doc_json AS d FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id WHERE a.id = ?'
  ).get(IDS_DO_MENU.novo).d)
  servico.despublicar(IDS_DO_MENU.novo)
  servico.despublicar(PAR_DO_MENU)
  doc.name = 'texto que eu escrevi depois de remover'
  servico.salvarRascunho(IDS_DO_MENU.novo, { document: doc })

  const r = await tentar(() => instalar(db))
  check('6. restaurar por cima de rascunho próprio é RECUSADO', r.erro?.status === 409, `status=${r.erro?.status}`)
  check('6. com o estado "modificado", não "despublicado"',
    r.erro?.detalhes?.itens?.find((m) => m.automationId === IDS_DO_MENU.novo)?.estado === 'modificado',
    r.erro?.detalhes?.itens?.find((m) => m.automationId === IDS_DO_MENU.novo)?.estado)
  check('6. e NADA foi publicado, nem o membro íntegro do par',
    db.prepare('SELECT COUNT(*) AS n FROM automations WHERE active_revision_id IS NOT NULL').get().n === 0)
  db.close()
}

console.log(falhas === 0 ? '\nPROVISIONAMENTO É IDEMPOTENTE E NÃO SOBRESCREVE PERSONALIZAÇÃO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
