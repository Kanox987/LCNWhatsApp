#!/usr/bin/env node
// Ponto de entrada spawnado por `lcn web start` (cli.js) como processo
// destacado. Separado de server.js de propósito: server.js exporta a
// função reutilizável (testada com uma porta efêmera em tests/web-server.test.mjs);
// este arquivo só chama ela com a porta real e mantém o processo vivo.
import { iniciarServidorWeb } from './server.js'

const port = Number(process.env.LCN_WEB_PORT || 4780)

iniciarServidorWeb({ host: '127.0.0.1', port }).then(({ port: portaReal }) => {
  console.log(`[web] painel local rodando em http://127.0.0.1:${portaReal}`)
}).catch((erro) => {
  console.error('[web] falha ao iniciar o painel:', erro)
  process.exitCode = 1
})
