import { criarSenderRateLimiter } from '../src/engine/senderRateLimiter.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Test 1: Burst within limit passes
const rl = criarSenderRateLimiter({ maxTokens: 3, refillRate: 1, refillIntervalMs: 1000 })
check('primeiras 3 mensagens passam', rl.verificar('a') && rl.verificar('a') && rl.verificar('a'))
check('quarta mensagem é bloqueada', !rl.verificar('a'))

// Test 2: Different senders are independent
check('outro remetente não é afetado', rl.verificar('b'))

// Test 3: Tokens refill over time
await esperar(1100)
check('após 1s, token recarregou', rl.verificar('a'))

// Test 4: Disabled limiter (maxTokens=0) passes everything
const desativado = criarSenderRateLimiter({ maxTokens: 0 })
check('limiter desativado passa tudo', desativado.verificar('x'))

// Test 5: Invalid config falls back to defaults
const fallback = criarSenderRateLimiter({ maxTokens: -1, refillRate: NaN })
check('config inválida usa padrão (5 tokens)',
  fallback.verificar('c') && fallback.verificar('c') && fallback.verificar('c') &&
  fallback.verificar('c') && fallback.verificar('c') && !fallback.verificar('c'))

// Test 6: resetar clears specific sender
const rl2 = criarSenderRateLimiter({ maxTokens: 2, refillRate: 1, refillIntervalMs: 1000 })
rl2.verificar('d')
rl2.verificar('d')
check('sender d esgotado', !rl2.verificar('d'))
rl2.resetar('d')
check('após resetar d, passa de novo', rl2.verificar('d'))

// Test 7: estado returns snapshot
const estado = rl2.estado()
check('estado retorna Map com entradas', estado instanceof Map && estado.size > 0)

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1) }
console.log('\nTodos os testes de senderRateLimiter passaram.')