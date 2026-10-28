// DOIS COMANDOS COM A MESMA PALAVRA.
//
// Nada impedia, e o efeito é o pior tipo de defeito: os DOIS respondem. Quem
// digita recebe duas respostas diferentes para o mesmo comando e não tem como
// saber de onde cada uma veio — nenhum erro, nenhum log, só uma conversa
// estranha.
//
// Aconteceu aqui: o template de remover fundo instala "/fundo", e o de pintar o
// fundo nasceu com a mesma palavra. Os dois ficaram ligados ao mesmo tempo.
//
// AVISAR, E NÃO BLOQUEAR. Mesma palavra em conversas diferentes é legítima — um
// "/menu" por grupo, por exemplo —, e o escopo de cada automação é que decide.
// Recusar na publicação tiraria uma capacidade real por causa de um caso comum;
// não dizer nada deixa o defeito invisível. Então o painel mostra, e quem opera
// resolve.
function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

// TODAS as palavras que acordam a automação: o comando e os atalhos.
//
// Os atalhos entram aqui porque é com eles que a colisão fica provável, não
// menos: `/p` é curto, e quanto mais curta a palavra maior a chance de duas
// automações a quererem. Uma tela de conflitos que só olhasse o comando
// principal ficaria cega justamente onde o risco cresceu.
function palavrasDoDocumento (documento) {
  const gatilho = (documento?.flow?.nodes || []).find((n) => n?.type === 'trigger.command')
  if (!gatilho) return []
  const brutas = [gatilho.config?.command, ...(Array.isArray(gatilho.config?.aliases) ? gatilho.config.aliases : [])]
  const limpas = brutas
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim().toLowerCase())
  return [...new Set(limpas)]
}

// Os comandos respondidos por mais de uma automação LIGADA e publicada.
//
// Desligada não entra: ela não responde nada, e acusá-la faria a tela apontar
// um problema que não existe.
export function conflitosDeComando (db) {
  // NATIVA FICA DE FORA, e não por ser invisível na lista: o motor já resolve
  // esse encontro — o comando nativo cede ao do dono com a mesma palavra, por
  // evento. Acusar aqui seria apontar um problema que o sistema já tratou, e
  // mandar a pessoa consertar o que está certo.
  const linhas = db.prepare(`
    SELECT a.id AS automation_id, r.doc_json
    FROM automations a
    JOIN automation_revisions r ON r.id = a.active_revision_id
    WHERE a.enabled = 1 AND a.active_revision_id IS NOT NULL AND a.native = 0
  `).all()

  const porComando = new Map()
  for (const linha of linhas) {
    const documento = jsonOuNull(linha.doc_json)
    for (const comando of palavrasDoDocumento(documento)) {
      if (!porComando.has(comando)) porComando.set(comando, [])
      porComando.get(comando).push({
        automationId: linha.automation_id,
        nome: documento?.name || linha.automation_id
      })
    }
  }

  const conflitos = []
  for (const [comando, automacoes] of porComando) {
    if (automacoes.length < 2) continue
    conflitos.push({ comando, automacoes })
  }
  return conflitos.sort((a, b) => a.comando.localeCompare(b.comando))
}
