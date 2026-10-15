// Criar e remover um número pelo painel, sem terminal.
//
// POR QUE IMPORTA. Era a última coisa que só a linha de comando fazia
// (`LCN_INSTANCIA=pessoal node index.js`), e o dono repetiu a razão de isso
// não servir: "os clientes não vão ter acesso ao terminal se eu ou outra
// pessoa alugar o sistema".
//
// O PONTO DELICADO é que este é o único lugar onde um texto que vem de fora
// decide um DIRETÓRIO. O acervo resolveu o mesmo problema gerando o id e nunca
// derivando caminho do nome; aqui o nome é a identidade, então ele é saneado
// antes de virar caminho, com a mesma lista de caracteres que a varredura
// aceita — um nome que passasse aqui e fosse ignorado lá criaria uma pasta
// fantasma.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { criarInstanceService } from '../src/agent/instanceService.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-inst-'))
const bareEstado = path.join(tmp, 'state.json')
fs.writeFileSync(bareEstado, JSON.stringify({ conectado: false }))

const service = criarInstanceService({
  bareArqEstado: bareEstado,
  bareArqConfig: path.join(tmp, 'config.json'),
  bareStatusServico: () => 'parado',
  obterRegistro: () => ({ instances: [] }),
  exec: () => ({ ok: true, stdout: '', stderr: '', status: 0 })
})

const raizInstancias = path.join(tmp, 'instancias')
const erroDe = (fn) => { try { fn(); return null } catch (e) { return e.message } }

// --- criar ---------------------------------------------------------------
{
  const criada = service.criar('pessoal')
  check('criar devolve o resumo do número novo', criada?.instanceId === 'simples:pessoal', criada?.instanceId)
  check('que nasce desconectado e sem número', criada.connected === false && criada.phoneNumber === null,
    JSON.stringify({ c: criada.connected, n: criada.phoneNumber }))
  // O state.json inicial é o que diz "alguém quis este número aqui" — sem ele
  // a varredura ignoraria o diretório, com razão, e o número não apareceria.
  check('a pasta tem o state.json que a varredura exige',
    fs.existsSync(path.join(raizInstancias, 'pessoal', 'state.json')))
  // NASCE PARADO. `atualizadoEm` é o batimento, e só processo rodando tem o
  // direito de escrevê-lo — gravá-lo na criação faria o número nascer
  // parecendo vivo, que é o "conectado que nunca expira" entrando pela porta
  // da criação.
  check('e nasce parado, sem batimento nenhum', criada.unitStatus === 'parado', criada.unitStatus)
  const inicial = JSON.parse(fs.readFileSync(path.join(raizInstancias, 'pessoal', 'state.json'), 'utf8'))
  check('o estado inicial não finge batimento', inicial.atualizadoEm === undefined, JSON.stringify(inicial))
  check('e o número aparece na lista', service.listar().some((i) => i.instanceId === 'simples:pessoal'))
  check('o estado inicial é só do dono', (fs.statSync(path.join(raizInstancias, 'pessoal', 'state.json')).mode & 0o077) === 0,
    (fs.statSync(path.join(raizInstancias, 'pessoal', 'state.json')).mode & 0o777).toString(8))
}

// --- nome: o único texto de fora que vira caminho -----------------------
check('barra é recusada', !!erroDe(() => service.criar('a/b')))
check('travessia é recusada', !!erroDe(() => service.criar('../fora')))
check('".." sozinho é recusado', !!erroDe(() => service.criar('..')))
check('espaço é recusado', !!erroDe(() => service.criar('dois numeros')))
check('vazio é recusado', !!erroDe(() => service.criar('')))
check('nome gigante é recusado', !!erroDe(() => service.criar('x'.repeat(41))))
check('"bare" é recusado — é o número principal', /principal/.test(erroDe(() => service.criar('bare')) || ''))
check('repetido é recusado, dizendo que já existe', /já existe/i.test(erroDe(() => service.criar('pessoal')) || ''))
// E nada do que foi recusado virou pasta.
check('nenhuma recusa deixou pasta para trás',
  fs.readdirSync(raizInstancias).join(',') === 'pessoal', fs.readdirSync(raizInstancias).join(','))

// --- remover -------------------------------------------------------------
{
  // Com o processo VIVO, remover é recusado: apagar a pasta de um bot rodando
  // deixaria um processo escrevendo num diretório que já não existe.
  fs.writeFileSync(path.join(raizInstancias, 'pessoal', 'bot.pid'), String(process.pid))
  const erro = erroDe(() => service.remover('simples:pessoal'))
  check('número rodando NÃO é removido', !!erro, erro)
  check('e a mensagem diz o que fazer antes', /Pare antes/i.test(erro || ''), erro)
  check('a pasta continua lá', fs.existsSync(path.join(raizInstancias, 'pessoal')))
}
{
  fs.rmSync(path.join(raizInstancias, 'pessoal', 'bot.pid'))
  const r = service.remover('simples:pessoal')
  check('parado, o número é removido', r?.removed === true)
  check('a pasta de dados some', !fs.existsSync(path.join(raizInstancias, 'pessoal')))
  check('e ele sai da lista', !service.listar().some((i) => i.instanceId === 'simples:pessoal'))
}

check('o número principal nunca é removido', /principal/.test(erroDe(() => service.remover('bare')) || ''))
// Id inventado não vira caminho: a lista é fechada pela varredura.
check('id inventado não apaga nada', !!erroDe(() => service.remover('simples:nao-existe')))
check('e nem com travessia no id', !!erroDe(() => service.remover('simples:../../etc')))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CRIAR E REMOVER NÚMERO PASSARAM')
process.exit(falhas ? 1 : 0)
