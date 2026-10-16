// QUANTO TEMPO O HISTÓRICO FICA GUARDADO.
//
// O pedido do dono, na frase dele: "msg com mais de 72h vai de F". O banco do
// motor tinha 341 MB e id de execução na casa dos 453 mil — e nada disso era
// usado: ninguém abre a Execuções para ver o que um comando respondeu
// anteontem, e o que mais pesa (`no_match`, a avaliação que não casou) não é
// nem história, é subproduto de cada mensagem que passa.
//
// O QUE ISTO APAGA, e em que ordem:
//
//   1. outbound_commands já resolvidos  (o comando que o gateway executou)
//   2. automation_runs sem comando sobrando
//   3. inbound_events sem execução sobrando
//
// A ordem é a das chaves estrangeiras (`foreign_keys = ON`): filho antes de
// pai, senão o DELETE é recusado em vez de cascatear calado.
//
// O QUE ISTO NÃO APAGA, de propósito:
//
//   - comando `pending`. Pendente é o que o gateway pode ainda estar
//     executando — e é o que a cadeia de chamadas usa para dormir esperando
//     resposta. Apagar um deles faria o fluxo nunca retomar. Pendente velho
//     tem outro dono: `fecharPendentesAntigos` o fecha em 24h, e aí ele passa
//     a caber nesta varredura.
//   - a execução ou o evento de um comando que sobrou. Evento é de onde
//     `retomarFluxo` relê a mensagem original; sem ele a cadeia perde o pé.
//
// O PREÇO, dito em voz alta: `inbound_events.id` é a chave de deduplicação —
// é ela que faz reenviar o mesmo evento não executar duas vezes. Apagada a
// linha, um reenvio do MESMO evento mais velho que a janela voltaria a ser
// novidade e executaria de novo. Na prática o gateway não reenvia evento de
// três dias; o at-most-once continua valendo dentro da janela, e é isso que a
// janela significa.
import fs from 'fs'
import { ID_GLOBAL } from './attributeScopes.js'

export const CHAVE_RETENCAO = '__retencao__'

// 72 horas porque foi o número que o dono deu. Fica aqui como PADRÃO e não
// como teto: quem quiser um mês escreve 720 na tela, e quem não quiser apagar
// nada escreve 0. Padrão sensato sim, teto no código não.
export const HORAS_PADRAO = 72

// De quanto em quanto tempo a varredura roda sozinha. Uma hora é folgado para
// uma janela medida em dias e barato para o banco: o DELETE anda por índice de
// data, e varrer de hora em hora mantém cada passada pequena em vez de deixar
// acumular um dia inteiro para apagar de uma vez.
export const INTERVALO_MS = 60 * 60 * 1000

export class ErroDeRetencao extends Error {}

function lerLinha (db) {
  const linha = db.prepare('SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .get('global', ID_GLOBAL, CHAVE_RETENCAO)
  if (!linha) return null
  try {
    const valor = JSON.parse(linha.value_json)
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : null
  } catch {
    // Valor adulterado vira "não configurado", nunca varredura com janela
    // inventada: o lado errado do erro aqui apaga história de verdade.
    return null
  }
}

// Quantas horas valem hoje. Um valor que não dá número volta ao padrão —
// é o mesmo princípio do menu: campo ausente, não configuração quebrada.
export function lerRetencao (db) {
  const bruto = lerLinha(db)
  const horas = Number(bruto?.horas)
  if (!Number.isFinite(horas) || horas < 0) return { horas: HORAS_PADRAO, padrao: true }
  return { horas: Math.round(horas), padrao: false }
}

export function validarHoras (valor) {
  const n = Number(valor)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new ErroDeRetencao(`A janela é um número inteiro de horas, ou 0 para guardar para sempre — veio "${valor}".`)
  }
  return n
}

export function gravarRetencao (db, { horas }) {
  const limpo = { horas: validarHoras(horas) }
  db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
      value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run('global', ID_GLOBAL, CHAVE_RETENCAO, JSON.stringify(limpo), new Date().toISOString())
  return { horas: limpo.horas, padrao: false }
}

// O que existe hoje, para a tela mostrar o tamanho do problema antes de a
// pessoa decidir a janela — e para a varredura poder ser conferida depois.
export function contar (db, { agora = Date.now(), horas = null } = {}) {
  const { horas: janela } = horas === null ? lerRetencao(db) : { horas: validarHoras(horas) }
  const total = {
    eventos: db.prepare('SELECT COUNT(*) n FROM inbound_events').get().n,
    execucoes: db.prepare('SELECT COUNT(*) n FROM automation_runs').get().n,
    comandos: db.prepare('SELECT COUNT(*) n FROM outbound_commands').get().n
  }
  if (!janela) return { horas: janela, total, vencidos: { eventos: 0, execucoes: 0, comandos: 0 } }
  const limite = new Date(agora - janela * 3600 * 1000).toISOString()
  return {
    horas: janela,
    total,
    vencidos: {
      eventos: db.prepare('SELECT COUNT(*) n FROM inbound_events WHERE received_at < ?').get(limite).n,
      execucoes: db.prepare('SELECT COUNT(*) n FROM automation_runs WHERE created_at < ?').get(limite).n,
      comandos: db.prepare("SELECT COUNT(*) n FROM outbound_commands WHERE created_at < ? AND status != 'pending'").get(limite).n
    }
  }
}

// A varredura. Uma transação só: metade apagada deixaria execução órfã
// apontando para evento que não existe mais, e aí a tela de Execuções quebra
// ao abrir a linha.
export function varrer (db, { agora = Date.now(), horas = null } = {}) {
  const janela = horas === null ? lerRetencao(db).horas : validarHoras(horas)
  if (!janela) return { horas: 0, comandos: 0, execucoes: 0, eventos: 0 }
  const limite = new Date(agora - janela * 3600 * 1000).toISOString()

  const passada = db.transaction(() => {
    const comandos = db.prepare(
      "DELETE FROM outbound_commands WHERE created_at < ? AND status != 'pending'"
    ).run(limite).changes
    // `NOT EXISTS` em vez de uma data só: a execução cujo comando continua
    // pendente fica, com o evento dela, senão a retomada da cadeia perde a
    // mensagem original.
    const execucoes = db.prepare(
      `DELETE FROM automation_runs
       WHERE created_at < ?
         AND NOT EXISTS (SELECT 1 FROM outbound_commands oc WHERE oc.run_id = automation_runs.id)`
    ).run(limite).changes
    const eventos = db.prepare(
      `DELETE FROM inbound_events
       WHERE received_at < ?
         AND NOT EXISTS (SELECT 1 FROM automation_runs ar WHERE ar.event_id = inbound_events.id)`
    ).run(limite).changes
    return { comandos, execucoes, eventos }
  })

  return { horas: janela, ...passada() }
}

// Devolver o DISCO, que apagar linha não devolve.
//
// SQLite não encolhe o arquivo quando a linha sai: a página fica livre e é
// reaproveitada pela próxima gravação. Isso é o comportamento certo para o uso
// normal e é exatamente o errado depois de uma primeira varredura que apagou
// quase meio milhão de linhas — o banco continua com o tamanho de antes.
//
// Fica como ação SEPARADA, e não dentro da varredura, por dois motivos: o
// VACUUM reescreve o banco inteiro (precisa de espaço livre do tamanho dele e
// tranca o arquivo enquanto roda), e depois da limpeza de hoje ele não tem
// mais nada para devolver — rodar de hora em hora seria pagar o preço todo dia
// por nada.
export function compactar (db) {
  const antes = tamanhoEmDisco(db)
  db.exec('VACUUM')
  // O DIÁRIO TAMBÉM OCUPA, e foi o que apareceu na primeira limpeza de
  // verdade: o banco caiu de 381 MB para 53 MB e a PASTA continuou com 320 MB,
  // porque apagar 427 mil linhas em modo WAL escreveu um diário de 266 MB que
  // o SQLite reaproveita em vez de devolver. Sem este truncamento, a tela
  // diria "liberei 344 MB" e o disco da máquina não mudaria.
  try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
  const depois = tamanhoEmDisco(db)
  return { antes, depois, liberado: Math.max(0, antes - depois) }
}

// O banco MAIS o diário. Contar páginas não serve: `page_count` é do banco, e
// era justamente o diário que estava sobrando.
function tamanhoEmDisco (db) {
  const bytesDe = (caminho) => { try { return fs.statSync(caminho).size } catch { return 0 } }
  if (!db.name || db.name === ':memory:') {
    return db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true })
  }
  return bytesDe(db.name) + bytesDe(`${db.name}-wal`)
}

// O relógio da varredura.
//
// `unref` porque este temporizador não é motivo para o processo continuar
// vivo: sem ele, o motor não encerraria enquanto a próxima passada não
// chegasse. Devolve como parar, para o teste não deixar relógio solto.
export function iniciarVarredura (db, { intervaloMs = INTERVALO_MS, aoVarrer = null } = {}) {
  const passada = () => {
    try {
      const resultado = varrer(db)
      if (resultado.eventos || resultado.execucoes || resultado.comandos) {
        console.log(
          `[engine] retenção (${resultado.horas}h): ${resultado.eventos} evento(s), ` +
          `${resultado.execucoes} execução(ões) e ${resultado.comandos} comando(s) apagados`
        )
      }
      if (aoVarrer) aoVarrer(resultado)
      return resultado
    } catch (erro) {
      // Falha de varredura NÃO derruba o motor: o pior que o banco grande faz
      // é ocupar disco, e morrer por causa da limpeza seria trocar isso por
      // bot fora do ar.
      console.warn(`[engine] a varredura de retenção falhou: ${erro.message}`)
      return null
    }
  }
  const primeira = passada()
  const relogio = setInterval(passada, intervaloMs)
  relogio.unref?.()
  return { primeira, parar: () => clearInterval(relogio) }
}
