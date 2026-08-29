// Bug real reportado pelo usuário: mídia recuperada via /recover ficava
// arquivada com o nome "recuperado via /recover" (o comando) em vez do nome
// do contato/conversa. resolverNomeContato() busca o nome de verdade no
// diretório conhecido (data/contatos.json), com fallback pra "sem nome".
import fs from 'fs'
import { ARQ_CONTATOS } from '../src/paths.js'
import { resolverNomeContato } from '../src/capture.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const backup = fs.existsSync(ARQ_CONTATOS) ? fs.readFileSync(ARQ_CONTATOS, 'utf8') : null
try {
  fs.writeFileSync(ARQ_CONTATOS, JSON.stringify([
    { numero: '5511999999999', nome: 'Fulano de Tal' },
    { numero: '5511888888888', nome: '' }
  ], null, 2))

  check('contato conhecido: retorna o nome real (não o texto do comando)', resolverNomeContato('5511999999999') === 'Fulano de Tal')
  check('nunca retorna o literal "recuperado via /recover"', resolverNomeContato('5511999999999') !== 'recuperado via /recover')
  check('contato sem nome salvo: cai no fallback "sem nome"', resolverNomeContato('5511888888888') === 'sem nome')
  check('contato desconhecido: cai no fallback "sem nome"', resolverNomeContato('5511000000000') === 'sem nome')
} finally {
  if (backup !== null) fs.writeFileSync(ARQ_CONTATOS, backup)
  else fs.rmSync(ARQ_CONTATOS, { force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nRECOVER/NOME DO CONTATO OK')
process.exit(falhas ? 1 : 0)
