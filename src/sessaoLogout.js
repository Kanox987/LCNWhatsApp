// TROCAR O NÚMERO SEM O SQLITE TRAZER O ANTIGO DE VOLTA.
//
// O pedido de troca chega como arquivo em data/: `logout.request` quando o bot
// está de pé (ele mesmo desloga no WhatsApp e apaga a sessão) ou só
// `logout.cleanup` quando o bot está parado (não há com quem falar).
//
// Apagar a sessão com o processo vivo não basta. O zapo.sqlite fica aberto até
// o processo sair, e o SQLite pode regravar o banco (ou o -wal/-shm) depois de
// a pasta ter sido esvaziada — o número antigo volta a conectar sozinho na
// inicialização seguinte. Por isso o marcador `logout.cleanup` é gravado ANTES
// do logout e só é consumido na próxima subida, antes de qualquer coisa abrir
// a sessão: nesse momento nenhum descritor do processo antigo existe mais.
import fs from 'fs'
import os from 'os'
import path from 'path'

export const ARQ_PEDIDO_LOGOUT = 'logout.request'
export const ARQ_LIMPEZA_PENDENTE = 'logout.cleanup'
export const ARQ_NUMERO_DESCARTADO = 'logout.numero-descartado'

function gravarPrivado (arquivo, conteudo = `${Date.now()}\n`) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  fs.writeFileSync(arquivo, conteudo, { mode: 0o600 })
  // O mode do writeFileSync só vale na criação; um arquivo que já existia
  // manteria a permissão antiga.
  fs.chmodSync(arquivo, 0o600)
}

// Bot de pé: ele mesmo consome o pedido (connection.js), desloga e reinicia.
export function pedirLogout (pastaDados) {
  gravarPrivado(path.join(pastaDados, ARQ_PEDIDO_LOGOUT))
}

// A sessão deve ser esvaziada na próxima subida, com o processo antigo morto.
export function marcarLimpezaPendente (pastaDados) {
  gravarPrivado(path.join(pastaDados, ARQ_LIMPEZA_PENDENTE))
}

// Esvazia a pasta, mas não a remove: os volumes do container montam a pasta
// em si, e apagá-la quebraria a montagem.
export function esvaziarSessao (pastaSessao) {
  let entradas
  try {
    entradas = fs.readdirSync(pastaSessao)
  } catch (erro) {
    if (erro.code === 'ENOENT') return
    throw erro
  }
  for (const nome of entradas) {
    fs.rmSync(path.join(pastaSessao, nome), { recursive: true, force: true })
  }
}

// Chamado na subida do gateway, antes de abrir o store. Devolve true quando
// havia limpeza pendente. Se a limpeza falhar, o marcador fica: a próxima
// subida tenta de novo em vez de dar o assunto por encerrado.
export function concluirLimpezaPendente ({ pastaDados, pastaSessao, log = () => {} }) {
  const marcador = path.join(pastaDados, ARQ_LIMPEZA_PENDENTE)
  if (!fs.existsSync(marcador)) return false
  esvaziarSessao(pastaSessao)
  // A sessão já foi descartada; um pedido de logout ainda na fila derrubaria
  // o pareamento NOVO alguns segundos depois de ele começar.
  fs.rmSync(path.join(pastaDados, ARQ_PEDIDO_LOGOUT), { force: true })
  fs.rmSync(marcador, { force: true })
  log('Sessão do número anterior descartada. Aguardando novo pareamento.')
  return true
}

// O NÚMERO ANTIGO NÃO PODE VOLTAR PELO AMBIENTE.
//
// Container pareado por código guarda `LCN_PAIR_NUMBER` no próprio ambiente.
// Depois da troca, o supervisor sobe o gateway de novo NO MESMO container, com
// o mesmo ambiente, e ele pediria código de pareamento para o número que
// acabou de sair, em vez de mostrar o QR. Fica anotado qual número saiu e em
// qual máquina: o hostname de um container é o id dele, então um container
// recriado para parear de novo (mesmo com o mesmo número) não é afetado.
// A anotação some na primeira conexão bem-sucedida.
export function lembrarNumeroDescartado (pastaDados, numero, host = os.hostname()) {
  gravarPrivado(path.join(pastaDados, ARQ_NUMERO_DESCARTADO), JSON.stringify({ numero: String(numero), host }) + '\n')
}

export function numeroFoiDescartado (pastaDados, numero, host = os.hostname()) {
  if (!numero) return false
  try {
    const anotado = JSON.parse(fs.readFileSync(path.join(pastaDados, ARQ_NUMERO_DESCARTADO), 'utf8'))
    return anotado?.numero === String(numero) && anotado?.host === host
  } catch {
    return false
  }
}

export function esquecerNumeroDescartado (pastaDados) {
  fs.rmSync(path.join(pastaDados, ARQ_NUMERO_DESCARTADO), { force: true })
}
