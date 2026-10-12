// A chave `atualizacao.autoUpdateBaileys` virou `autoUpdateLib` na migração da
// biblioteca, e o nome velho ficou nos config.json de quem instalou antes.
//
// Isto NÃO era cosmético. O código lê `autoUpdateLib`; quem tinha a chave velha
// marcava "ligado" e a funcionalidade seguia desligada, sem nada avisando —
// mesma família do painel dizendo "Conectado" para um bot que não está rodando.
//
// Usa o config.json REAL com backup, no mesmo padrão da outra migração de
// compatibilidade: o caminho vem de `src/paths.js`, derivado da posição do
// módulo, e não há como apontá-lo para outro lugar. (Aprendi tentando: uma
// variável de ambiente inventada não redireciona nada, e o teste acabou
// migrando o arquivo de verdade.)
import fs from 'fs'
import { ARQ_CONFIG } from '../src/paths.js'
import * as cfgMod from '../src/config.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const backup = fs.existsSync(ARQ_CONFIG) ? fs.readFileSync(ARQ_CONFIG, 'utf8') : null

function comConfig (atualizacao, extra = {}) {
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify({ atualizacao, ...extra }, null, 2))
  const cfg = cfgMod.carregar()
  return { cfg, noDisco: JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8')) }
}

try {
  {
    const { cfg, noDisco } = comConfig(
      { autoUpdateBaileys: true, falhasParaUpdate: 7 },
      { destino: { tipo: 'self' } }
    )
    check('o valor LIGADO é preservado no nome novo', cfg.atualizacao.autoUpdateLib === true)
    check('a chave velha sai do objeto', !('autoUpdateBaileys' in cfg.atualizacao))
    check('e sai do arquivo em disco', !('autoUpdateBaileys' in noDisco.atualizacao))
    check('o nome novo é persistido', noDisco.atualizacao.autoUpdateLib === true)
    // Migração que apaga configuração vizinha é pior que não migrar.
    check('o resto da seção é preservado', cfg.atualizacao.falhasParaUpdate === 7)
    check('e as outras seções também', cfg.destino.tipo === 'self')
  }

  {
    const { cfg } = comConfig({ autoUpdateBaileys: false })
    check('desligado continua desligado', cfg.atualizacao.autoUpdateLib === false)
  }

  {
    // O nome novo é o que o código lê, então é o que reflete o que está
    // valendo hoje — o velho não pode sobrescrevê-lo.
    const { cfg } = comConfig({ autoUpdateBaileys: true, autoUpdateLib: false })
    check('com os dois nomes, o NOVO ganha', cfg.atualizacao.autoUpdateLib === false)
  }

  {
    const { cfg } = comConfig({ autoUpdateLib: true })
    check('config já migrado passa intacto', cfg.atualizacao.autoUpdateLib === true)
  }
} finally {
  if (backup !== null) fs.writeFileSync(ARQ_CONFIG, backup)
  else fs.rmSync(ARQ_CONFIG, { force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nMIGRAÇÃO DO NOME DO AUTO-UPDATE OK')
process.exit(falhas ? 1 : 0)
