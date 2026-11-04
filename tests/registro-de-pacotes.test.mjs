// §8: "a configuração selecionada deve persistir", "o usuário pode editar ou
// remover as automações instaladas", "remoção de pacote", "atualização de
// template sem perda de personalização".
//
// Estes casos guardam o REGISTRO — a camada que escreve no banco. Eles rodam
// contra um banco de verdade, aberto por `abrirBanco(':memory:')` com as
// migrações reais, porque o que se está provando são justamente as restrições
// do esquema: um CHECK que não existe no arquivo não passa a existir porque o
// módulo é cuidadoso.
//
// O que eles impedem:
//
//  · registro preso a identidade inventada: escopo sem id não vira linha
//    (D-30 — "a associação de pacote a uma instância não pode ser mais
//    confiável que a própria identidade da instância");
//  · instalação paralela: provisionar o mesmo pacote duas vezes no mesmo
//    escopo reconhece a primeira em vez de criar outra que ninguém remove;
//  · pacote tomando posse do que não criou: remover só lista o que nasceu na
//    instalação;
//  · "não sei" virando "pode regerar": personalização não verificável bloqueia.
import { abrirBanco } from '../src/engine/server/db.js'
import {
  escopoDoMotor, registrarInstalacao, instalacaoViva, itensDaInstalacao,
  planejarRemocao, marcarRemovida, estadoDosItens,
  conciliarComAutomacoes, liberarItemOrfao, chaveDaSelecao, bindingPorPosse
} from '../src/engine/server/registroDePacotes.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const recusa = (nome, fn, pedaco) => {
  try { fn(); check(nome, false, 'não lançou') } catch (erro) {
    check(nome, erro.message.includes(pedaco), erro.message)
  }
}

const ESCOPO = escopoDoMotor()
const membro = (itemKey, extra = {}) => ({
  itemKey, automationId: itemKey, templateId: itemKey, templateVersion: 1,
  origem: 'pedido', binding: 'criada', ...extra
})

// ─── 1. A migração 013 está no banco que o projeto abre de verdade ───────────
{
  const db = abrirBanco(':memory:')
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'package%'").all().map((r) => r.name)
  check('a migração 013 criou as duas tabelas no banco real', tabelas.length === 2, tabelas.join(', '))
  const versoes = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version)
  check('a 013 foi registrada em schema_migrations', versoes.includes(13), versoes.join(','))
  db.close()
}

// ─── 2. Escopo: identidade que não se resolve RECUSA ────────────────────────
check('sem identidade, o escopo é o motor, declarado', ESCOPO.kind === 'engine' && ESCOPO.id === 'engine',
  `${ESCOPO.kind}/${ESCOPO.id}`)
recusa('escopo de tipo inventado é recusado',
  () => escopoDoMotor({ kind: 'cliente', id: 'x' }), 'Escopo de instalação desconhecido')
recusa('escopo sem id é recusado em vez de cair num padrão',
  () => escopoDoMotor({ kind: 'instance', id: '' }), 'identidade que não se resolve')
recusa('escopo com id só de espaço também é recusado',
  () => escopoDoMotor({ kind: 'instance', id: '   ' }), 'identidade que não se resolve')
check('escopo de instância, quando houver identidade, é aceito e normalizado',
  escopoDoMotor({ kind: 'instance', id: '  abc  ' }).id === 'abc')

// ─── 3. A escolha e o pacote andam juntos ───────────────────────────────────
{
  const db = abrirBanco(':memory:')
  recusa('escolha inventada é recusada',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha: { kind: 'tudo' }, membros: [] }),
    'Escolha de provisionamento desconhecida')
  recusa('escolha "pacote" sem packageId é recusada',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha: { kind: 'pacote' }, membros: [] }),
    'exige packageId')
  recusa('escolha "pacote" sem versão inteira é recusada',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'basico' }, membros: [] }),
    'exige packageVersion inteiro')
  recusa('escolha "personalizada" com packageId é recusada (D-29)',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha: { kind: 'personalizada', packageId: 'basico' }, membros: [] }),
    'não tem pacote')
  db.close()
}

// ─── 4. Instância vazia é estado registrado, não ausência de registro ───────
{
  const db = abrirBanco(':memory:')
  const r = registrarInstalacao(db, { escopo: ESCOPO, escolha: { kind: 'vazia' }, membros: [] })
  check('instância vazia vira linha, com zero membros', r.itens.length === 0 && !!r.installationId)
  check('e a escolha é recuperável depois', !!instalacaoViva(db, ESCOPO, { kind: 'vazia' }))
  recusa('"vazia" com membros é recusada',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha: { kind: 'vazia' }, membros: [membro('ping')] }),
    'não instala automação nenhuma')
  db.close()
}

// ─── 5. Repetição acidental do provisionamento ──────────────────────────────
{
  const db = abrirBanco(':memory:')
  const escolha = { kind: 'pacote', packageId: 'basico', packageVersion: 1 }
  const membros = [membro('ping'), membro('ajuda'), membro('config-menu', { origem: 'dependencia' })]
  const primeira = registrarInstalacao(db, { escopo: ESCOPO, escolha, selecao: { quem: 'dono' }, membros })
  check('a primeira instalação grava os membros resolvidos', primeira.itens.length === 3 && !primeira.jaExistia)
  check('a dependência resolvida entra com origin "dependencia"',
    primeira.itens.find((i) => i.item_key === 'config-menu')?.origin === 'dependencia')

  const segunda = registrarInstalacao(db, { escopo: ESCOPO, escolha, membros })
  check('provisionar de novo RECONHECE a instalação viva', segunda.jaExistia === true)
  check('e não cria instalação paralela', segunda.installationId === primeira.installationId)
  check('o banco tem UMA instalação viva',
    db.prepare('SELECT COUNT(*) c FROM package_installations WHERE removed_at IS NULL').get().c === 1)
  check('a seleção escolhida persistiu literal',
    JSON.parse(db.prepare('SELECT selection_json s FROM package_installations WHERE installation_id = ?')
      .get(primeira.installationId).s).quem === 'dono')
  db.close()
}

// ─── 6. Instâncias simultâneas com pacotes distintos — do lado do registro ──
// O caso COMPLETO de §8 depende do modelo de implantação (um motor para todas
// as instâncias hoje), e isso segue bloqueado. O que se prova aqui é o que
// ESTA camada precisa entregar quando o bloqueio cair: dois escopos guardam
// pacotes diferentes sem se misturar, e o índice único é por escopo.
{
  const db = abrirBanco(':memory:')
  const a = escopoDoMotor({ kind: 'instance', id: 'inst-a' })
  const b = escopoDoMotor({ kind: 'instance', id: 'inst-b' })
  registrarInstalacao(db, { escopo: a, escolha: { kind: 'pacote', packageId: 'basico', packageVersion: 1 }, membros: [membro('ping')] })
  registrarInstalacao(db, { escopo: b, escolha: { kind: 'pacote', packageId: 'protecao', packageVersion: 1 }, membros: [membro('anti-link')] })
  check('dois escopos guardam pacotes distintos', !!instalacaoViva(db, a, { kind: 'pacote', packageId: 'basico' }) &&
    !!instalacaoViva(db, b, { kind: 'pacote', packageId: 'protecao' }))
  check('e um escopo não vê o pacote do outro', instalacaoViva(db, a, { kind: 'pacote', packageId: 'protecao' }) === null)
  db.close()
}

// ─── 7. Uma automação não pode pertencer a duas instalações vivas ───────────
{
  const db = abrirBanco(':memory:')
  registrarInstalacao(db, { escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'basico', packageVersion: 1 }, membros: [membro('menu')] })
  recusa('a mesma automação em duas instalações vivas é recusada pelo BANCO',
    () => registrarInstalacao(db, {
      escopo: ESCOPO,
      escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
      membros: [membro('outro-item', { automationId: 'menu' })]
    }),
    'UNIQUE')
  check('e a instalação recusada não deixou linha meia-feita',
    db.prepare('SELECT COUNT(*) c FROM package_installations').get().c === 1)
  db.close()
}

// ─── 8. Membro malformado não vira linha ────────────────────────────────────
{
  const db = abrirBanco(':memory:')
  const escolha = { kind: 'pacote', packageId: 'basico', packageVersion: 1 }
  recusa('membro sem itemKey é recusado',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha, membros: [{ ...membro('x'), itemKey: '' }] }),
    'sem "itemKey"')
  recusa('membro sem binding é recusado',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha, membros: [{ ...membro('x'), binding: null }] }),
    'sem "binding"')
  recusa('itemKey repetido é recusado antes de escrever',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha, membros: [membro('x'), membro('x', { automationId: 'y' })] }),
    'Membro repetido')
  recusa('binding inventado é recusado pelo CHECK do banco',
    () => registrarInstalacao(db, { escopo: ESCOPO, escolha, membros: [membro('x', { binding: 'dono' })] }),
    'CHECK')
  check('nenhuma das recusas deixou instalação no banco',
    db.prepare('SELECT COUNT(*) c FROM package_installations').get().c === 0)
  db.close()
}

// ─── 9. Remoção de pacote: só sai o que nasceu na instalação ────────────────
{
  const db = abrirBanco(':memory:')
  // `planejarRemocao` confere `automations`: item cuja automação não existe é
  // solto, não removido. Aqui elas existem.
  for (const id of ['atendimento', 'devolver-ao-bot', 'comunicado', 'ver-produto']) {
    db.prepare(`INSERT INTO automations (id, schema_version, enabled, created_at, updated_at)
      VALUES (?, 1, 1, 'agora', 'agora')`).run(id)
  }
  const r = registrarInstalacao(db, {
    escopo: ESCOPO,
    escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    membros: [
      membro('atendimento'),
      membro('devolver-ao-bot', { origem: 'dependencia' }),
      membro('comunicado', { binding: 'compartilhada' }),
      membro('ver-produto', { binding: 'avulsa' })
    ]
  })
  const plano = planejarRemocao(db, r.installationId)
  check('remover lista as duas que a instalação criou',
    plano.aRemover.map((i) => i.item_key).sort().join(',') === 'atendimento,devolver-ao-bot',
    plano.aRemover.map((i) => i.item_key).join(','))
  check('a adotada e a assumida ficam no ar',
    plano.aSoltar.map((i) => i.item_key).sort().join(',') === 'comunicado,ver-produto')

  const depois = marcarRemovida(db, r.installationId)
  check('remover marca removed_at em vez de apagar', !!depois.removed_at)
  check('a linha continua no banco (histórico, não ausência)',
    db.prepare('SELECT COUNT(*) c FROM package_installations').get().c === 1)
  check('e os itens também foram marcados', itensDaInstalacao(db, r.installationId).length === 0 &&
    itensDaInstalacao(db, r.installationId, { incluirRemovidos: true }).length === 4)
  check('depois de remover, não há instalação viva daquele pacote',
    instalacaoViva(db, ESCOPO, { kind: 'pacote', packageId: 'atendimento' }) === null)

  // A prova de que a remoção não é beco sem saída: reinstalar volta a dar.
  const denovo = registrarInstalacao(db, {
    escopo: ESCOPO,
    escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    membros: [membro('atendimento')]
  })
  check('reinstalar depois de remover cria instalação nova', !denovo.jaExistia &&
    denovo.installationId !== r.installationId)
  db.close()
}

// ─── 10. Atualização sem perda de personalização ────────────────────────────
{
  const db = abrirBanco(':memory:')
  const r = registrarInstalacao(db, {
    escopo: ESCOPO,
    escolha: { kind: 'pacote', packageId: 'basico', packageVersion: 1 },
    membros: [
      membro('ping', { initialRevisionId: 10 }),
      membro('ajuda', { initialRevisionId: 11 }),
      membro('menu', { initialRevisionId: 12 }),
      membro('meu-id')
    ]
  })
  // DOIS EIXOS, e eles são independentes de propósito. "Está no ar?" e "o
  // conteúdo é o instalado?" são perguntas diferentes, e a versão anterior
  // desta função devolvia UMA resposta — então desligar a automação por
  // `PUT /automations/:id/enabled` deixava a listagem dizendo "exatamente como
  // o provisionamento a deixou", medido contra a rota real. §8 exige o
  // contrário: automação inativa tem de ter estado visível e explicado.
  const est = (ativa, extra = {}) => ({
    ativa, ultima: ativa, enabled: true, deploymentMode: 'live', ...extra
  })
  const estados = estadoDosItens(db, r.installationId, (id) => ({
    ping: est(10),
    ajuda: est(99),
    menu: est(null, { ultima: 13 }),
    'meu-id': est(7)
  })[id])
  const por = (k) => estados.find((e) => e.item_key === k).personalizacao
  const ativ = (k) => estados.find((e) => e.item_key === k).atividade
  check('revisão ativa igual à instalada = como instalada', por('ping') === 'comoInstalada')
  check('revisão ativa diferente = editada (não regerar sem autorização)', por('ajuda') === 'editada')
  check('sem revisão inicial gravada = naoVerificavel, não "pode regerar"', por('meu-id') === 'naoVerificavel')
  check('automação publicada e intocada = noAr', ativ('ping') === 'noAr')
  check('sem revisão ativa = despublicada no eixo da ATIVIDADE', ativ('menu') === 'despublicada')
  // Revisão inicial 12, mais recente 13 (rascunho salvo e nunca publicado): é a que `publicar` republicaria.
  // Este é o caso que a versão de um eixo perdia: despublicada E editada. Ela
  // devolvia só `semRevisao`, e a edição do cliente desaparecia do relatório.
  check('despublicada NÃO apaga a personalização do relatório', por('menu') === 'editada')

  // Os dois desligamentos que não criam revisão nenhuma. São rotas vivas do
  // painel (`routes/automations.js`), e `evaluator.js` exige `enabled = 1` e
  // `deployment_mode = 'live'` para a automação ser candidata.
  const umEixo = (extra) => estadoDosItens(db, r.installationId, () => est(10, extra))
    .find((e) => e.item_key === 'ping')
  const desligada = umEixo({ enabled: false })
  check('desligada aparece como desligada, não como "comoInstalada"', desligada.atividade === 'desligada')
  check('desligada ainda diz que o conteúdo é o instalado', desligada.personalizacao === 'comoInstalada')
  const sombra = umEixo({ deploymentMode: 'shadow' })
  check('sombra aparece como sombra', sombra.atividade === 'sombra')
  const sumiu = estadoDosItens(db, r.installationId, () => null).find((e) => e.item_key === 'ping')
  check('automação apagada por fora = ausente', sumiu.atividade === 'ausente')
  check('automação apagada por fora não é verificável', sumiu.personalizacao === 'naoVerificavel')
  db.close()
}

// 11. AUTOMACAO APAGADA POR FORA DO PACOTE
//     `routes/automations.js:131` apaga a automação direto, e o registro não
//     tem FK para `automations` (de propósito: CASCADE levaria o histórico que
//     §8 pede). Então o item fica vivo apontando para o nada, e o índice
//     parcial continua reservando aquele automation_id — é um beco sem saída se
//     não houver saída explícita. Esta seção prova a saída, e prova que ela não
//     serve para desvincular automação viva.
{
  const db = abrirBanco(':memory:')
  const criarAutomacao = (id) => db.prepare(`
    INSERT INTO automations (id, schema_version, enabled, created_at, updated_at)
    VALUES (?, 1, 0, 'agora', 'agora')
  `).run(id)
  criarAutomacao('boas-vindas')
  criarAutomacao('despedida')
  const r = registrarInstalacao(db, {
    escopo: ESCOPO,
    escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    membros: [membro('boas-vindas'), membro('despedida')]
  })

  let vinculos = conciliarComAutomacoes(db, r.installationId)
  check('com as duas automações no banco, os dois vínculos estão presentes',
    vinculos.every((v) => v.vinculo === 'presente'))

  db.prepare('DELETE FROM automations WHERE id = ?').run('boas-vindas')
  vinculos = conciliarComAutomacoes(db, r.installationId)
  const porItem = (k) => vinculos.find((v) => v.item_key === k).vinculo
  check('automação apagada por fora vira vínculo órfão, não desaparece',
    porItem('boas-vindas') === 'orfao')
  check('o item que sobrou continua presente', porItem('despedida') === 'presente')

  recusa('soltar item cuja automação EXISTE é recusado',
    () => liberarItemOrfao(db, r.installationId, 'despedida'), 'não está órfão')

  const solto = liberarItemOrfao(db, r.installationId, 'boas-vindas')
  check('o item órfão é liberado nomeando a automação que sumiu',
    solto.liberado === true && solto.automationId === 'boas-vindas')
  check('liberar MARCA, não apaga: o histórico continua legível',
    itensDaInstalacao(db, r.installationId, { incluirRemovidos: true }).length === 2 &&
    itensDaInstalacao(db, r.installationId).length === 1)

  // O beco sem saída de verdade: antes da liberação o automation_id ficava
  // reservado por um item vivo, então nenhuma instalação nova podia reivindicá-lo.
  criarAutomacao('boas-vindas')
  const r2 = registrarInstalacao(db, {
    escopo: { kind: 'instance', id: 'outra' },
    escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    membros: [membro('boas-vindas')]
  })
  check('depois de liberado, o automation_id pode ser reivindicado de novo',
    r2.jaExistia === false && r2.itens.length === 1)
  // E a automação NOVA com o mesmo id não herda o lugar da antiga: o item
  // velho segue marcado como removido, em outra instalação.
  check('a automação recriada não é adotada pela instalação antiga',
    itensDaInstalacao(db, r.installationId).length === 1)

  recusa('liberar item que não existe é recusado',
    () => liberarItemOrfao(db, r.installationId, 'inexistente'), 'Não há item vivo')
  db.close()
}

// ─── 11. Seleção DIFERENTE é instalação diferente ───────────────────────────
// §8 oferece "pacote com funcionalidades específicas" ao lado dos pacotes
// fechados. Antes da coluna `selection_key`, as duas escolhas sem pacote
// colidiam no mesmo `COALESCE(package_id, '')` vazio: a sonda imprimiu
// `{"jaExistia":true,"itens":1}` para um SEGUNDO conjunto de funcionalidades,
// isto é, o pedido novo era descartado em silêncio e devolvia o antigo.
{
  const db = abrirBanco(':memory:')
  const selecaoA = { templates: ['boas-vindas'] }
  const selecaoB = { templates: ['antilink'] }

  const a = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'especificas' }, selecao: selecaoA, membros: [membro('boas-vindas')]
  })
  const b = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'especificas' }, selecao: selecaoB, membros: [membro('antilink')]
  })
  check('um segundo conjunto de funcionalidades NÃO é engolido como repetição',
    b.jaExistia === false && b.installationId !== a.installationId, JSON.stringify(b))
  check('e o membro do segundo pedido foi de fato registrado',
    b.itens.length === 1 && b.itens[0].item_key === 'antilink')

  // A idempotência que §8 exige continua valendo para a MESMA seleção.
  const repetida = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'especificas' }, selecao: selecaoA, membros: [membro('boas-vindas')]
  })
  check('repetir a MESMA seleção reconhece a instalação viva',
    repetida.jaExistia === true && repetida.installationId === a.installationId)

  // A ordem das chaves do objeto não muda a identidade: o hash é canônico, e é
  // por isso que a seleção pode ser a chave. Sem canonização, o MESMO pedido
  // chegando com as chaves em outra ordem viraria instalação nova.
  check('seleção equivalente em ordem diferente de chaves tem a MESMA chave',
    chaveDaSelecao({ kind: 'especificas' }, { parametros: { b: 2, a: 1 }, templates: ['x'] }) ===
    chaveDaSelecao({ kind: 'especificas' }, { templates: ['x'], parametros: { a: 1, b: 2 } }))
  check('e seleções de fato diferentes têm chaves diferentes',
    chaveDaSelecao({ kind: 'especificas' }, { templates: ['x'] }) !==
    chaveDaSelecao({ kind: 'especificas' }, { templates: ['y'] }))
  // `vazia` não tem pacote nem seleção: a identidade é a própria escolha.
  check('a escolha de instância vazia tem identidade própria e constante',
    chaveDaSelecao({ kind: 'vazia' }) === 'vazia')

  // Para `pacote` a seleção NÃO entra na identidade: reprovisionar o mesmo
  // pacote com outro parâmetro é a "repetição acidental" de §8, não um pacote
  // novo — senão cada clique repetido criaria instalação paralela.
  const p1 = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    selecao: { parametros: { saudacao: 'oi' } }, membros: [membro('menu')]
  })
  const p2 = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    selecao: { parametros: { saudacao: 'olá' } }, membros: [membro('menu')]
  })
  check('o mesmo pacote com outro parâmetro continua sendo repetição, não pacote novo',
    p2.jaExistia === true && p2.installationId === p1.installationId)
  db.close()
}

// ─── 12. `compartilhada` tem de ser ALCANÇÁVEL, e remover não pode quebrar o vizinho ───
// O índice de 013 era `UNIQUE (automation_id) WHERE removed_at IS NULL`, sem
// olhar o vínculo — então duas instalações vivas nunca podiam referenciar a
// mesma automação e `binding = 'compartilhada'` nomeava um estado impossível.
// A sonda imprimiu `UNIQUE constraint failed: package_installation_items.automation_id`.
{
  const db = abrirBanco(':memory:')
  const criarAutomacao = (id) => db.prepare(`
    INSERT INTO automations (id, schema_version, enabled, created_at, updated_at)
    VALUES (?, 1, 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z')
  `).run(id)
  criarAutomacao('config-menu')

  const dona = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'atendimento', packageVersion: 1 },
    membros: [membro('config-menu')]
  })
  let adotante = null
  try {
    adotante = registrarInstalacao(db, {
      escopo: { kind: 'instance', id: 'loja-2' },
      escolha: { kind: 'pacote', packageId: 'administracao', packageVersion: 1 },
      membros: [membro('config-menu', { binding: 'compartilhada' })]
    })
    check('um segundo pacote vivo pode ADOTAR a automação do primeiro', adotante.itens.length === 1)
  } catch (erro) {
    check('um segundo pacote vivo pode ADOTAR a automação do primeiro', false, erro.message)
  }

  // Mas a POSSE segue exclusiva: dois pacotes vivos não podem dizer "fui eu
  // que criei", senão remover um apagaria o que o outro conta como seu.
  recusa('dois pacotes vivos não podem ser DONOS da mesma automação',
    () => registrarInstalacao(db, {
      escopo: { kind: 'instance', id: 'loja-3' },
      escolha: { kind: 'pacote', packageId: 'protecao', packageVersion: 1 },
      membros: [membro('config-menu')]
    }), 'UNIQUE constraint failed')

  // E a consequência que a abertura do índice cria: remover o pacote DONO não
  // pode levar embora a automação que o vizinho vivo adotou.
  const plano = planejarRemocao(db, dona.installationId)
  check('remover o dono NÃO apaga automação que outra instalação viva adotou',
    plano.aRemover.length === 0 && plano.aSoltar.length === 1, JSON.stringify(plano))
  check('e o plano DIZ por que soltou, nomeando a instalação que reivindica',
    plano.aSoltar[0]?.motivo === 'reivindicadaPorOutraInstalacao' &&
    plano.aSoltar[0]?.porInstalacao === adotante?.installationId)

  // Com o vizinho removido, a posse volta a ser só dela e a remoção remove.
  marcarRemovida(db, adotante.installationId)
  const plano2 = planejarRemocao(db, dona.installationId)
  check('sem ninguém mais reivindicando, o dono volta a poder remover',
    plano2.aRemover.length === 1 && plano2.aSoltar.length === 0, JSON.stringify(plano2))
  db.close()
}

// ─── 13. Instalação parcial e recuperação após falha ────────────────────────
// §8 pede o teste "instalação parcial e recuperação após falha". O defeito que
// esta seção guarda foi MEDIDO por sonda: `registrarInstalacao` reconhecia a
// instalação viva só pela IDENTIDADE da escolha e devolvia os itens antigos sem
// comparar com os membros recebidos — a sonda imprimiu `itens = 2` e
// `o membro "c" foi PERDIDO em silencio`. Idempotência falsa: repetir o
// provisionamento depois de uma falha no meio do laço NUNCA completava o pacote.
{
  const db = abrirBanco(':memory:')

  // O que sobra de uma falha no meio da publicação: dois dos três membros.
  const parcial = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'basico', packageVersion: 1 },
    membros: [membro('a'), membro('b')]
  })
  check('a instalação parcial nasce com os membros que deram', parcial.itens.length === 2)

  const lerReconciliado = db.prepare(
    'SELECT reconciled_at FROM package_installations WHERE installation_id = ?')
  check('e ainda NÃO está marcada como reconciliada',
    lerReconciliado.get(parcial.installationId).reconciled_at === null)

  const repetida = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'basico', packageVersion: 1 },
    membros: [membro('a'), membro('b'), membro('c')]
  })
  check('repetir o provisionamento RECONHECE a instalação, não cria outra',
    repetida.jaExistia === true && repetida.installationId === parcial.installationId)
  check('e o membro que faltava ENTRA, em vez de ser perdido em silêncio',
    repetida.itens.length === 3 && repetida.acrescentados.join(',') === 'c',
    JSON.stringify(repetida.acrescentados))
  check('o reparo fica DATADO — "nasceu assim" e "foi reparado" não se confundem',
    typeof lerReconciliado.get(parcial.installationId).reconciled_at === 'string')

  // Pedido que traz MENOS membros: o que já está no pacote é RELATADO, nunca
  // apagado. Sair do pacote é trabalho de `planejarRemocao`/`marcarRemovida`,
  // que têm plano e autorização — não efeito colateral de reprovisionar.
  const menor = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'basico', packageVersion: 1 },
    membros: [membro('a')]
  })
  check('membro que o pedido não traz mais é RELATADO em `ausentes`',
    menor.ausentes.slice().sort().join(',') === 'b,c', JSON.stringify(menor.ausentes))
  check('e NÃO é apagado por um reprovisionamento', menor.itens.length === 3)

  // A posse continua exclusiva DENTRO da reconciliação: acrescentar como
  // `criada` uma automação que nasceu em OUTRA instalação viva é recusado com
  // erro legível, em vez de estourar o índice parcial de 013 como SqliteError.
  const vizinha = registrarInstalacao(db, {
    escopo: { kind: 'instance', id: 'loja-9' },
    escolha: { kind: 'pacote', packageId: 'protecao', packageVersion: 1 },
    membros: [membro('z')]
  })
  check('a vizinha é dona da automação que nasceu nela', vizinha.itens.length === 1)
  recusa('reconciliar NÃO toma posse do que nasceu em outra instalação viva',
    () => registrarInstalacao(db, {
      escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'basico', packageVersion: 1 },
      membros: [membro('a'), membro('b'), membro('c'), membro('z')]
    }), 'já é posse da instalação')
  db.close()
}

// 14. QUE `binding` DAR A UM MEMBRO CUJA AUTOMAÇÃO JÁ EXISTE
//
// Duas IAs consultadas divergiam neste ponto e nenhuma das duas havia rodado o
// caso. A sonda mediu: registrar o membro reinstalado como 'compartilhada' faz
// `planejarRemocao` devolver `aSoltar: [{ motivo: 'naoNasceuAqui' }]` e
// `aRemover: []` — a automação NUNCA MAIS é removida pelo pacote que a criou.
// A regra é POSSE REGISTRADA, e estas checagens são a prova dela.
{
  const db = abrirBanco(':memory:')
  const basico = { kind: 'pacote', packageId: 'basico', packageVersion: 1 }
  const outro = { kind: 'pacote', packageId: 'protecao', packageVersion: 1 }

  const semNada = bindingPorPosse(db, ESCOPO, basico, 'nunca-vista')
  check('automação que nunca foi registrada não dá posse a ninguém',
    semNada.binding === 'compartilhada' && semNada.motivo === 'semPosseProvada' &&
    semNada.initialRevisionId === null, JSON.stringify(semNada))

  for (const id of ['a', 'b']) {
    db.prepare(`INSERT INTO automations (id, schema_version, enabled, created_at, updated_at)
      VALUES (?, 1, 1, 'agora', 'agora')`).run(id)
  }
  // A revisão 7 existe de verdade: a remoção confere que a revisão inicial
  // registrada ainda pertence àquele id (senão a automação seria outra).
  db.prepare(`INSERT INTO automation_revisions (id, automation_id, revision, status, doc_json, created_at)
    VALUES (7, 'a', 1, 'published', '{}', 'agora')`).run()
  const primeira = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: basico,
    membros: [membro('a', { initialRevisionId: 7 })]
  })

  const viva = bindingPorPosse(db, ESCOPO, outro, 'a')
  check('outra instalação VIVA é dona: o pacote novo adota, não toma',
    viva.binding === 'compartilhada' && viva.motivo === 'posseDeOutraInstalacaoViva' &&
    viva.porInstalacao === primeira.installationId, JSON.stringify(viva))

  marcarRemovida(db, primeira.installationId)

  const volta = bindingPorPosse(db, ESCOPO, basico, 'a')
  check('a MESMA seleção que já foi dona volta a ser `criada`',
    volta.binding === 'criada' && volta.motivo === 'posseAnteriorRegistrada',
    JSON.stringify(volta))
  check('e a revisão inicial é HERDADA do registro, não inventada pela republicação',
    volta.initialRevisionId === 7, String(volta.initialRevisionId))

  const vizinho = bindingPorPosse(db, ESCOPO, outro, 'a')
  check('posse de uma seleção não vale para outra: proveniência não é prova',
    vizinho.binding === 'compartilhada' && vizinho.motivo === 'semPosseProvada',
    JSON.stringify(vizinho))

  // O defeito medido pela sonda, agora guardado: com o `binding` que a regra
  // devolve, a remoção volta a funcionar; com 'compartilhada' ela some para
  // sempre.
  const reinstalada = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: basico,
    membros: [membro('a', { binding: volta.binding, initialRevisionId: volta.initialRevisionId })]
  })
  const plano = planejarRemocao(db, reinstalada.installationId)
  check('depois de reinstalar, o pacote consegue remover o que criou',
    plano.aRemover.length === 1 && plano.aRemover[0].item_key === 'a' && plano.aSoltar.length === 0,
    JSON.stringify(plano))

  const errada = registrarInstalacao(db, {
    escopo: ESCOPO, escolha: { kind: 'pacote', packageId: 'errado', packageVersion: 1 },
    membros: [membro('b', { binding: 'compartilhada' })]
  })
  const planoErrado = planejarRemocao(db, errada.installationId)
  check('e `compartilhada` é exatamente o que tornaria a remoção impossível',
    planoErrado.aRemover.length === 0 && planoErrado.aSoltar[0].motivo === 'naoNasceuAqui',
    JSON.stringify(planoErrado))

  db.close()
}

console.log(falhas === 0
  ? '\nO REGISTRO DE §8 PERSISTE A ESCOLHA SEM INVENTAR IDENTIDADE\n'
  : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
