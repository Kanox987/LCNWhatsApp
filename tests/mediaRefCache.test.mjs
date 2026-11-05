// mediaRefCache (src/engine/mediaRefCache.js) — garante que um mediaRef
// (pode carregar mediaKey/directPath de verdade) vira um token opaco que só
// o MESMO processo consegue resolver, nunca um objeto serializável.
import { criar, resolver, _reiniciarParaTeste, _tamanho } from '../src/engine/mediaRefCache.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

_reiniciarParaTeste()

const segredo = { node: { mediaKey: 'super-secreto', directPath: '/v/abc' }, tipo: 'image' }
const token = criar(segredo)

check('token gerado é uma string (não o objeto em si)', typeof token === 'string')
check('token não "parece" um objeto serializado (não contém a chave mediaKey)', !token.includes('mediaKey'))
check('resolver(token) devolve o objeto original', resolver(token) === segredo)
check('resolver com token desconhecido devolve null', resolver('token-que-nunca-existiu') === null)

// TTL curto — expira e some.
_reiniciarParaTeste()
const tokenCurto = criar({ x: 1 }, 20)
check('token recém-criado resolve normalmente', resolver(tokenCurto) !== null)
await esperar(40)
check('token expira depois do TTL', resolver(tokenCurto) === null)

// Isolamento entre tokens diferentes.
_reiniciarParaTeste()
const a = criar({ quem: 'a' })
const b = criar({ quem: 'b' })
check('tokens diferentes não colidem', resolver(a)?.quem === 'a' && resolver(b)?.quem === 'b')

// Teto de entradas: o TTL sozinho não limita a quantidade.
{
  _reiniciarParaTeste()
  const antes = process.env.LCN_MAX_MEDIAREFS
  process.env.LCN_MAX_MEDIAREFS = '3'
  const devolvidos = []
  const tokens = [0, 1, 2, 3, 4].map((i) => criar({ i }, undefined, () => devolvidos.push(i)))
  check('passou do teto: a memória fica no teto', _tamanho() === 3, String(_tamanho()))
  check('as mais antigas saíram e devolveram a reserva (aoDescartar)', devolvidos.join() === '0,1')
  check('as mais antigas já não resolvem', resolver(tokens[0]) === null && resolver(tokens[1]) === null)
  check('as mais novas continuam resolvendo', resolver(tokens[2])?.i === 2 && resolver(tokens[4])?.i === 4)
  if (antes === undefined) delete process.env.LCN_MAX_MEDIAREFS; else process.env.LCN_MAX_MEDIAREFS = antes
  _reiniciarParaTeste()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO CACHE DE MEDIA REF PASSARAM')
process.exit(falhas ? 1 : 0)
