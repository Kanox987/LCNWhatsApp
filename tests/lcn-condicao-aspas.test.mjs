// O operador de uma condição é a primeira ocorrência FORA de aspas.
//
// Antes, `lerCondicao` procurava o símbolo mais longo no corpo inteiro: um
// literal como "x contém y" roubava o lugar do `==` e a condição era recusada
// com "não entendi o operando". A recusa era alta e nada corrompia, mas quem
// escreve a regra não tinha como dizer essa frase.
import assert from 'node:assert/strict'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }

const cab = ['automação', '  nome: t', '  tipo: comando', '  dispara com: /t', '  acessa: texto', '  casa: exato', '  quem: qualquer um', '']
const fonte = (cond) => [...cab, `  se ${cond}`, '    responde "sim"', '  senão', '    responde "não"', ''].join('\n')
const no = (doc) => (doc.flow?.nodes || doc.nodes).find((n) => n.type === 'condition.compare').config

const casos = [
  ['literal com operador simbólico', 'evento message.text == "a == b"', 'eq', 'a == b'],
  ['literal com palavra de operador', 'evento message.text == "x contém y"', 'eq', 'x contém y'],
  ['literal com operador composto', 'evento message.text == "não contém"', 'eq', 'não contém'],
  ['literal com <= dentro', 'evento message.text == "1 <= 2"', 'eq', '1 <= 2'],
  ['operador real é contém, literal com ==', 'evento message.text contém "== "', 'contains', '== '],
  ['aspas escapadas dentro do literal', 'evento message.text == "diz \\"a contém b\\" ok"', 'eq', 'diz "a contém b" ok']
]

for (const [nome, cond, operador, valor] of casos) {
  const doc = compilar(fonte(cond), { agora: new Date() })
  const cfg = no(doc)
  check(`${nome}: operador ${operador}`, cfg.operator === operador)
  check(`${nome}: literal preservado`, cfg.right.value === valor)
  const volta = compilar(descompilar(doc), { agora: new Date() })
  check(`${nome}: ida e volta idêntica`, JSON.stringify(no(volta)) === JSON.stringify(cfg))
}

// Os casos de sempre não mudam.
{
  const cfg = no(compilar(fonte('evento message.text não contém "oi"'), { agora: new Date() }))
  check('"não contém" fora de aspas continua sendo o operador composto', cfg.operator === 'not_contains')
}
{
  let erro
  try { compilar(fonte('evento message.text "sem operador"'), { agora: new Date() }) } catch (e) { erro = e }
  check('condição sem operador continua recusada', /operador/.test(String(erro?.message)))
}
{
  let erro
  try { compilar(fonte('"só == dentro de aspas"'), { agora: new Date() }) } catch (e) { erro = e }
  check('operador só dentro de aspas não conta como operador', /operador/.test(String(erro?.message)))
}

console.log(`\n${checagens} CHECAGENS PASSARAM`)
process.exit(0)
