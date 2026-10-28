// As enquetes e os votos, guardados no banco do motor.
//
// Substituiu uma urna em MEMÓRIA do gateway, que recomeçava a cada reinício.
// A revisão que pediu a troca estava certa: uma enquete de reunião aberta à
// noite não pode perder os votos porque o bot subiu de novo de manhã.
//
// A fronteira entre gateway e motor NÃO muda: o gateway continua sem escrever
// aqui. Ele RELATA pelo socket — "nasceu esta enquete", "fulano votou nisto" —
// e quem grava é o motor, que é quem tem banco. A outra proposta na mesa era
// dar um SQLite próprio ao gateway, o que criaria dois bancos para manter e
// migrar e transformaria a camada de protocolo em aplicação.

import crypto from 'crypto'

// O WhatsApp manda o SHA-256 do nome da opção, nunca o nome. A biblioteca tem
// um resolvedor, mas ele NÃO é exportado da raiz do pacote — usá-lo seria
// acoplar a caminho interno, que quebra na primeira atualização. O hash é
// sha256 dos bytes do nome, e isso se faz aqui com o `crypto` do Node.
export function hashDaOpcao (nome) {
  return crypto.createHash('sha256').update(String(nome), 'utf8').digest('hex')
}

export function criarServicoDeEnquetes (db) {
  const inserirOpcao = db.prepare(`INSERT INTO poll_options (poll_id, chat_id, option_hash, option_name, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(poll_id, option_hash) DO UPDATE SET option_name = excluded.option_name, chat_id = excluded.chat_id`)

  const apagarVotosDe = db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND voter_id = ?')
  const inserirVoto = db.prepare(`INSERT INTO poll_votes (poll_id, voter_id, option_hash, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(poll_id, voter_id, option_hash) DO UPDATE SET updated_at = excluded.updated_at`)
  const conheceEnquete = db.prepare('SELECT 1 FROM poll_options WHERE poll_id = ? LIMIT 1')

  // Registra uma enquete que nasceu na conversa — do bot ou de qualquer
  // pessoa. É o único momento em que os nomes das opções passam em claro.
  const registrarEnquete = db.transaction((pollId, chatId, opcoes, agora) => {
    let gravadas = 0
    for (const nome of opcoes) {
      if (typeof nome !== 'string' || !nome) continue
      inserirOpcao.run(pollId, chatId || null, hashDaOpcao(nome), nome, agora)
      gravadas++
    }
    return gravadas
  })

  // O voto de uma pessoa, SUBSTITUINDO o que ela tinha escolhido antes.
  //
  // O WhatsApp manda o estado completo da escolha a cada alteração, não um
  // incremento. Apagar e regravar é o que torna "trocar de voto" e "desmarcar"
  // corretos de graça — e torna impossível o erro de somar duas vezes a mesma
  // pessoa, que derrubaria o total acima do tamanho do grupo.
  const registrarVoto = db.transaction((pollId, eleitor, hashes, agora) => {
    apagarVotosDe.run(pollId, eleitor)
    let gravados = 0
    for (const hash of hashes) {
      if (typeof hash !== 'string' || !hash) continue
      inserirVoto.run(pollId, eleitor, hash, agora)
      gravados++
    }
    return gravados
  })

  return {
    enqueteConhecida (pollId) {
      return !!conheceEnquete.get(pollId)
    },

    anotarEnquete ({ pollId, chatId, opcoes, agora = new Date().toISOString() }) {
      if (typeof pollId !== 'string' || !pollId) return 0
      if (!Array.isArray(opcoes) || opcoes.length < 2) return 0
      return registrarEnquete(pollId, chatId, opcoes, agora)
    },

    anotarVoto ({ pollId, eleitor, hashes, agora = new Date().toISOString() }) {
      if (typeof pollId !== 'string' || !pollId) return false
      if (typeof eleitor !== 'string' || !eleitor) return false
      // Enquete que o motor não viu nascer não tem mapa de opções, e sem mapa
      // o voto é um hash que não serve para ninguém. Guardar assim mesmo
      // encheria a tabela de lixo que nunca vira resposta.
      if (!conheceEnquete.get(pollId)) return false
      // Lista vazia é DESMARCAR, e é voto válido: a pessoa tirou a escolha.
      registrarVoto(pollId, eleitor, Array.isArray(hashes) ? hashes : [], agora)
      return true
    },

    // O resultado, somado e ordenado do mais votado para o menos.
    //
    // Opções com ZERO voto aparecem: uma enquete em que ninguém escolheu
    // "Quarta" precisa mostrar Quarta com zero, senão quem lê não sabe o que
    // estava em jogo.
    apurar (pollId) {
      if (typeof pollId !== 'string' || !pollId) return null
      const opcoes = db.prepare('SELECT option_hash, option_name FROM poll_options WHERE poll_id = ?').all(pollId)
      if (!opcoes.length) return null
      const contagem = db.prepare(`SELECT option_hash, COUNT(*) AS votos
        FROM poll_votes WHERE poll_id = ? GROUP BY option_hash`).all(pollId)
      const porHash = new Map(contagem.map((c) => [c.option_hash, c.votos]))
      const votantes = db.prepare('SELECT COUNT(DISTINCT voter_id) AS n FROM poll_votes WHERE poll_id = ?').get(pollId).n
      const linhas = opcoes
        .map((o) => ({ opcao: o.option_name, votos: porHash.get(o.option_hash) || 0 }))
        .sort((a, b) => b.votos - a.votos || a.opcao.localeCompare(b.opcao))
      return { pollId, votantes, opcoes: linhas }
    },

    // A última enquete desta conversa — porque ninguém copia id de mensagem no
    // WhatsApp, e um comando que exigisse isso não seria usado por pessoa
    // nenhuma.
    ultimaDaConversa (chatId) {
      if (typeof chatId !== 'string' || !chatId) return null
      const linha = db.prepare(`SELECT poll_id FROM poll_options WHERE chat_id = ?
        ORDER BY created_at DESC LIMIT 1`).get(chatId)
      return linha ? linha.poll_id : null
    }
  }
}
