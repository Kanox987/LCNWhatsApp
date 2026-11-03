// Frente E, segunda metade: COMO o teto do administrador chega ao processo que
// tem de obedecê-lo.
//
// `registry.json` NÃO é montado no container (src/instances/quadlet.js, bloco
// de Volume=), de propósito: a instância não pode ler nem reescrever o teto que
// lhe deram. Então a concessão viaja pelo AMBIENTE, escrito pelo lado do
// administrador — na unit do quadlet para instância gerenciada, no ambiente do
// spawn no modo bare.
//
// Este arquivo prova as três pontas desse caminho: o que se serializa, o que o
// processo lê, e o que o consumidor real obedece. Sem isto, "o painel recusa
// acima do teto" seria a única garantia — e limite que o runtime não obedece é
// limite que não existe.
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  CHAVE_DE_AMBIENTE, serializarConcessoes, concessoesDoProcesso,
  esquecerConcessoesDoProcesso
} from '../src/agent/concessoes.js'
import { limitesDeMidia } from '../src/mediaLimits.js'
import { gerarQuadlet } from '../src/instances/quadlet.js'
import { criarInstanceService } from '../src/agent/instanceService.js'
import { abrirBanco, resolverCacheSqliteKiB } from '../src/engine/server/db.js'
import { ambienteDoBot } from '../src/runtime.js'

let falhas = 0
const check = (nome, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
  if (!ok) console.log(`   exp=${JSON.stringify(exp)} got=${JSON.stringify(got)}`)
}
const checkBool = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

// Guarda o ambiente de quem roda a bateria: nenhum teste pode deixar
// LCN_CONCESSOES sujo para o arquivo seguinte da cadeia do npm test.
const ambienteOriginal = process.env[CHAVE_DE_AMBIENTE]
function comAmbiente (valor, fn) {
  if (valor === null) delete process.env[CHAVE_DE_AMBIENTE]
  else process.env[CHAVE_DE_AMBIENTE] = valor
  esquecerConcessoesDoProcesso()
  try { return fn() } finally {
    if (ambienteOriginal === undefined) delete process.env[CHAVE_DE_AMBIENTE]
    else process.env[CHAVE_DE_AMBIENTE] = ambienteOriginal
    esquecerConcessoesDoProcesso()
  }
}

// --- 1. o que se serializa -------------------------------------------------
// Chave desconhecida fora: o que entra no ambiente é o que `PARAMETROS`
// reconhece, senão um registro editado à mão viraria ambiente arbitrário.
check('serializar mantém campo conhecido',
  serializarConcessoes({ 'hardware.maxMidiaMB': 30 }),
  '{"hardware.maxMidiaMB":30}')
check('serializar descarta chave desconhecida',
  serializarConcessoes({ 'hardware.maxMidiaMB': 30, 'hardware.inventado': 1 }),
  '{"hardware.maxMidiaMB":30}')
// `null` é como o painel RETIRA uma concessão. Retirada não viaja: o que viaja
// é o teto que ficou, e campo sem teto volta ao padrão por ausência.
check('serializar descarta null e undefined',
  serializarConcessoes({ 'hardware.maxMidiaMB': null, 'download.limiteMB': undefined }),
  '')
check('serializar sem concessão devolve vazio', serializarConcessoes({}), '')
check('serializar aceita nulo sem lançar', serializarConcessoes(null), '')
// Nenhum valor aceito contém aspa simples (número, booleano, lista fechada) —
// é o que permite citar o valor com aspa simples na unit do systemd.
checkBool('nenhum valor serializado contém aspa simples',
  !serializarConcessoes({
    'hardware.maxMidiaMB': 30,
    'hardware.modoEconomia': true,
    'hardware.aparelho.navegador': 'firefox'
  }).includes("'"))

// --- 2. o que o processo lê ------------------------------------------------
comAmbiente('{"hardware.maxMidiaMB":30}', () => {
  check('ambiente válido é lido', concessoesDoProcesso(), { 'hardware.maxMidiaMB': 30 })
})
comAmbiente(null, () => {
  check('sem ambiente não há concessão', concessoesDoProcesso(), {})
})
// Ambiente torto NÃO pode impedir o bot de subir: cai para "sem teto", que é o
// comportamento de antes desta camada.
comAmbiente('isto não é json', () => {
  check('ambiente ilegível cai para sem concessão', concessoesDoProcesso(), {})
})
comAmbiente('{"hardware.maxMidiaMB":"gigante"}', () => {
  check('ambiente com valor inválido cai para sem concessão', concessoesDoProcesso(), {})
})
comAmbiente('{"hardware.inventado":1}', () => {
  check('ambiente com chave desconhecida é descartado', concessoesDoProcesso(), {})
})

// --- 3. o que o consumidor real obedece -----------------------------------
const MB = 1024 * 1024
const cfgPedindoMuito = { hardware: { maxMidiaMB: 200 }, download: { limiteMB: 200 } }
comAmbiente(null, () => {
  check('sem teto, a preferência do cliente vale',
    limitesDeMidia(cfgPedindoMuito).geral, 200 * MB)
})
comAmbiente('{"hardware.maxMidiaMB":30}', () => {
  const l = limitesDeMidia(cfgPedindoMuito)
  check('teto do ambiente corta o tamanho de mídia', l.geral, 30 * MB)
  // O limite específico não pode furar o geral: baixar o geral baixa os dois.
  check('o limite de download não fura o teto geral', l.download, 30 * MB)
})
comAmbiente('{"download.limiteMB":10}', () => {
  const l = limitesDeMidia(cfgPedindoMuito)
  check('teto de download vale sozinho', l.download, 10 * MB)
  check('teto de download não baixa o teto geral', l.geral, 200 * MB)
})
// Guarda da regressão que a bateria pegou: com `maxMidiaMB` AUSENTE, o padrão
// dele (60) não pode cortar um `download.limiteMB` que a pessoa escolheu — se
// cortasse, subir o limite de download sozinho não faria nada. Padrão não é
// teto; teto é do administrador, e aí corta (ver os dois casos acima).
check('o padrão do teto geral não corta o download escolhido',
  limitesDeMidia({ download: { limiteMB: 64 } }).download, 64 * MB)
check('mas o teto geral ESCOLHIDO pelo cliente corta',
  limitesDeMidia({ hardware: { maxMidiaMB: 50 }, download: { limiteMB: 64 } }).download, 50 * MB)

// A função continua PURA para quem passa o mapa: é o que deixa o resto da
// bateria medir resolução de limite sem mexer no ambiente do processo.
check('quem passa o mapa não depende do ambiente',
  limitesDeMidia(cfgPedindoMuito, { 'hardware.maxMidiaMB': 5 }).geral, 5 * MB)

// --- 4. o cache do SQLite, cortado na abertura ----------------------------
// `cache_size` negativo é em KiB (convenção do SQLite), por isso o sinal.
comAmbiente('{"hardware.cacheSqliteMB":2}', () => {
  const db = abrirBanco(':memory:')
  try {
    const kib = resolverCacheSqliteKiB(2)
    check('cache do banco é cortado pelo teto do ambiente',
      db.pragma('cache_size', { simple: true }), -kib)
  } finally { db.close() }
})

// --- 5. a unit do quadlet, que é o caminho da instância gerenciada --------
const pastaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-concessoes-entrega-'))
const instancia = {
  instanceId: 'wa-000009',
  label: 'Entrega',
  dataDir: path.join(pastaTmp, 'wa-000009'),
  containerName: 'lcn-wa-000009',
  resources: {},
  createdAt: '2026-01-01T00:00:00.000Z'
}
const semConcessao = gerarQuadlet(instancia)
checkBool('unit sem concessão não carrega a linha de ambiente',
  !semConcessao.includes(CHAVE_DE_AMBIENTE))
const comConcessao = gerarQuadlet(instancia, { 'hardware.maxMidiaMB': 30 })
checkBool('unit com concessão carrega a linha de ambiente',
  comConcessao.includes(`Environment=${CHAVE_DE_AMBIENTE}='{"hardware.maxMidiaMB":30}'`))
// Aspa SIMPLES: o JSON carrega aspa dupla, e o systemd a leria como quoting.
const linha = comConcessao.split('\n').find((l) => l.includes(CHAVE_DE_AMBIENTE))
checkBool('o valor é citado com aspa simples', /='.*'$/.test(linha.trim()))
// `registry.json` continua FORA dos volumes: é o que torna o ambiente o único
// caminho possível. Se um dia for montado, este teste é o lugar de discutir.
checkBool('a unit não monta o registro no container',
  !comConcessao.includes('registry.json'))

// --- 6. gravar a concessão REESCREVE a unit -------------------------------
// Sem isto a concessão valeria só no painel e o runtime seguiria com o valor
// antigo: o registro não é lido de dentro do container.
const unitFile = path.join(pastaTmp, 'lcn-wa-000009.container')
fs.writeFileSync(unitFile, 'unit antiga')
const registro = {
  version: 1,
  nextSeq: 2,
  instances: { 'wa-000009': { ...instancia, unitFile } },
  grants: {}
}
let gravado = null
const servico = criarInstanceService({
  exec: () => ({ ok: true, status: 0, stdout: '', stderr: '' }),
  obterRegistro: () => registro,
  gravarRegistro: (novo) => { gravado = novo; registro.grants = novo.grants },
  caminhoInstanciaFn: (id) => path.join(pastaTmp, id),
  nomeContainerFn: (id) => `lcn-${id}`
})
const resultado = servico.definirConcessoes('wa-000009', { 'hardware.maxMidiaMB': 30 })
check('a concessão é gravada no registro',
  gravado.grants['wa-000009'], { 'hardware.maxMidiaMB': 30 })
checkBool('a unit foi reescrita',
  fs.readFileSync(unitFile, 'utf8').includes(`Environment=${CHAVE_DE_AMBIENTE}='{"hardware.maxMidiaMB":30}'`))
// A tela TEM de dizer isto: quem reduz uma cota, vê o número novo no painel e
// não reinicia, acha que já está valendo. Não reiniciamos por conta própria —
// derrubar o serviço de um cliente sem ninguém pedir seria pior que o atraso.
check('a resposta avisa que falta reiniciar', resultado.precisaReiniciar, true)
check('a resposta devolve a concessão em vigor',
  resultado.concessoes, { 'hardware.maxMidiaMB': 30 })
// Retirar a concessão limpa a linha da unit, senão o teto sobreviveria à
// própria remoção até o próximo reinício.
servico.definirConcessoes('wa-000009', { 'hardware.maxMidiaMB': null })
checkBool('retirar a concessão limpa a linha da unit',
  !fs.readFileSync(unitFile, 'utf8').includes(CHAVE_DE_AMBIENTE))

// Sem unit no disco não há o que reescrever, e isso NÃO é erro: a concessão já
// está no registro e o painel já a mostra. Só não há reinício a pedir.
fs.rmSync(unitFile)
const semUnit = servico.definirConcessoes('wa-000009', { 'hardware.maxMidiaMB': 20 })
check('sem unit no disco não se promete reinício', semUnit.precisaReiniciar, false)
check('e a concessão continua gravada',
  semUnit.concessoes, { 'hardware.maxMidiaMB': 20 })

fs.rmSync(pastaTmp, { recursive: true, force: true })

// --- 5. a ponta que faltava: o modo BARE ------------------------------------
// Instância gerenciada recebe o teto pela unit; o bare recebe pelo ambiente do
// spawn, e esse era o único trecho da entrega sem prova. O que se prova aqui é
// a DECISÃO, não o spawn: `iniciarBot` nasce um processo solto que nenhum teste
// pode acordar sem subir o bot de verdade, então o que decide o ambiente mora
// em `ambienteDoBot` e é essa função que responde.
const bareSemTeto = ambienteDoBot({ registro: { grants: {} } })
check('sem concessão, nada é acrescentado ao ambiente', bareSemTeto, {})
// Importa que seja VAZIO, não que a chave venha vazia: `iniciarBot` só monta um
// `env` quando há algo a acrescentar, e passar um ambiente montado no caminho
// normal mudaria o que o bot herda por causa de um recurso que ele não usa.
checkBool('e por isso o spawn segue herdando o ambiente', Object.keys(bareSemTeto).length === 0)

const bareComTeto = ambienteDoBot({ registro: { grants: { bare: { 'hardware.maxMidiaMB': 20 } } } })
check('com concessão do bare, o teto viaja pelo ambiente',
  bareComTeto[CHAVE_DE_AMBIENTE], serializarConcessoes({ 'hardware.maxMidiaMB': 20 }))
check('e o processo lê de volta o que foi escrito',
  (() => { process.env[CHAVE_DE_AMBIENTE] = bareComTeto[CHAVE_DE_AMBIENTE]; esquecerConcessoesDoProcesso(); const lido = concessoesDoProcesso(); delete process.env[CHAVE_DE_AMBIENTE]; esquecerConcessoesDoProcesso(); return lido })(),
  { 'hardware.maxMidiaMB': 20 })

// A concessão de OUTRA instância não é do bare. `grants` é por instância, e ler
// a chave errada daria ao bare um teto que ninguém lhe deu — ou esconderia o
// que lhe deram.
check('concessão de outra instância não vira ambiente do bare',
  ambienteDoBot({ registro: { grants: { 'wa-000001': { 'hardware.maxMidiaMB': 5 } } } }), {})

// Registro ausente ou ilegível não pode impedir o bot de subir: cai para "sem
// concessão", que é o comportamento de antes desta camada.
check('registro ilegível não derruba a subida', ambienteDoBot({ registro: null }), {})

// E o pareamento por código continua no mesmo ambiente, sem um excluir o outro.
const juntos = ambienteDoBot({ pairNumber: '5511999999999', registro: { grants: { bare: { 'hardware.maxMidiaMB': 20 } } } })
checkBool('número de pareamento e concessão convivem',
  juntos.LCN_PAIR_NUMBER === '5511999999999' && Boolean(juntos[CHAVE_DE_AMBIENTE]))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ENTREGA DE CONCESSÃO PASSARAM')
process.exit(falhas ? 1 : 0)
