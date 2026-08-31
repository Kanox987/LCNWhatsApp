// Entry point exclusivo do build do .exe standalone (Node SEA, Windows) —
// ver build-exe.ps1. NÃO é usado por `npm start`/`npm run dashboard`/dev:
// index.js e src/dashboard.js continuam rodando direto com `node`, sem
// nenhuma mudança de comportamento fora do exe.
//
// import() dinâmico (não estático) é obrigatório: um import estático no topo
// executaria os efeitos colaterais dos dois módulos (abrir a conexão do bot
// E abrir o painel) ao mesmo tempo. A IIFE async evita top-level await, que
// o `esbuild --format=cjs` (exigido pelo SEA) não aceita.
;(async () => {
  if (process.argv.includes('--bot')) {
    await import('../index.js')
  } else {
    await import('../src/dashboard.js')
  }
})()
