import * as bandwidth from '../src/bandwidth.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Sem limite, nem uma quantidade grande de bytes deve criar timer de espera.
bandwidth.configurar({ downloadBytesPerSecond: 0, uploadBytesPerSecond: null })
const semLimite = await Promise.race([
  Promise.all([
    bandwidth.aguardarDownload(100_000_000),
    bandwidth.aguardarUpload(100_000_000)
  ]).then(() => true),
  esperar(50).then(() => false)
])
check('0/null desativam o limite sem esperar', semLimite)

// As duas chamadas partem juntas. Com buckets separados por chamada ambas
// terminariam em ~100 ms; compartilhando o bucket, os 200 bytes levam ~200 ms.
bandwidth.configurar({ downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 })
bandwidth.configurar({ downloadBytesPerSecond: 1000, uploadBytesPerSecond: 0 })
const inicioConcorrente = Date.now()
await Promise.all([
  bandwidth.aguardarDownload(100),
  bandwidth.aguardarDownload(100)
])
const tempoConcorrente = Date.now() - inicioConcorrente
check('downloads concorrentes dividem o mesmo bucket', tempoConcorrente >= 170 && tempoConcorrente < 800)

// Depois de ficar ocioso, o bucket deve reaproveitar os tokens acumulados.
bandwidth.configurar({ downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 })
bandwidth.configurar({ downloadBytesPerSecond: 1000, uploadBytesPerSecond: 0 })
await esperar(130)
const inicioRefill = Date.now()
await bandwidth.aguardarDownload(100)
const tempoRefill = Date.now() - inicioRefill
check('refill acumula tokens ao longo do tempo', tempoRefill < 50)

bandwidth.configurar({ downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 })

if (falhas) {
  console.error(`\n${falhas} teste(s) falharam.`)
  process.exit(1)
}
console.log('\nTodos os testes de bandwidth passaram.')
