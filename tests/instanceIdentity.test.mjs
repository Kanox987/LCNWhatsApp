// resolverAccountId (src/engine/instanceIdentity.js) — Etapa 1 do motor de
// automação. Ordem de precedência: env.LCN_INSTANCE_ID > cfg.instancia.id >
// arquivo persistido > gerado uma vez.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolverAccountId } from '../src/engine/instanceIdentity.js'

let falhas = 0
const check = (nome, got, exp) => { const ok = got === exp; if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome.padEnd(55)} exp=${exp} got=${got}`) }

const pastaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-instance-identity-'))

try {
  check(
    'env.LCN_INSTANCE_ID vence tudo o mais',
    resolverAccountId({ env: { LCN_INSTANCE_ID: 'do-env' }, cfg: { instancia: { id: 'do-config' } }, pastaDados: pastaTmp }),
    'do-env'
  )

  check(
    'cfg.instancia.id vence o arquivo/gerado (sem env)',
    resolverAccountId({ env: {}, cfg: { instancia: { id: 'do-config' } }, pastaDados: pastaTmp }),
    'do-config'
  )

  // Sem env nem config: gera, persiste, e as chamadas SEGUINTES devolvem o
  // MESMO valor (estabilidade entre "reinícios" — aqui simulados por
  // chamadas separadas, já que resolverAccountId não guarda estado próprio).
  let contador = 0
  const gerarId = () => `gerado-${++contador}`
  const primeira = resolverAccountId({ env: {}, cfg: {}, pastaDados: pastaTmp, gerarId })
  check('sem env/config, gera um id novo', primeira, 'gerado-1')
  const segunda = resolverAccountId({ env: {}, cfg: {}, pastaDados: pastaTmp, gerarId })
  check('chamada seguinte reaproveita o id persistido (não gera outro)', segunda, 'gerado-1')

  const arquivo = path.join(pastaTmp, 'instance-id.txt')
  check('id persistido em disco de verdade', fs.existsSync(arquivo), true)
  check('conteúdo do arquivo bate com o id retornado', fs.readFileSync(arquivo, 'utf8').trim(), 'gerado-1')

  // cfg.instancia.id continua tendo prioridade sobre o arquivo já persistido.
  check(
    'cfg.instancia.id vence mesmo já havendo arquivo persistido',
    resolverAccountId({ env: {}, cfg: { instancia: { id: 'override' } }, pastaDados: pastaTmp, gerarId }),
    'override'
  )
} finally {
  fs.rmSync(pastaTmp, { recursive: true, force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE IDENTIDADE DE INSTÂNCIA PASSARAM')
process.exit(falhas ? 1 : 0)
