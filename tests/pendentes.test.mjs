// Testa o registro de pendências (criarRegistroPendentes) usado pela
// recuperação implícita do download automático: marca uma conversa quando a
// visu única chega travada, e espera a próxima citação do dono pra revelar.
import { criarRegistroPendentes } from '../src/capture.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

// Relógio falso, avançado manualmente — evita sleep real nos testes de TTL.
let agora = 1000
const relogio = () => agora

{
  const p = criarRegistroPendentes(1000, relogio)
  check('jid nunca marcado não tem pendência', p.temPendente('a') === false)
  p.marcar('a')
  check('jid marcado tem pendência', p.temPendente('a') === true)
  check('consumir remove e retorna true na primeira vez', p.consumir('a') === true)
  check('consumir de novo (já consumida) retorna false', p.consumir('a') === false)
  check('depois de consumida, não tem mais pendência', p.temPendente('a') === false)
}

{
  const p = criarRegistroPendentes(1000, relogio)
  p.marcar('b')
  agora += 500
  check('dentro do TTL ainda tem pendência', p.temPendente('b') === true)
  agora += 600 // total 1100ms > ttl de 1000ms
  check('depois do TTL não tem mais pendência', p.temPendente('b') === false)
  check('consumir depois do TTL retorna false', p.consumir('b') === false)
}

{
  const p = criarRegistroPendentes(1000, relogio)
  agora = 5000
  p.marcar('c')
  agora += 1500 // expira
  check('remarcar depois de expirado volta a funcionar', p.temPendente('c') === false)
  p.marcar('c')
  check('logo após remarcar, tem pendência de novo', p.temPendente('c') === true)
}

{
  const p = criarRegistroPendentes(1000, relogio)
  agora = 0
  p.marcar('d')
  agora = 100
  p.marcar('d') // marcar de novo atualiza o timestamp
  agora = 900 // 800ms desde o segundo marcar, ainda dentro do TTL
  check('marcar de novo atualiza o timestamp (não expira no TTL antigo)', p.temPendente('d') === true)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nPENDENTES OK')
process.exit(falhas ? 1 : 0)
