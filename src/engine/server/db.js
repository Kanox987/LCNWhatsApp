import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { ARQ_DB } from '../paths.js'
import { garantirMenuPadrao } from './menuPadrao.js'
import { carregar, PADRAO } from '../../config.js'
import { valorEfetivo, concessoesDoProcesso } from '../../agent/concessoes.js'

const PASTA_MIGRACOES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

// Padrão de cache em MB para o SQLite do motor central.
// 4 MB mantém cerca de 1000 páginas de 4 KiB em memória — cobre as tabelas de
// automações, revisões, pools, donos e execuções recentes sem inflar a RAM.
export const PADRAO_CACHE_SQLITE_MB = 4

// Converte megabytes para kibibytes (KiB) para aplicação segura no SQLite.
//
// ATENÇÃO AO SINAL DO PRAGMA (ARMADILHA DO SQLITE):
// No SQLite:
//   - Valor NEGATIVO (-N) significa tamanho em KIBIBYTES (-N KiB).
//   - Valor POSITIVO (+N) significa NÚMERO DE PÁGINAS (+N páginas).
//
// Com páginas de 4096 bytes (padrão atual), trocar o sinal por engano muda o
// consumo por um fator enorme sem dar erro: `4096` viraria 4096 páginas = 16 MiB
// em vez de 4096 KiB = 4 MiB. Se alguém configurar 64 MB e esquecer o sinal
// negativo, `64` vira 64 páginas = 256 KiB (cache estrangulado)!
// Por isso, convertemos MB para KiB e APLICAMOS SEMPRE COM SINAL NEGATIVO (`-<KiB>`).
//
// PADRÃO SENSATO SIM, TETO NO CÓDIGO NÃO:
// O padrão adotado é 4 MB (4096 KiB). Em engine.sqlite, isso comporta cerca de
// 1000 páginas de 4 KiB — suficiente para manter em memória todo o conjunto
// quente de automações, revisões e execuções recentes (varridas pela retenção),
// economizando 75% da RAM do cache sem estrangular o I/O.
//
// A ARMADILHA DE MEDIÇÃO:
// Reduzir o cache troca memória por leitura de disco. Diminuir sem medir pode
// deixar o sistema mais lento em troca de poucos megabytes — e aí o conserto
// é pior que a doença. O valor padrão de 4 MB é uma estimativa honesta de
// arranque, mas o valor ideal para produção dependerá de medições com carga real
// e múltiplos números conectados que ainda não foram feitas. Quem roda em
// máquina folgada pode subir via config.json (hardware.cacheSqliteMB); quem
// estiver muito apertado pode descer.
export function resolverCacheSqliteKiB (valorMB, padraoMB = PADRAO_CACHE_SQLITE_MB) {
  const n = Number(valorMB)
  // Aceita número positivo; se alguém por vício do SQLite passou negativo no config
  // (ex: -4 achando que a chave já pedia o sinal do pragma), Math.abs protege.
  const mb = Number.isFinite(n) && n !== 0 ? Math.abs(n) : padraoMB
  return Math.round(mb * 1024)
}

function listarMigracoes (pasta) {
  return fs.readdirSync(pasta)
    .filter((nome) => /^\d+_.+\.sql$/.test(nome))
    .sort()
    .map((nome) => ({
      nome,
      version: Number(nome.match(/^(\d+)/)[1]),
      sql: fs.readFileSync(path.join(pasta, nome), 'utf8')
    }))
}

export function rodarMigrations (db, pastaMigracoes = PASTA_MIGRACOES) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)

  const aplicada = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
  const registrar = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
  const aplicar = db.transaction(({ version, sql }) => {
    if (aplicada.get(version)) return
    db.exec(sql)
    registrar.run(version, new Date().toISOString())
  })

  for (const migration of listarMigracoes(pastaMigracoes)) aplicar(migration)
}

export function abrirBanco (arquivo = ARQ_DB, { pastaMigracoes = PASTA_MIGRACOES, cacheMB, cacheSqliteMB, cfg } = {}) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 })
  try { fs.chmodSync(path.dirname(arquivo), 0o700) } catch {}

  const db = new Database(arquivo)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')

    const configMB = cacheMB ?? cacheSqliteMB ?? cfg?.hardware?.cacheSqliteMB
    const mbEfetivo = configMB !== undefined
      ? configMB
      : (() => {
          try { return carregar()?.hardware?.cacheSqliteMB } catch { return PADRAO?.hardware?.cacheSqliteMB }
        })()
    // O teto do administrador vale na LEITURA também: cache pedido acima da
    // concessão é cortado aqui, não só recusado na gravação pelo painel.
    const kib = resolverCacheSqliteKiB(
      valorEfetivo('hardware.cacheSqliteMB', { hardware: { cacheSqliteMB: mbEfetivo } }, concessoesDoProcesso())
    )
    db.pragma(`cache_size = -${kib}`)

    rodarMigrations(db, pastaMigracoes)
    garantirMenuPadrao(db)
    if (arquivo !== ':memory:') {
      try { fs.chmodSync(arquivo, 0o600) } catch {}
    }
    return db
  } catch (erro) {
    db.close()
    throw erro
  }
}
