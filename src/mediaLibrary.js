// Acervo de arquivos: imagens, áudios, vídeos, documentos e textos que o dono
// sobe uma vez e usa em qualquer comando — foto de produto, áudio de
// boas-vindas, PDF de cardápio.
//
// Fica em ~/.local/share/lcnwhatsapp/acervo, COMPARTILHADO entre instâncias,
// mesmo lugar e mesmo motivo de `modelos/` (Whisper): quem tem três números
// não deveria subir a mesma foto três vezes.
//
// FRONTEIRA: o motor nunca vê bytes daqui. Um documento de automação guarda
// só o id (`arquivo: 'a1b2c3'`); quem troca id por bytes é o gateway, na hora
// de enviar. É a mesma regra do token de mídia de conversa, por outro caminho.
//
// SEGURANÇA — o que este módulo garante, e por quê:
//   - O id é gerado aqui (hex aleatório), NUNCA derivado do nome que a pessoa
//     mandou. É o que fecha travessia de caminho: um arquivo chamado
//     "../../config.json" vira o id "9f2a..." e o nome original fica só como
//     rótulo na tela.
//   - O caminho final é conferido contra a pasta do acervo antes de qualquer
//     leitura ou escrita — cinto e suspensório sobre o id gerado.
//   - Só tipos conhecidos entram, e a extensão é derivada do tipo declarado,
//     nunca do nome original.
//   - Gravado 0600 e sem bit de execução. Nada aqui é executado em lugar
//     nenhum: os arquivos só são lidos para virar mensagem de WhatsApp.
//   - Tamanho por arquivo e cota total são verificados ANTES de gravar.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { PASTA_LCN } from './instances/paths.js'
import { lerRuntime } from './runtime.js'

export const PASTA_ACERVO = path.join(PASTA_LCN, 'acervo')

// Sobrescrito só por teste, para nunca tocar o acervo real do usuário.
let pastaSobrescrita = null
const pastaBase = () => pastaSobrescrita || PASTA_ACERVO
const pastaArquivos = () => path.join(pastaBase(), 'arquivos')
const arqIndice = () => path.join(pastaBase(), 'index.json')

// Só o que o WhatsApp sabe enviar, mais texto (usado como resposta pronta).
// A extensão vem daqui, não do nome que veio junto com o arquivo.
export const TIPOS_ACEITOS = Object.freeze({
  'image/jpeg': { kind: 'image', ext: '.jpg' },
  'image/png': { kind: 'image', ext: '.png' },
  'image/webp': { kind: 'image', ext: '.webp' },
  'image/gif': { kind: 'image', ext: '.gif' },
  'video/mp4': { kind: 'video', ext: '.mp4' },
  'audio/mpeg': { kind: 'audio', ext: '.mp3' },
  'audio/ogg': { kind: 'audio', ext: '.ogg' },
  'audio/mp4': { kind: 'audio', ext: '.m4a' },
  'application/pdf': { kind: 'document', ext: '.pdf' },
  'text/plain': { kind: 'text', ext: '.txt' }
})

export const LIMITE_POR_ARQUIVO_BYTES = 32 * 1024 * 1024
export const COTA_PADRAO_BYTES = 512 * 1024 * 1024

// A COTA NÃO É EDITÁVEL PELO PAINEL, de propósito.
//
// Ela existe para limitar quem usa o sistema. Um limite que o próprio limitado
// pode aumentar num campo de texto não limita nada — e é exatamente este número
// que precisa valer na versão hospedada, onde quem paga a conta do disco é quem
// hospeda, não quem usa.
//
// Por isso ela vem de fora, na mesma ordem de precedência do resto da
// configuração de recursos: variável de ambiente (o jeito natural no Docker),
// depois `container.disk` do runtime.json (gravado pelo instalador, do lado de
// memory e cpus), e só então o padrão.
//
// A CONTABILIDADE continua no aplicativo, e isso não muda: limitar disco no
// nível do container (`--storage-opt size=`) depende do driver de armazenamento
// e não existe no modo simples. O que mudou é quem define o número, não quem o
// aplica.
const SUFIXOS = { b: 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }

export function interpretarTamanho (bruto) {
  if (bruto === null) return null
  if (Number.isSafeInteger(bruto) && bruto > 0) return bruto
  const texto = String(bruto ?? '').trim().toLowerCase()
  if (!texto) return undefined
  const casou = /^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/.exec(texto)
  if (!casou) return undefined
  const valor = Number(casou[1]) * (SUFIXOS[casou[2] || 'b'] || 1)
  return valor > 0 ? Math.floor(valor) : undefined
}

// Lido a cada chamada, nunca memorizado: mudar o limite no ambiente e
// reiniciar precisa bastar, sem passo extra escondido.
function cotaConfigurada () {
  const doAmbiente = interpretarTamanho(process.env.LCN_ACERVO_LIMITE)
  if (doAmbiente !== undefined) return doAmbiente

  try {
    const rt = lerRuntime()
    if ('disk' in (rt?.container || {})) {
      const doArquivo = interpretarTamanho(rt.container.disk)
      if (doArquivo !== undefined) return doArquivo
    }
  } catch {
    // runtime.json ausente ou ilegível é normal (modo simples recém-clonado):
    // cai no padrão em vez de deixar o acervo sem teto.
  }
  return COTA_PADRAO_BYTES
}

export class ErroDeAcervo extends Error {
  constructor (mensagem, status = 400) {
    super(mensagem)
    this.status = status
  }
}

const ID_VALIDO = /^[0-9a-f]{24}$/

function garantirPastas () {
  fs.mkdirSync(pastaArquivos(), { recursive: true })
}

// Nunca monta caminho a partir de texto que veio de fora sem conferir onde ele
// caiu. Mesmo com id gerado aqui, a checagem fica — é barata e é o que impede
// que uma mudança futura reintroduza travessia sem ninguém notar.
function caminhoDoArquivo (id, ext) {
  if (!ID_VALIDO.test(id)) throw new ErroDeAcervo('Identificador de arquivo inválido.', 400)
  const alvo = path.join(pastaArquivos(), `${id}${ext || ''}`)
  const dentro = path.resolve(alvo)
  if (dentro !== alvo || !dentro.startsWith(path.resolve(pastaArquivos()) + path.sep)) {
    throw new ErroDeAcervo('Caminho de arquivo recusado.', 400)
  }
  return dentro
}

function lerIndice () {
  try {
    const bruto = JSON.parse(fs.readFileSync(arqIndice(), 'utf8'))
    return Array.isArray(bruto?.arquivos) ? bruto.arquivos : []
  } catch {
    return []
  }
}

function gravarIndice (arquivos) {
  garantirPastas()
  const temp = path.join(pastaBase(), `.index.${process.pid}.tmp`)
  // Sem cota aqui: o índice é inventário do que existe, não configuração. O
  // teto vindo de um arquivo que o aplicativo escreve seria editável por dentro.
  const conteudo = { versao: 1, arquivos }
  fs.writeFileSync(temp, JSON.stringify(conteudo, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temp, arqIndice())
}

// `null` significa sem teto — escolha explícita de quem instala, igual a
// memory/cpus nulos em argsRecursos().
export function lerCota () {
  return cotaConfigurada()
}

function exporArquivo (registro) {
  return {
    id: registro.id,
    name: registro.name,
    kind: registro.kind,
    mimetype: registro.mimetype,
    sizeBytes: registro.sizeBytes,
    description: registro.description || null,
    createdAt: registro.createdAt
  }
}

export function listar () {
  return lerIndice().map(exporArquivo)
}

export function uso () {
  const arquivos = lerIndice()
  const usedBytes = arquivos.reduce((soma, a) => soma + (a.sizeBytes || 0), 0)
  const quotaBytes = lerCota()
  return {
    files: arquivos.length,
    usedBytes,
    quotaBytes,
    freeBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - usedBytes)
  }
}

export function obter (id) {
  return lerIndice().find((a) => a.id === id) || null
}

// Devolve o caminho real do arquivo para quem vai ENVIAR (o gateway). Só aqui
// um id vira caminho, e sempre passando pela checagem de pasta.
export function caminhoPara (id) {
  const registro = obter(id)
  if (!registro) return null
  const caminho = caminhoDoArquivo(registro.id, registro.ext)
  return fs.existsSync(caminho) ? caminho : null
}

export function lerConteudo (id) {
  const caminho = caminhoPara(id)
  if (!caminho) throw new ErroDeAcervo('Arquivo não encontrado no acervo.', 404)
  return fs.readFileSync(caminho)
}

// Grava um arquivo novo. `nomeOriginal` é só rótulo — nunca vira caminho.
export function guardar (buffer, { mimetype, name, description } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ErroDeAcervo('Arquivo vazio.')
  }
  const tipo = TIPOS_ACEITOS[String(mimetype || '').toLowerCase()]
  if (!tipo) {
    throw new ErroDeAcervo(`Tipo de arquivo não aceito: ${mimetype || '(não informado)'}. Aceitos: ${Object.keys(TIPOS_ACEITOS).join(', ')}.`)
  }
  if (buffer.length > LIMITE_POR_ARQUIVO_BYTES) {
    throw new ErroDeAcervo(`Arquivo grande demais: o limite por arquivo é ${Math.round(LIMITE_POR_ARQUIVO_BYTES / 1024 / 1024)} MB.`)
  }

  const atual = uso()
  if (atual.quotaBytes !== null && atual.usedBytes + buffer.length > atual.quotaBytes) {
    throw new ErroDeAcervo(
      `Não cabe no acervo: falta espaço. Em uso ${atual.usedBytes} de ${atual.quotaBytes} bytes. Apague algo ou aumente o limite.`,
      507
    )
  }

  garantirPastas()
  const id = crypto.randomBytes(12).toString('hex')
  const caminho = caminhoDoArquivo(id, tipo.ext)
  // 0600 e sem bit de execução: nada do acervo é executado em lugar nenhum,
  // estes arquivos só são lidos para virar mensagem.
  fs.writeFileSync(caminho, buffer, { mode: 0o600 })

  const registro = {
    id,
    name: rotuloSeguro(name) || `arquivo${tipo.ext}`,
    kind: tipo.kind,
    mimetype: String(mimetype).toLowerCase(),
    ext: tipo.ext,
    sizeBytes: buffer.length,
    description: typeof description === 'string' && description.trim() ? description.trim() : null,
    createdAt: new Date().toISOString()
  }
  const arquivos = lerIndice()
  arquivos.push(registro)
  gravarIndice(arquivos)
  return exporArquivo(registro)
}

// O nome original só existe para a pessoa reconhecer o arquivo na tela. Tira
// caminho, caractere de controle e corta o tamanho — nunca é usado para
// montar caminho, mas também não vai poluir a interface nem virar payload
// estranho em log.
function rotuloSeguro (nome) {
  if (typeof nome !== 'string') return null
  const limpo = path.basename(nome).replace(/[ -]/g, '').trim()
  return limpo ? limpo.slice(0, 120) : null
}

export function remover (id) {
  const arquivos = lerIndice()
  const indice = arquivos.findIndex((a) => a.id === id)
  if (indice === -1) return false
  const [registro] = arquivos.splice(indice, 1)
  try { fs.rmSync(caminhoDoArquivo(registro.id, registro.ext), { force: true }) } catch {}
  gravarIndice(arquivos)
  return true
}

export function atualizarDescricao (id, description) {
  const arquivos = lerIndice()
  const registro = arquivos.find((a) => a.id === id)
  if (!registro) return null
  registro.description = typeof description === 'string' && description.trim() ? description.trim() : null
  gravarIndice(arquivos)
  return exporArquivo(registro)
}

export function _usarPastaParaTeste (pasta) {
  pastaSobrescrita = pasta || null
}
