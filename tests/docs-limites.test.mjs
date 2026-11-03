// Guarda de que docs/engineering/lcn-v2/INSTANCE_LIMITS.md não divergiu de
// src/agent/concessoes.js. A lição que este projeto já pagou: documento escrito
// à mão ao lado de uma tabela no código vira mentira na primeira mudança, e
// ninguém percebe porque nenhum teste afirma a igualdade.
//
// Se este teste falhar, NÃO edite o markdown: rode `npm run docs:limites`.
import fs from 'fs'
import { gerar, DESTINO } from '../tools/gerar-instance-limits.mjs'
import { PARAMETROS, CAMPOS } from '../src/agent/concessoes.js'

let falhas = 0
const checkBool = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const existe = fs.existsSync(DESTINO)
checkBool('o documento existe no repositório', existe)

const noDisco = existe ? fs.readFileSync(DESTINO, 'utf8') : ''
const gerado = gerar()
checkBool('o documento no disco é igual ao gerado da tabela (senão: npm run docs:limites)', noDisco === gerado)
if (existe && noDisco !== gerado) {
  console.log(`   disco=${noDisco.length} chars, gerado=${gerado.length} chars`)
}

// Cada campo da tabela aparece no documento. Protege do caso em que alguém
// acrescenta parâmetro e o gerador cala sobre ele.
for (const chave of CAMPOS) {
  checkBool(`o documento cita \`${chave}\``, gerado.includes(`### \`${chave}\``))
}

// As quatro perguntas do pedido que são fáceis de esquecer numa reescrita.
checkBool('o documento diz onde a concessão mora', gerado.includes('registry.json'))
checkBool('o documento explica por que não é Math.min() em tudo', gerado.includes('Math.min'))
checkBool('o documento diz o que acontece ao reduzir a quota', gerado.includes('ao reduzir a quota'))
checkBool('o documento declara a falta de autenticação do painel', gerado.includes('src/web/server.js:15'))

// Enforcement que ainda não chega ao consumidor tem de estar DITO, não omitido.
const semLeitor = CAMPOS.filter((c) => !PARAMETROS[c].enforcement.concessaoChega)
checkBool('existe seção "O que falta"', gerado.includes('O que falta, dito de forma honesta'))
for (const chave of semLeitor) {
  checkBool(`\`${chave}\` aparece como enforcement pendente`, gerado.includes(`- \`${chave}\` —`))
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodas as checagens passaram')
process.exit(falhas ? 1 : 0)
