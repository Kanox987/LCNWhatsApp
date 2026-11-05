// A proteção precisa existir ANTES da alocação. Os corpos falsos contam cada
// leitura e conferem a reserva naquele instante; só medir o resultado final
// deixaria passar o pico que esta regressão quer impedir.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { criarOrcamentoDeMidia, lerRespostaDeMidia, lerBase64DeMidia } from '../src/mediaBudget.js'
import { decodificarBase64 } from '../src/mediaBase64.js'
import { limitesDeMidia } from '../src/mediaLimits.js'
import { criarServicoAcervo } from '../src/agent/mediaService.js'
import { criarBaixador, configuracaoDeDownload } from '../src/downloader.js'
import { criarExecutorDeConexao } from '../src/engine/conexaoExecutor.js'
import { executarComandos, comTimeout } from '../src/engine/gatewayExecutor.js'
import * as cache from '../src/engine/mediaRefCache.js'
import * as acervoReal from '../src/mediaLibrary.js'

let checagens = 0
const check = (nome, condicao) => { assert.ok(condicao, nome); checagens++; console.log(`✅ ${nome}`) }
const capturar = async (operacao) => { try { await operacao(); return null } catch (erro) { return erro } }
const semDormir = async () => {}
const MB = 1024 * 1024
const CHAT = '5511999999999@s.whatsapp.net'
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-memoria-'))
const tokenArquivo = path.join(pasta, 'token')
fs.writeFileSync(tokenArquivo, 'segredo-de-teste')
const cfg = { download: { api: 'https://servico.exemplo', tokenArquivo, limiteMB: 1 }, hardware: { maxMidiaMB: 1, orcamentoMidiaMB: 1 } }

function respostaDeMidia ({ bytes = 4, declarado = String(bytes), orcamento, antes, falhar = false, codificacao } = {}) {
  let leituras = 0
  let cancelamentos = 0
  const headers = new Headers()
  if (declarado !== null) headers.set('content-length', declarado)
  if (codificacao) headers.set('content-encoding', codificacao)
  return {
    ok: true, status: 200, headers,
    body: { cancel: async () => { cancelamentos++ } },
    arrayBuffer: async () => {
      leituras++
      if (orcamento) assert.ok(orcamento.estado().reservados >= Number(declarado), 'A reserva deve anteceder arrayBuffer.')
      await antes?.()
      if (falhar) throw new Error('Falha de leitura simulada.')
      return new ArrayBuffer(bytes)
    },
    leituras: () => leituras,
    cancelamentos: () => cancelamentos
  }
}
const json = (corpo) => ({ ok: true, status: 200, json: async () => corpo })
const declaracao = (resposta) => ({ id: 'teste', endereco: 'https://servico.exemplo', autenticacao: { tipo: 'nenhuma' }, funcoes: [{ nome: 'f', metodo: 'POST', caminho: '/f', entradas: [], resposta }] })
const arquivos = Array.from({ length: 3 }, (_, i) => ({ url: `/m${i}`, nome: `m${i}.jpg`, mime: 'image/jpeg', tipo: 'imagem' }))
function servico (primeira, respostas, download = false) {
  return async (url) => {
    if (url.endsWith(download ? '/download' : '/f')) return json(download ? { job: 'j' } : primeira)
    if (url.endsWith('/jobs/j')) return json({ estado: 'pronto', midias: arquivos.slice(0, respostas.length) })
    return respostas.shift()
  }
}
function motor (declarada = declaracao({ forma: 'arquivo', campo: 'arquivo' })) {
  const confirmacoes = []
  return {
    confirmacoes,
    conexoes: { resolvida: async () => declarada },
    execucoes: { confirmar: async (id, resultado) => { confirmacoes.push({ id, ...resultado }) } }
  }
}
function cliente (send = async () => ({ id: 'enviada' }), upload = async () => ({ url: 'u', fileLength: 4 })) {
  return { message: { send, upload } }
}
const comando = (commandType, payload = {}) => ({ id: 'teste', commandType, payload: { chatId: CHAT, ...payload } })

try {
  // 4.1: o primeiro envio ocorre antes da segunda leitura. A queda percorre
  // os ids de novo; se guardasse buffers para o álbum, faltariam essas leituras.
  for (const modo of ['carrossel', 'album', 'separate', 'queda-album', 'queda-sequencia']) {
    const eventos = []
    const orcamento = criarOrcamentoDeMidia(4)
    let pico = 0
    let emUso = 0
    const registros = ['a', 'b', 'c'].map((id) => ({ id, name: `${id}.jpg`, mimetype: 'image/jpeg', kind: 'image', sizeBytes: 4 }))
    const biblioteca = {
      listarDaPasta: () => registros,
      lerConteudo: () => { throw new Error('Leitura síncrona de conteúdo não deve acontecer.') },
      lerConteudoAsync: async (id, limite) => {
        assert.equal(limite, 4)
        assert.equal(emUso, 0, 'Um envio deve terminar antes de carregar a próxima mídia.')
        assert.equal(orcamento.estado().reservados, 4)
        emUso++
        pico = Math.max(pico, emUso * 4)
        eventos.push(`ler:${id}`)
        await new Promise(setImmediate)
        return Buffer.from(id.repeat(4))
      }
    }
    const c = cliente(async (_jid, conteudo) => {
      if (conteudo.interactiveMessage && modo.startsWith('queda')) throw new Error('Carrossel recusado no teste.')
      if (conteudo.albumMessage && modo === 'queda-sequencia') throw new Error('Álbum recusado no teste.')
      if (conteudo.media) { eventos.push(`enviar:${conteudo.media.toString()[0]}`); emUso-- }
      return { id: 'pai' }
    }, async (buffer) => { eventos.push(`subir:${buffer.toString()[0]}`); emUso--; return { url: 'u', fileLength: 4 } })
    const m = motor()
    await executarComandos(c, [comando('whatsapp.sendFile', { pasta: 'fotos', entrega: modo.startsWith('queda') ? 'carrossel' : modo })], m,
      { mediaRefCache: {}, acervo: biblioteca, limiteBytes: 4, orcamento })
    const leiturasEsperadas = modo.startsWith('queda') ? 6 : 3
    check(`${modo}: pico de conteúdo é um arquivo, 4 bytes, para uma pasta de 12 bytes`, pico === 4 && emUso === 0)
    check(`${modo}: lê e usa alternadamente, inclusive relendo por id na queda`, eventos.length === leiturasEsperadas * 2 && eventos.every((e, i) => i % 2 === 0 ? e.startsWith('ler:') : /^(subir|enviar):/.test(e)))
    check(`${modo}: entrega confirmada e orçamento devolvido`, m.confirmacoes[0]?.status === 'sent' && orcamento.estado().reservados === 0)
  }
  {
    acervoReal._usarPastaParaTeste(path.join(pasta, 'acervo'))
    const registro = acervoReal.guardar(Buffer.alloc(6), { mimetype: 'image/jpeg', name: 'foto.jpg' })
    let alocacoes = 0
    const alloc = Buffer.alloc
    Buffer.alloc = function (...args) { alocacoes++; return alloc(...args) }
    let erro
    try { erro = await capturar(() => acervoReal.lerConteudoAsync(registro.id, 4)) } finally { Buffer.alloc = alloc }
    check('acervo real confere tamanho atual do disco antes de alocar', !!erro && alocacoes === 0)
    check('acervo real possui leitura assíncrona limitada pelo tamanho reservado', (await acervoReal.lerConteudoAsync(registro.id, 6)).length === 6)
  }

  {
    const orcamento = criarOrcamentoDeMidia(4)
    orcamento.adquirir(3)
    let leituras = 0
    let envios = 0
    const m = motor()
    const acervo = {
      listarDaPasta: () => ['a', 'b'].map((id) => ({ id, kind: 'image', sizeBytes: 4 })),
      lerConteudoAsync: async () => { leituras++; return Buffer.alloc(4) }
    }
    await executarComandos(cliente(async () => { envios++; return { id: 'pai' } }), [comando('whatsapp.sendFile', { pasta: 'fotos' })], m, { mediaRefCache: {}, acervo, orcamento })
    check('acervo sem orçamento não lê bytes nem abre álbum como tentativa alternativa', leituras === 0 && envios === 0 && m.confirmacoes[0]?.status === 'failed')
    check('recusa no acervo preserva os bytes que pertencem a outra operação', orcamento.estado().reservados === 3)
    orcamento.liberar(3)
  }

  // 4.2: espionar replace e Buffer.from distingue recusa anterior de uma
  // validação tardia que parece correta só porque terminou lançando erro.
  {
    const bruto = `YQ==${' '.repeat(100)}`
    const from = Buffer.from
    const replace = String.prototype.replace
    let normalizacoes = 0
    let decodificacoes = 0
    Buffer.from = function (valor, tipo, ...resto) { if (tipo === 'base64') decodificacoes++; return from(valor, tipo, ...resto) }
    String.prototype.replace = function (...args) { if (String(this) === bruto) normalizacoes++; return replace.apply(this, args) }
    const bib = { LIMITE_POR_ARQUIVO_BYTES: 3, ErroDeAcervo: Error, guardar: () => assert.fail('Conteúdo recusado não pode ser guardado.'), reescrever: () => assert.fail('Conteúdo recusado não pode ser reescrito.') }
    try {
      check('helper recusa base64 bruto grande', !!await capturar(() => decodificarBase64(bruto, 3)))
      check('painel usa o limite recebido da própria biblioteca no upload', !!await capturar(() => criarServicoAcervo({ biblioteca: bib }).enviar({ contentBase64: bruto })))
      check('painel usa a mesma proteção ao reescrever', !!await capturar(() => criarServicoAcervo({ biblioteca: bib }).reescrever('a', { contentBase64: bruto })))
      const exec = criarExecutorDeConexao({ limiteBytes: 3, buscar: async () => json({ arquivo: bruto }) })
      check('conexão também recusa antes de decodificar', !!await capturar(() => exec.executar(declaracao({ forma: 'arquivo', campo: 'arquivo' }), 'f', {})))
      check('as quatro recusas fizeram zero normalizações e zero decodificações', normalizacoes === 0 && decodificacoes === 0)
      for (const invalido of ['!!!!', 'YQ=', 'AA=A', '    ']) {
        check(`base64 inválido ${JSON.stringify(invalido)} não vira bytes`, !!await capturar(() => decodificarBase64(invalido, 3)))
      }
      check('o arredondamento não permite três bytes em um limite de dois', !!await capturar(() => decodificarBase64('YWJj', 2)))
      check('todas as recusas de formato e tamanho mantiveram zero decodificações', decodificacoes === 0)
    } finally { Buffer.from = from; String.prototype.replace = replace }
    check('base64 válido aceita o limite exato', decodificarBase64('YWJj', 3).toString() === 'abc')
    check('espaços moderados continuam aceitos dentro do teto bruto', decodificarBase64('YQ==\n', 4).toString() === 'a')
    const orcamento = criarOrcamentoDeMidia(2)
    check('base64 também reserva memória antes de criar o buffer', (await capturar(() => lerBase64DeMidia('YWJj', { limiteBytes: 3, orcamento })))?.code === 'LCN_SEM_VAGA' && orcamento.estado().reservados === 0)
  }

  // 4.3: ausência, declaração inválida, excesso, soma e concorrência.
  for (const declarado of [null, '', '-1', '1.5', '0', '9007199254740992', '9']) {
    const orcamento = criarOrcamentoDeMidia(8)
    const r = respostaDeMidia({ declarado, orcamento })
    const erro = await capturar(() => lerRespostaDeMidia(r, { limiteBytes: 8, orcamento }))
    check(`Content-Length ${JSON.stringify(declarado)}: recusa sem ler corpo e cancela a resposta`, !!erro && r.leituras() === 0 && r.cancelamentos() === 1 && orcamento.estado().reservados === 0)
  }
  {
    const orcamento = criarOrcamentoDeMidia(8)
    const r = respostaDeMidia({ codificacao: 'gzip', orcamento })
    check('tamanho comprimido não serve de reserva para corpo descomprimido', !!await capturar(() => lerRespostaDeMidia(r, { limiteBytes: 8, orcamento })) && r.leituras() === 0)
    for (const opcoes of [{ falhar: true }, { declarado: '3', bytes: 4 }]) {
      const r = respostaDeMidia({ ...opcoes, orcamento })
      check('falha de leitura ou tamanho divergente devolve a reserva', !!await capturar(() => lerRespostaDeMidia(r, { limiteBytes: 8, orcamento })) && orcamento.estado().reservados === 0)
    }
    let continuar
    const barreira = new Promise((r) => { continuar = r })
    const primeira = lerRespostaDeMidia(respostaDeMidia({ bytes: 6, orcamento, antes: () => barreira }), { limiteBytes: 8, orcamento })
    const segunda = respostaDeMidia({ bytes: 4, orcamento })
    check('requisição concorrente é recusada antes da leitura quando a soma não cabe', (await capturar(() => lerRespostaDeMidia(segunda, { limiteBytes: 8, orcamento })))?.code === 'LCN_SEM_VAGA' && segunda.leituras() === 0 && orcamento.estado().reservados === 6)
    continuar()
    const recebida = await primeira
    check('reserva continua ocupada depois do download enquanto o buffer tem dono', orcamento.estado().reservados === 6 && recebida.buffer.length === 6)
    recebida.liberar(); recebida.liberar()
    check('liberação é idempotente e remove a referência ao buffer', orcamento.estado().reservados === 0 && recebida.buffer === null)
  }
  // Fluxo real: o servidor declara 4 bytes e manda mais. A leitura aborta no
  // primeiro byte excedente e cancela o corpo, em vez de alocar tudo antes.
  {
    const orcamento = criarOrcamentoDeMidia(8)
    let enviados = 0
    let cancelado = false
    const fluxo = new ReadableStream({
      pull (c) {
        if (enviados >= 1000) return c.close()
        enviados++
        c.enqueue(new Uint8Array(4))
      },
      cancel () { cancelado = true }
    })
    const mentirosa = new Response(fluxo, { headers: { 'content-length': '4' } })
    const erro = await capturar(() => lerRespostaDeMidia(mentirosa, { limiteBytes: 8, orcamento }))
    check('corpo maior que o Content-Length é abortado no excedente, sem ler o resto', !!erro && enviados < 10 && cancelado && orcamento.estado().reservados === 0)
    const honesta = new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-length': '4' } })
    const ok = await lerRespostaDeMidia(honesta, { limiteBytes: 8, orcamento })
    check('corpo do tamanho declarado, em fluxo real, chega inteiro', ok.buffer.length === 4 && ok.buffer[3] === 4 && orcamento.estado().reservados === 4)
    ok.liberar()
    const curta = new Response(new Uint8Array([1, 2]), { headers: { 'content-length': '4' } })
    check('corpo menor que o declarado também é recusado e devolve a reserva', !!await capturar(() => lerRespostaDeMidia(curta, { limiteBytes: 8, orcamento })) && orcamento.estado().reservados === 0)
  }
  for (const caminho of ['downloader', 'arquivos', 'capas']) {
    for (const motivo of ['soma', 'sem-tamanho', 'leitura-falha']) {
      const orcamento = criarOrcamentoDeMidia(7)
      const r1 = respostaDeMidia({ orcamento })
      const r2 = respostaDeMidia({ orcamento, ...(motivo === 'sem-tamanho' ? { declarado: null } : motivo === 'leitura-falha' ? { bytes: 3, falhar: true } : {}) })
      const respostas = [r1, r2]
      let erro
      if (caminho === 'downloader') {
        erro = await capturar(() => criarBaixador({ cfg, orcamento, buscar: servico(null, respostas, true), dormir: semDormir }).baixar('https://post.exemplo'))
      } else {
        const capa = caminho === 'capas'
        const d = declaracao(capa ? { forma: 'carrossel', campo: 'itens', imagem: ['url'], corpo: '{{nome}}' } : { forma: 'mídia', campo: 'itens' })
        const exec = criarExecutorDeConexao({ limiteBytes: 7, orcamento, buscar: servico({ itens: arquivos.slice(0, 2) }, respostas) })
        let resultado
        erro = await capturar(async () => { resultado = await exec.executar(d, 'f', {}) })
        // Capa ausente admite o resultado parcial; a reserva do que ficou
        // continua pertencendo ao chamador até ele terminar a entrega.
        if (resultado) resultado.liberar()
      }
      check(`${caminho}/${motivo}: segundo corpo só é lido se couber e tiver tamanho`, r1.leituras() === 1 && r2.leituras() === (motivo === 'leitura-falha' ? 1 : 0))
      check(`${caminho}/${motivo}: falha ou descarte solta todo o lote anterior`, orcamento.estado().reservados === 0)
      if (motivo === 'soma') check(`${caminho}: excesso somado mantém LCN_SEM_VAGA`, erro?.code === 'LCN_SEM_VAGA')
    }
  }
  {
    const orcamento = criarOrcamentoDeMidia(8)
    const respostas = [respostaDeMidia({ orcamento }), respostaDeMidia({ orcamento })]
    const r = await criarBaixador({ cfg, orcamento, buscar: servico(null, respostas, true), dormir: semDormir }).baixar('https://post.exemplo')
    check('álbum que cabe retém a soma exata de oito bytes até a entrega', orcamento.estado().reservados === 8 && r.midias.reduce((s, m) => s + m.buffer.length, 0) === 8)
    r.liberar()
    check('descartar álbum elimina todos os buffers e devolve a soma', orcamento.estado().reservados === 0 && r.midias.every((m) => m.buffer === null))
  }
  {
    const orcamento = criarOrcamentoDeMidia(4)
    const midia = await lerRespostaDeMidia(respostaDeMidia({ orcamento }), { limiteBytes: 4, orcamento })
    let acabar
    const pendente = new Promise((r) => { acabar = r })
    const envio = midia.usar(() => pendente)
    const erro = await capturar(() => comTimeout(() => envio, 1, 'Prazo simulado de envio.'))
    midia.liberar()
    check('timeout mantém a reserva enquanto o socket ainda usa o buffer', erro?.code === 'LCN_TIMEOUT' && orcamento.estado().reservados === 4 && midia.buffer.length === 4)
    acabar(); await envio
    check('término real do socket libera a memória mesmo após timeout', orcamento.estado().reservados === 0 && midia.buffer === null)
  }

  {
    let iniciouEnvio
    let terminarEnvio
    const enviando = new Promise((r) => { iniciouEnvio = r })
    const podeTerminar = new Promise((r) => { terminarEnvio = r })
    const c = cliente(async () => { iniciouEnvio(); await podeTerminar; return { id: 'ok' } })
    const m = motor(declaracao({ forma: 'mídia', campo: 'itens' }))
    const orcamentosRecebidos = []
    const segundaResposta = respostaDeMidia()
    const deps = {
      cfg: { ...cfg, hardware: { maxMidiaMB: 1, orcamentoMidiaMB: 6 / MB } },
      mediaRefCache: {},
      criarBaixador: (opcoes) => {
        orcamentosRecebidos.push(opcoes.orcamento)
        return criarBaixador({ ...opcoes, buscar: servico(null, [respostaDeMidia()], true), dormir: semDormir })
      },
      criarExecutorDeConexao: (opcoes) => {
        orcamentosRecebidos.push(opcoes.orcamento)
        return criarExecutorDeConexao({ ...opcoes, buscar: servico({ itens: arquivos.slice(0, 1) }, [segundaResposta]) })
      }
    }
    const primeiro = executarComandos(c, [comando('media.download', { url: 'https://post.exemplo' })], m, deps)
    await enviando
    await executarComandos(cliente(), [{ ...comando('connection.call', { conexao: 'teste', funcao: 'f' }), id: 'segundo' }], m, deps)
    check('gateway compartilha o mesmo orçamento entre downloader e conexão concorrentes', orcamentosRecebidos.length === 2 && orcamentosRecebidos[0] === orcamentosRecebidos[1])
    check('mídia esperando envio impede nova alocação que ultrapassaria a soma', segundaResposta.leituras() === 0 && orcamentosRecebidos[0].estado().reservados === 4 && m.confirmacoes[0]?.status === 'failed')
    terminarEnvio(); await primeiro
    check('gateway devolve o orçamento do downloader após a entrega real', orcamentosRecebidos[0].estado().reservados === 0 && m.confirmacoes[1]?.status === 'sent')
  }
  {
    const orcamento = criarOrcamentoDeMidia(8)
    orcamento.adquirir(6)
    orcamento.ajustarLimite(4)
    check('redução de orçamento preserva reservas existentes e recusa novas', (await capturar(() => orcamento.adquirir(1)))?.code === 'LCN_SEM_VAGA' && orcamento.estado().reservados === 6)
    orcamento.liberar(6)
    orcamento.adquirir(4)
    check('orçamento reduzido volta a admitir somente até o novo teto', orcamento.estado().reservados === 4 && orcamento.estado().livres === 0)
    orcamento.liberar(4)
  }

  // 4.4: o teto geral não pode substituir silenciosamente o limite específico.
  for (const [download, geral, efetivo] of [[2, 1, 1], [1, 2, 1], [128, undefined, 64], [undefined, 128, 64], [undefined, undefined, 64], [Infinity, Infinity, 64], [0, -1, 64]]) {
    const c = { download: { limiteMB: download }, hardware: { maxMidiaMB: geral } }
    check(`precedência download=${download}, geral=${geral}: limite efetivo ${efetivo} MB`, configuracaoDeDownload(c).limiteBytes === efetivo * MB)
  }
  check('orçamento total tem caminho de configuração, sem teto fixo', limitesDeMidia({ hardware: { orcamentoMidiaMB: 512 } }).orcamento === 512 * MB)
  for (const tipo of ['connection.call', 'whatsapp.recover', 'acervo.save', 'whatsapp.sendFile', 'media.download']) {
    const orcamento = criarOrcamentoDeMidia(4)
    let limiteRecebido
    let leuCorpo = false
    const c = { ...cfg, hardware: { maxMidiaMB: 4 / MB }, download: { ...cfg.download, limiteMB: 6 / MB } }
    const m = motor()
    const deps = {
      cfg: c, orcamento,
      mediaRefCache: { resolver: () => ({ node: {}, tipo: 'image' }) },
      resolverJidProprio: () => CHAT,
      baixarBuffer: async (_c, _n, _t, limite) => { limiteRecebido = limite; throw new Error('Recusa antes de alocar a mídia grande.') },
      acervo: { obter: () => ({ id: 'foto', kind: 'image', sizeBytes: 5 }), lerConteudoAsync: async () => { leuCorpo = true; return Buffer.alloc(5) } },
      criarExecutorDeConexao: (opcoes) => {
        limiteRecebido = opcoes.limiteBytes
        return criarExecutorDeConexao({ ...opcoes, buscar: async () => json({ arquivo: 'YWJjZGU=' }) })
      },
      criarBaixador: (opcoes) => {
        limiteRecebido = configuracaoDeDownload(opcoes.cfg).limiteBytes
        const resposta = respostaDeMidia({ bytes: 5, antes: () => { leuCorpo = true } })
        return criarBaixador({ ...opcoes, buscar: servico(null, [resposta], true), dormir: semDormir })
      }
    }
    await executarComandos(cliente(), [comando(tipo, { conexao: 'teste', funcao: 'f', mediaRef: 'ref', fileId: 'foto', url: 'https://post.exemplo' })], m, deps)
    check(`${tipo}: teto configurado de quatro bytes recusa mídia de cinco sem alocar corpo`, m.confirmacoes[0]?.status === 'failed' && !leuCorpo && orcamento.estado().reservados === 0 && (tipo === 'whatsapp.sendFile' || limiteRecebido === 4))
  }
  {
    const orcamento = criarOrcamentoDeMidia(8)
    const m = motor()
    const deps = { mediaRefCache: cache, orcamento, limiteBytes: 4, criarExecutorDeConexao: (opcoes) => criarExecutorDeConexao({ ...opcoes, buscar: async () => json({ arquivo: 'YWJj' }) }) }
    await executarComandos(cliente(), [comando('connection.call', { conexao: 'teste', funcao: 'f', encadeado: true })], m, deps)
    const ref = m.confirmacoes[0]?.resultado?.token
    check('mídia encadeada conserva sua reserva no cache após encerrar o comando', !!ref && cache.resolver(ref).node.lcnBuffer.length === 3 && orcamento.estado().reservados === 3)
    const originalAgora = Date.now
    Date.now = () => originalAgora() + 10 * 60 * 1000
    try { check('expirar a referência devolve a reserva encadeada', cache.resolver(ref) === null && orcamento.estado().reservados === 0) } finally { Date.now = originalAgora }
    for (const falha of [false, true]) {
      const m = motor()
      await executarComandos(cliente(async () => { if (falha) throw new Error('Envio recusado no teste.'); return { id: 'ok' } }), [comando('connection.call', { conexao: 'teste', funcao: 'f' })], m, deps)
      check(`conexão ${falha ? 'com falha' : 'com sucesso'} devolve a reserva depois do envio`, orcamento.estado().reservados === 0 && m.confirmacoes[0].status === (falha ? 'failed' : 'sent'))
    }
  }
  console.log(`\n${checagens} checagens de memória, zero falhas.`)
} finally {
  cache._reiniciarParaTeste()
  fs.rmSync(pasta, { recursive: true, force: true })
}
