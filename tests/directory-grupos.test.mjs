// Bug real achado testando a tela "Dados" do painel web (Módulo 3 da Parte
// C do plano): grupos apareciam com "id: undefined" no diretório. Causa:
// `atualizarGrupos()` lia `g.id`, mas o zapo-js real (`WaGroupMetadata`,
// node_modules/zapo-js/dist/client/coordinators/WaGroupCoordinator.d.ts)
// nunca tem campo `id` — o JID do grupo vem em `g.jid`. `id: undefined`
// é descartado pelo JSON.stringify, então `data/grupos.json` acabava
// gravando só `{ nome }`, sem jeito nenhum de endereçar o grupo depois
// (nem no seletor de escopo de automação, nem na tela de variáveis).
import fs from 'fs'
import { ARQ_GRUPOS } from '../src/paths.js'
import { atualizarGrupos, listarGrupos } from '../src/directory.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const backup = fs.existsSync(ARQ_GRUPOS) ? fs.readFileSync(ARQ_GRUPOS, 'utf8') : null
try {
  await atualizarGrupos({ group: { queryAllGroups: async () => ([
    { jid: '120363111111111111@g.us', subject: 'Grupo de Teste' },
    { jid: '120363222222222222@g.us', subject: '' }
  ]) } })
  const lista = listarGrupos()
  check('grava o JID real em `id` (campo correto do zapo-js é `jid`, não `id`)', lista[0].id === '120363111111111111@g.us')
  check('usa `subject` como nome quando presente', lista[0].nome === 'Grupo de Teste')
  check('sem subject, cai pro próprio JID como nome (nunca undefined)', lista[1].nome === '120363222222222222@g.us')
  check('sem subject, ainda assim grava o id certo', lista[1].id === '120363222222222222@g.us')

  await atualizarGrupos({ group: { queryAllGroups: async () => (
    new Map([['a', { jid: '111@g.us', subject: 'Via Map' }]])
  ) } })
  check('normaliza retorno em Map (formato alternativo já previsto)', listarGrupos()[0].id === '111@g.us')

  await atualizarGrupos({ group: { queryAllGroups: async () => ({ a: { jid: '222@g.us', subject: 'Via objeto' } }) } })
  check('normaliza retorno em objeto simples (formato alternativo já previsto)', listarGrupos()[0].id === '222@g.us')
} finally {
  if (backup !== null) fs.writeFileSync(ARQ_GRUPOS, backup)
  else fs.rmSync(ARQ_GRUPOS, { force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nDIRETÓRIO/GRUPOS OK')
process.exit(falhas ? 1 : 0)
