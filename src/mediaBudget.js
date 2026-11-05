import { decodificarBase64 } from './mediaBase64.js'

function validarBytes (bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Tamanho de mídia inválido: a reserva precisa de um número inteiro positivo de bytes.')
}

export function criarOrcamentoDeMidia (limiteBytes) {
  validarBytes(limiteBytes)
  let reservados = 0
  let totalReservados = 0
  let totalLiberados = 0
  let picoReservados = 0
  let recusas = 0
  return {
    adquirir (bytes) {
      validarBytes(bytes)
      // Não há espera aqui: reter meio álbum enquanto espera espaço para o
      // resto pode impedir que qualquer álbum termine e devolva sua reserva.
      if (bytes > limiteBytes - reservados) {
        recusas++
        const erro = new Error('Não há memória livre no orçamento de mídias para receber este arquivo agora.')
        erro.code = 'LCN_SEM_VAGA'
        erro.recurso = 'memoria'
        throw erro
      }
      reservados += bytes
      totalReservados += bytes
      picoReservados = Math.max(picoReservados, reservados)
    },
    liberar (bytes) {
      validarBytes(bytes)
      if (bytes > reservados) throw new Error('Liberação de mídia excede a reserva: o mesmo conteúdo não pode ser liberado duas vezes.')
      reservados -= bytes
      totalLiberados += bytes
    },
    ajustarLimite (bytes) {
      validarBytes(bytes)
      // Uma redução de configuração não desfaz envios em curso. Novas
      // reservas ficam recusadas até o uso voltar a caber no novo limite.
      limiteBytes = bytes
    },
    estado: () => ({ limiteBytes, reservados, livres: Math.max(0, limiteBytes - reservados), totalReservados, totalLiberados, picoReservados, recusas })
  }
}

export async function descartarResposta (resposta) {
  try { await resposta.body?.cancel?.() } catch { /* A recusa original explica a falha; cancelar é melhor esforço. */ }
}

function midiaReservada (buffer, bytes, orcamento) {
  let liberada = false
  let usos = 0
  let descartePedido = false
  const descartar = () => {
    if (liberada || !descartePedido || usos) return
    liberada = true
    midia.buffer = null
    orcamento.liberar(bytes)
  }
  const midia = {
    buffer,
    bytes,
    reter () {
      if (liberada) throw new Error('A mídia já foi liberada; o envio precisa de uma referência ainda válida.')
      usos++
      let soltou = false
      return () => {
        if (soltou) return
        soltou = true
        usos--
        descartar()
      }
    },
    async usar (operacao) {
      const soltar = midia.reter()
      try { return await operacao(midia.buffer) } finally { soltar() }
    },
    liberar () {
      // Soltar só o contador deixaria o lote segurando o buffer e admitiria
      // novas alocações sobre memória que ainda tem dono. Timeout abandona a
      // espera, mas não cancela o socket: seu uso mantém a reserva até acabar.
      descartePedido = true
      descartar()
    }
  }
  return midia
}

// Lê o corpo em fluxo para dentro de um buffer do tamanho JÁ reservado. Um
// servidor que declara menos do que envia estoura a reserva: aqui a leitura é
// abortada no primeiro byte excedente, em vez de `arrayBuffer()` alocar tudo
// e só então a conferência de tamanho reclamar. Resposta sem fluxo legível
// (dublê de teste) cai no caminho antigo.
async function lerCorpoLimitado (resposta, bytes) {
  const leitor = resposta.body?.getReader?.()
  if (!leitor) {
    const corpo = await resposta.arrayBuffer()
    return Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo)
  }
  const buffer = Buffer.allocUnsafe(bytes)
  let lidos = 0
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      if (lidos + value.byteLength > bytes) {
        throw new Error('O tamanho recebido difere do Content-Length; a reserva declarada pelo serviço não é confiável.')
      }
      buffer.set(value, lidos)
      lidos += value.byteLength
    }
  } catch (erro) {
    // Com o fluxo preso ao leitor, `body.cancel()` falha: cancelar é por aqui.
    try { await leitor.cancel() } catch { /* a recusa original explica a falha */ }
    throw erro
  }
  return lidos === bytes ? buffer : buffer.subarray(0, lidos)
}

export async function lerRespostaDeMidia (resposta, { limiteBytes, orcamento }) {
  let bytes = 0
  let reservou = false
  try {
    const declarado = resposta.headers?.get?.('content-length')
    if (declarado === null || declarado === undefined || !/^\d+$/.test(String(declarado))) {
      throw new Error('Resposta de mídia sem Content-Length válido: não é possível reservar memória antes de ler o corpo.')
    }
    bytes = Number(declarado)
    validarBytes(bytes)
    const codificacao = resposta.headers?.get?.('content-encoding')
    if (codificacao && codificacao.toLowerCase() !== 'identity') {
      throw new Error('Resposta de mídia comprimida recusada: Content-Length não limita o tamanho após descompressão.')
    }
    if (bytes > limiteBytes) {
      const erro = new Error('Arquivo grande demais: o Content-Length excede o limite de mídia.')
      erro.code = 'LCN_MIDIA_GRANDE'
      erro.bytes = bytes
      throw erro
    }
    orcamento.adquirir(bytes)
    reservou = true
    const buffer = await lerCorpoLimitado(resposta, bytes)
    if (buffer.length !== bytes) throw new Error('O tamanho recebido difere do Content-Length; a reserva declarada pelo serviço não é confiável.')
    return midiaReservada(buffer, bytes, orcamento)
  } catch (erro) {
    if (reservou) orcamento.liberar(bytes)
    await descartarResposta(resposta)
    throw erro
  }
}

export function lerBase64DeMidia (bruto, { limiteBytes, orcamento }) {
  let bytes = 0
  try {
    const buffer = decodificarBase64(bruto, limiteBytes, (tamanho) => {
      orcamento.adquirir(tamanho)
      bytes = tamanho
    })
    return midiaReservada(buffer, bytes, orcamento)
  } catch (erro) {
    if (bytes) orcamento.liberar(bytes)
    throw erro
  }
}

export function criarLoteDeMidias () {
  const retidas = new Set()
  return {
    adicionar (midia) { retidas.add(midia); return midia },
    transferir (midia) { retidas.delete(midia) },
    liberar () {
      for (const midia of retidas) midia.liberar()
      retidas.clear()
    }
  }
}
