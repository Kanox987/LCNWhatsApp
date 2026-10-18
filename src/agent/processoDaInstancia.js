// Ligar e desligar o PROCESSO de um número do modo simples.
//
// POR QUE ISTO EXISTE
//
// Um segundo número no modo simples é só uma pasta — `data/instancias/<nome>/`
// — e um processo rodando com `LCN_INSTANCIA=<nome>`. Nada registra isso: a
// pasta é a verdade, e é assim que a varredura o encontra.
//
// O painel listava esse número e oferecia os botões de ligar e desligar, mas
// mandava a ação para `systemctl --user ${containerName}.service` — e
// instância descoberta NÃO TEM containerName. A chamada virava
// `systemctl --user undefined.service`, que falha com uma mensagem sobre uma
// unidade que nunca existiu. Botão que não pode funcionar é pior que botão
// ausente: a pessoa tenta, lê um erro que não explica nada, e desconfia do
// resto da tela.
//
// O mecanismo aqui é o MESMO que a linha de comando usa, e o mesmo que o
// `runtime.js` já usa para o número principal: `node index.js` destacado, com
// a variável de ambiente que diz de quem é a vez. Nada de novo — só
// parametrizado pelo nome da instância.
//
// O QUE ISTO NÃO RESOLVE, e não finge resolver: quando o número roda em outro
// container (é o caso da VPS, onde cada número tem o seu), ligar daqui não
// alcança aquele processo. A trava de sistema operacional do invariante 8
// recusa o segundo processo na mesma sessão, então a tentativa falha com
// motivo — não vira dois bots brigando pela mesma sessão.
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { RAIZ } from '../paths.js'

// Um processo com este pid está vivo?
function vivo (pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

function pidDe (arquivo) {
  try {
    const pid = parseInt(fs.readFileSync(arquivo, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

// Só dígitos, com DDI, e nada mais: este valor vira argumento de processo, e
// a lista fechada é o que impede qualquer outra coisa de entrar junto.
export function numeroParaParear (bruto) {
  const limpo = String(bruto ?? '').replace(/\D+/g, '')
  if (limpo.length < 10 || limpo.length > 15) return null
  return limpo
}

export function iniciar (nome, arqPid, { spawnFn = spawn, raiz = RAIZ, pairNumber = null } = {}) {
  const pid = pidDe(arqPid)
  if (pid && vivo(pid)) return { ok: false, out: `O número "${nome}" já está rodando (pid ${pid}).` }

  const entrada = path.join(raiz, 'index.js')
  if (!fs.existsSync(entrada)) return { ok: false, out: 'Não encontrei o index.js na raiz do projeto.' }

  // PAREAMENTO POR CÓDIGO, sem terminal.
  //
  // O bot já sabia fazer isto — `LCN_PAIR_NUMBER=55… node index.js --code` —,
  // e só o terminal sabia pedir. A própria tela admitia a lacuna: "a geração
  // de um novo código por telefone ainda depende do fluxo de terminal". Quem
  // aluga o sistema não tem terminal nenhum, então a lacuna era a porta de
  // entrada inteira fechada para ele.
  const numero = pairNumber ? numeroParaParear(pairNumber) : null
  if (pairNumber && !numero) {
    return { ok: false, out: 'Número inválido para pareamento: use só dígitos, com DDI (ex.: 5522999999999).' }
  }
  const argumentos = numero ? [entrada, '--code'] : [entrada]

  const filho = spawnFn(process.execPath, argumentos, {
    detached: true,
    stdio: 'ignore',
    cwd: raiz,
    // É esta variável que dá a ele a própria sessão, o próprio estado e a
    // própria pasta de mídia (ver src/paths.js).
    env: { ...process.env, LCN_INSTANCIA: nome, ...(numero ? { LCN_PAIR_NUMBER: numero } : {}) }
  })
  filho.unref()
  return {
    ok: true,
    out: numero
      ? `Número "${nome}" iniciado para parear por código (pid ${filho.pid}). O código aparece aqui em instantes.`
      : `Número "${nome}" iniciado (pid ${filho.pid}).`
  }
}

export function parar (nome, arqPid) {
  const pid = pidDe(arqPid)
  if (!pid) return { ok: false, out: `Não achei o processo do número "${nome}" (sem pid-file).` }
  if (!vivo(pid)) {
    // Pid-file velho de um processo que já morreu: limpar aqui evita que a
    // próxima tentativa de ligar veja o arquivo e ache que ainda está de pé.
    try { fs.rmSync(arqPid) } catch {}
    return { ok: false, out: `O número "${nome}" já não estava rodando.` }
  }
  try {
    process.kill(pid)
    // Remover aqui, e não só no `exit` do processo morto: o SIGTERM chega sem
    // handler instalado, então nenhum código dele roda depois. É a mesma razão
    // registrada em runtime.js para o número principal.
    try { fs.rmSync(arqPid) } catch {}
    return { ok: true, out: `Número "${nome}" parado.` }
  } catch (e) {
    return { ok: false, out: e.message }
  }
}

export function reiniciar (nome, arqPid, opcoes = {}) {
  parar(nome, arqPid)
  return iniciar(nome, arqPid, opcoes)
}
