// Testes do cache configurável do SQLite (PRAGMA cache_size) e armadilha de medição.
// Verifica declaração no config, conversão de MB para KiB negativo, tolerância
// a entradas inválidas, ausência de teto artificial e mede o impacto de dois
// tamanhos de cache numa carga representativa.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { performance } from 'perf_hooks'
import { PADRAO } from '../src/config.js'
import {
  abrirBanco,
  resolverCacheSqliteKiB,
  PADRAO_CACHE_SQLITE_MB
} from '../src/engine/server/db.js'

let falhas = 0
const check = (nome, ok, extra) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`)
}

// --- 1. Declaração e padrão no config ---
check(
  'PADRAO.hardware.cacheSqliteMB existe e tem valor padrão 4',
  PADRAO?.hardware?.cacheSqliteMB === 4,
  `valor=${PADRAO?.hardware?.cacheSqliteMB}`
)
check(
  'PADRAO_CACHE_SQLITE_MB do db.js bate com o valor do config (4 MB)',
  PADRAO_CACHE_SQLITE_MB === 4
)

// --- 2. Resolução de KiB e atenção ao sinal ---
// No SQLite: negativo = KiB, positivo = páginas.
check('resolverCacheSqliteKiB(4) converte 4 MB para 4096 KiB', resolverCacheSqliteKiB(4) === 4096)
check('resolverCacheSqliteKiB(8) converte 8 MB para 8192 KiB', resolverCacheSqliteKiB(8) === 8192)
check('resolverCacheSqliteKiB(16) converte 16 MB para 16384 KiB', resolverCacheSqliteKiB(16) === 16384)
check('resolverCacheSqliteKiB aceita string numérica "8"', resolverCacheSqliteKiB('8') === 8192)

// Proteção contra inversão de sinal no arquivo do usuário:
check('valor negativo de MB (-4) é tratado defensivamente como 4096 KiB', resolverCacheSqliteKiB(-4) === 4096)

// Entradas inválidas caem no padrão sensato:
check('zero cai no padrão (4096 KiB)', resolverCacheSqliteKiB(0) === 4096)
check('NaN cai no padrão (4096 KiB)', resolverCacheSqliteKiB(NaN) === 4096)
check('null cai no padrão (4096 KiB)', resolverCacheSqliteKiB(null) === 4096)
check('undefined cai no padrão (4096 KiB)', resolverCacheSqliteKiB(undefined) === 4096)

// Padrão sensato sim, teto no código não:
check('máquina folgada pode alocar 256 MB sem teto artificial no código', resolverCacheSqliteKiB(256) === 256 * 1024)

// --- 3. Aplicação do PRAGMA na abertura do banco ---
{
  const dbMemPadrao = abrirBanco(':memory:')
  const cacheValor = dbMemPadrao.pragma('cache_size', { simple: true })
  check(
    'abrirBanco padrão aplica cache_size = -4096 (-4 MiB)',
    cacheValor === -4096,
    `pragma=${cacheValor}`
  )
  check(
    'sinal do cache_size é NEGATIVO (representa KiB, não número de páginas)',
    cacheValor < 0,
    `pragma=${cacheValor}`
  )
  dbMemPadrao.close()
}

{
  const dbMem8 = abrirBanco(':memory:', { cacheMB: 8 })
  const cache8 = dbMem8.pragma('cache_size', { simple: true })
  check(
    'abrirBanco com opção { cacheMB: 8 } aplica cache_size = -8192',
    cache8 === -8192,
    `pragma=${cache8}`
  )
  dbMem8.close()
}

{
  const dbMem2 = abrirBanco(':memory:', { cacheSqliteMB: 2 })
  const cache2 = dbMem2.pragma('cache_size', { simple: true })
  check(
    'abrirBanco com opção { cacheSqliteMB: 2 } aplica cache_size = -2048',
    cache2 === -2048,
    `pragma=${cache2}`
  )
  dbMem2.close()
}

{
  const dbMemCfg = abrirBanco(':memory:', { cfg: { hardware: { cacheSqliteMB: 12 } } })
  const cache12 = dbMemCfg.pragma('cache_size', { simple: true })
  check(
    'abrirBanco respeita cfg.hardware.cacheSqliteMB (12 MB -> -12288 KiB)',
    cache12 === -12288,
    `pragma=${cache12}`
  )
  dbMemCfg.close()
}

// --- 4. Armadilha de medição: comparação de tempo entre dois tamanhos de cache ---
//
// A ARMADILHA:
// Reduzir cache troca memória por leitura de disco. Diminuir sem medir pode
// deixar o sistema mais lento em troca de uns megabytes — e aí o conserto é pior
// que a doença.
//
// AVISO DE MEDIÇÃO:
// O trecho abaixo mede tempos locais nesta máquina e sob este sistema de arquivos
// específico. NÃO constitui promessa de ganho ou consumo em produção; a escolha
// definitiva depende de medições sob carga real com instâncias ativas.
const pastaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-cache-bench-'))
const arqBancoTeste = path.join(pastaTmp, 'bench.sqlite')

try {
  // Prepara banco com migrations e massa de dados representativa
  const dbCriar = abrirBanco(arqBancoTeste)
  const agora = new Date().toISOString()

  dbCriar.transaction(() => {
    // Insere automações e revisões
    for (let i = 1; i <= 20; i++) {
      dbCriar.prepare(`INSERT INTO automations
        (id, schema_version, enabled, deployment_mode, created_at, updated_at)
        VALUES (?, 1, 1, 'live', ?, ?)`).run(`auto-${i}`, agora, agora)

      dbCriar.prepare(`INSERT INTO automation_revisions
        (automation_id, revision, status, doc_json, created_at)
        VALUES (?, 1, 'active', ?, ?)`).run(
        `auto-${i}`,
        JSON.stringify({ nome: `Auto ${i}`, passos: new Array(10).fill({ tipo: 'resposta', texto: 'olá mundo '.repeat(20) }) }),
        agora
      )
    }

    // Insere eventos de entrada e execuções para popular várias páginas do SQLite
    for (let i = 1; i <= 300; i++) {
      const evId = `evento-bench-${i}`
      dbCriar.prepare(`INSERT INTO inbound_events
        (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at)
        VALUES (?, 'acc-1', 'chat-pv', 'direct', 'sender-1', 'text', ?, 0, ?, ?)`).run(
        evId,
        `comando teste ${i} com payload `.repeat(5),
        JSON.stringify({ i, dado: 'extra '.repeat(15) }),
        agora
      )

      dbCriar.prepare(`INSERT INTO automation_runs
        (event_id, automation_id, automation_revision_id, deployment_mode, status, detail_json, created_at)
        VALUES (?, 'auto-1', 1, 'live', 'completed', ?, ?)`).run(
        evId,
        JSON.stringify({ resultado: 'ok', i }),
        agora
      )
    }
  })()
  dbCriar.close()

  // Função para executar carga de leitura representativa
  function executarCarga (db) {
    let somatorio = 0
    for (let volta = 0; volta < 20; volta++) {
      const linhas = db.prepare(`
        SELECT r.id, r.status, e.message_text, a.id AS auto_id, rev.doc_json
        FROM automation_runs r
        JOIN inbound_events e ON e.id = r.event_id
        JOIN automations a ON a.id = r.automation_id
        JOIN automation_revisions rev ON rev.automation_id = a.id AND rev.revision = r.automation_revision_id
        WHERE r.id % 3 = 0
        ORDER BY r.id DESC
      `).all()
      somatorio += linhas.length
    }
    return somatorio
  }

  // Mede com cache reduzido (1 MB)
  const dbCacheReduzido = abrirBanco(arqBancoTeste, { cacheMB: 1 })
  const t0Reduzido = performance.now()
  const linhasReduzido = executarCarga(dbCacheReduzido)
  const tempoReduzidoMs = performance.now() - t0Reduzido
  dbCacheReduzido.close()

  // Mede com cache maior (16 MB)
  const dbCacheMaior = abrirBanco(arqBancoTeste, { cacheMB: 16 })
  const t0Maior = performance.now()
  const linhasMaior = executarCarga(dbCacheMaior)
  const tempoMaiorMs = performance.now() - t0Maior
  dbCacheMaior.close()

  check('carga com cache de 1 MB executou com sucesso', linhasReduzido > 0, `linhas=${linhasReduzido}, tempo=${tempoReduzidoMs.toFixed(2)}ms`)
  check('carga com cache de 16 MB executou com sucesso', linhasMaior > 0, `linhas=${linhasMaior}, tempo=${tempoMaiorMs.toFixed(2)}ms`)
  check('ambas as execuções retornaram a mesma contagem de resultados', linhasReduzido === linhasMaior)

  console.log(`ℹ️  [BENCHMARK LOCAL] cache 1 MB: ${tempoReduzidoMs.toFixed(2)}ms | cache 16 MB: ${tempoMaiorMs.toFixed(2)}ms`)
  console.log('   (Obs: Medição ilustrativa local neste FS; não é promessa de ganho em produção.)')
} finally {
  try { fs.rmSync(pastaTmp, { recursive: true, force: true }) } catch {}
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nCACHE DO SQLITE OK')
process.exit(falhas ? 1 : 0)
