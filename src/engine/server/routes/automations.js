import { ErroHttp, resposta } from '../transport.js'
import { validarAutomacao } from '../validate.js'
import { criarServicoAutomacoes } from '../automationsService.js'
import { conflitosDeComando } from '../conflitos.js'
import { usosDoArquivo } from '../usosDeArquivo.js'

export function registrarRotasAutomations (roteador, db) {
  const servico = criarServicoAutomacoes(db)
  const {
    obterAutomation, obterUltimaRevision, obterRevision,
    exporAutomation, exporRevision, extrairDocumento, jsonOuNull,
    criar, salvarRascunho, publicar, despublicar
  } = servico

  // Automações nativas (ex: /menu, ver nativeAutomations.js) ficam fora
  // da listagem normal — são conteúdo do próprio motor, não algo que o
  // usuário criou ou deveria editar pelo wizard genérico.
  roteador.get('/automations', () => db.prepare('SELECT * FROM automations WHERE native = 0 ORDER BY id').all().map(exporAutomation))

  // Comandos respondidos por mais de uma automação ligada. Ver conflitos.js
  // para por que isto avisa em vez de bloquear.
  roteador.get('/automations/conflitos', () => conflitosDeComando(db))

  // QUE COMANDOS USAM ESTE ARQUIVO.
  //
  // O vínculo nunca foi indexado: ele mora dentro do documento, em três campos
  // alternativos do nó que envia arquivo. O efeito era o botão de apagar do
  // acervo avisando "Comandos que usam este arquivo deixam de encontrá-lo" sem
  // poder dizer quais — e quem apaga decidindo no escuro.
  //
  // É POST porque o arquivo chega como dado (id, caminho e pasta): o motor não
  // enxerga o acervo, quem tem os bytes é o outro lado. Ver `usosDeArquivo.js`
  // para por que a resposta separa o que é certo do que é "talvez".
  // AS FAMÍLIAS QUE EXISTEM, com os comandos de cada uma.
  //
  // A tela precisa oferecer interruptores, e para isso precisa saber o que há.
  // A lista sai dos comandos PUBLICADOS, não de um cadastro à parte: família é
  // um campo do comando, e manter um cadastro paralelo criaria famílias que
  // não existem e comandos órfãos de família que existe.
  roteador.get('/automations/familias', () => {
    const linhas = db.prepare(`
      SELECT a.id AS automation_id, r.doc_json
      FROM automations a
      JOIN automation_revisions r ON r.id = a.active_revision_id
      WHERE a.active_revision_id IS NOT NULL AND a.native = 0
    `).all()
    const porFamilia = new Map()
    const semFamilia = []
    for (const linha of linhas) {
      let documento = null
      try { documento = JSON.parse(linha.doc_json) } catch { continue }
      const nome = documento?.name || linha.automation_id
      const gatilho = (documento?.flow?.nodes || []).find((n) => n?.type === 'trigger.command')
      const item = { automationId: linha.automation_id, nome, comando: gatilho?.config?.command || null }
      const familia = typeof documento?.display?.family === 'string' && documento.display.family.trim()
        ? documento.display.family.trim()
        : null
      if (!familia) { semFamilia.push(item); continue }
      if (!porFamilia.has(familia)) porFamilia.set(familia, [])
      porFamilia.get(familia).push(item)
    }
    return {
      familias: [...porFamilia.entries()]
        .map(([familia, comandos]) => ({ familia, comandos }))
        .sort((a, b) => a.familia.localeCompare(b.familia)),
      // Comando sem família não some da tela: ele continua podendo ser
      // desligado um a um, e esconder isso faria parecer que só quem tem
      // família é controlável.
      semFamilia
    }
  })

  roteador.post('/automations/usos-de-arquivo', ({ body }) => {
    const linhas = db.prepare(`
      SELECT a.id AS automation_id, r.doc_json
      FROM automations a
      JOIN automation_revisions r ON r.id = a.active_revision_id
      WHERE a.active_revision_id IS NOT NULL AND a.native = 0
    `).all()
    const automacoes = linhas.map((linha) => {
      let documento = null
      try { documento = JSON.parse(linha.doc_json) } catch { documento = null }
      return { id: linha.automation_id, nome: documento?.name || linha.automation_id, documento }
    })
    return usosDoArquivo(
      { id: body?.id, path: body?.path, folder: body?.folder },
      automacoes
    )
  })
  roteador.post('/automations', ({ body }) => resposta(201, criar(body)))
  roteador.get('/automations/:id', ({ params }) => {
    const row = obterAutomation.get(params.id)
    if (!row) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    return exporAutomation(row)
  })
  roteador.delete('/automations/:id', ({ params }) => {
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)

    // automation_runs referencia automations sem ON DELETE CASCADE (migração
    // 002), então uma automação com histórico não pode simplesmente sumir — o
    // banco recusa. Apagar o histórico junto seria destruir auditoria, então
    // continua sendo decisão de quem opera, não do sistema.
    //
    // MAS "no_match" NÃO É HISTÓRICO. É o registro de que a automação foi
    // avaliada e não casou com nada: ela não respondeu, não gravou, não
    // enviou. Contar isso como execução tornava quase toda automação ao vivo
    // impossível de apagar — uma recém-instalada que nunca casou acumulava
    // dezenas de "execuções" só por existir enquanto outras mensagens
    // chegavam. Foi o que aconteceu com um comando instalado há meia hora:
    // "já executou 38 vez(es)", e as 38 eram no_match.
    //
    // Então as de no_match vão junto, e só as que FIZERAM alguma coisa seguram
    // a remoção.
    const comHistorico = db.prepare(
      "SELECT COUNT(*) AS total FROM automation_runs WHERE automation_id = ? AND status != 'no_match'"
    ).get(params.id)
    if (comHistorico.total > 0) {
      throw new ErroHttp(409,
        `Esta automação já executou ${comHistorico.total} vez(es) e o histórico dessas execuções depende dela. ` +
        'Para tirá-la do ar sem perder o histórico, use "Despublicar" ou desligue a automação.')
    }

    const apagar = db.transaction(() => {
      // Um no_match não gera comando nenhum, mas apagar por fora da ordem das
      // chaves estrangeiras deixaria linha órfã se um dia gerar.
      db.prepare(`DELETE FROM outbound_commands WHERE run_id IN
        (SELECT id FROM automation_runs WHERE automation_id = ?)`).run(params.id)
      const semCasar = db.prepare('DELETE FROM automation_runs WHERE automation_id = ?').run(params.id)
      const resultado = db.prepare('DELETE FROM automations WHERE id = ?').run(params.id)
      return { changes: resultado.changes, semCasar: semCasar.changes }
    })
    const { changes, semCasar } = apagar()
    if (!changes) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    return { removed: true, id: params.id, avaliacoesSemCasarRemovidas: semCasar }
  })
  roteador.get('/automations/:id/revisions', ({ params }) => {
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    return db.prepare(`SELECT * FROM automation_revisions
      WHERE automation_id = ? ORDER BY revision DESC`).all(params.id).map(exporRevision)
  })
  roteador.get('/automations/:id/revisions/:rev', ({ params }) => {
    const revision = Number(params.rev)
    if (!Number.isInteger(revision) || revision < 1) throw new ErroHttp(400, 'Revisão inválida.')
    const row = obterRevision.get(params.id, revision)
    if (!row) throw new ErroHttp(404, `Revisão ${revision} não encontrada para ${params.id}.`)
    return exporRevision(row)
  })
  // O roteador já entrega o IncomingMessage ao handler, então a concorrência
  // otimista usa If-Match real sem ampliar a abstração minimalista do transporte.
  roteador.put('/automations/:id/draft', ({ params, body, req }) => {
    return salvarRascunho(params.id, body, req?.headers?.['if-match'])
  })

  roteador.post('/automations/:id/publish', ({ params, body }) => publicar(params.id, body?.revision))
  roteador.post('/automations/:id/unpublish', ({ params }) => despublicar(params.id))

  roteador.put('/automations/:id/enabled', ({ params, body }) => {
    if (typeof body?.enabled !== 'boolean') throw new ErroHttp(400, 'enabled deve ser true ou false.')
    const automation = obterAutomation.get(params.id)
    if (!automation) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    if (body.enabled && automation.active_revision_id === null) {
      throw new ErroHttp(409, 'Não há revisão publicada pra habilitar esta automação.')
    }
    db.prepare('UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(body.enabled ? 1 : 0, new Date().toISOString(), params.id)
    return exporAutomation(obterAutomation.get(params.id))
  })

  // Alterna sombra/ao vivo sem precisar de nova revisão — é o "promove pra
  // live no mesmo teste" que o plano descreve pro fluxo do /ping.
  roteador.put('/automations/:id/deployment-mode', ({ params, body }) => {
    if (!['shadow', 'live'].includes(body?.mode)) throw new ErroHttp(400, "mode deve ser 'shadow' ou 'live'.")
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    db.prepare('UPDATE automations SET deployment_mode = ?, updated_at = ? WHERE id = ?')
      .run(body.mode, new Date().toISOString(), params.id)
    return exporAutomation(obterAutomation.get(params.id))
  })
  roteador.post('/automations/:id/validate', ({ params, body }) => {
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    const ultima = obterUltimaRevision.get(params.id)
    const fornecido = body !== null
    const documento = fornecido ? extrairDocumento(body) : jsonOuNull(ultima.doc_json)
    const erros = validarAutomacao(db, documento)
    if (documento?.id !== params.id) erros.push({ path: '/id', message: `o id deve ser ${params.id}` })
    if (!fornecido) {
      db.prepare('UPDATE automation_revisions SET validation_errors_json = ? WHERE id = ?')
        .run(JSON.stringify(erros), ultima.id)
    }
    return { valid: erros.length === 0, errors: erros, revision: ultima.revision }
  })
}
