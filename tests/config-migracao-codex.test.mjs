// Testa a migração automática de config.json antigo com
// transcricao.provedor === "codex" (provedor removido) para "off", sem
// apagar o resto da configuração do usuário.
import fs from 'fs'
import { ARQ_CONFIG } from '../src/paths.js'
import * as cfgMod from '../src/config.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const backup = fs.existsSync(ARQ_CONFIG) ? fs.readFileSync(ARQ_CONFIG, 'utf8') : null
try {
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify({
    destino: { tipo: 'numero', jid: '5511999999999@s.whatsapp.net' },
    transcricao: { provedor: 'codex', codexModelo: 'algum-modelo', idioma: 'pt' }
  }, null, 2))

  const cfg = cfgMod.carregar()
  check('provedor "codex" migrado para "off"', cfg.transcricao.provedor === 'off')
  check('codexModelo removido do objeto em memória', !('codexModelo' in cfg.transcricao))
  check('idioma (outra opção do usuário) preservado', cfg.transcricao.idioma === 'pt')
  check('destino (outra seção do usuário) preservado', cfg.destino.tipo === 'numero' && cfg.destino.jid === '5511999999999@s.whatsapp.net')

  const salvo = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'))
  check('migração persistida no disco (provedor)', salvo.transcricao.provedor === 'off')
  check('migração persistida no disco (sem codexModelo)', !('codexModelo' in salvo.transcricao))

  // provedor não-codex não deve ser alterado.
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify({ transcricao: { provedor: 'openai', openaiApiKey: 'x' } }, null, 2))
  const cfg2 = cfgMod.carregar()
  check('provedor não-codex não é alterado pela migração', cfg2.transcricao.provedor === 'openai')
} finally {
  if (backup !== null) fs.writeFileSync(ARQ_CONFIG, backup)
  else fs.rmSync(ARQ_CONFIG, { force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nMIGRAÇÃO CODEX->OFF OK')
process.exit(falhas ? 1 : 0)
