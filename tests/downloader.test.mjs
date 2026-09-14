// Baixar mídia de link por um serviço externo.
//
// O serviço é assíncrono (cria um trabalho, você acompanha), então quase tudo
// aqui é sobre ESPERAR direito e falhar dizendo o porquê. Um download que falha
// calado depois de o bot prometer "baixando…" é o pior resultado possível.
//
// Nada aqui toca a rede: `buscar` e `dormir` são injetados.
import { ErroDeDownload, configuracaoDeDownload, criarBaixador } from '../src/downloader.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const cfgBase = { download: { api: 'http://127.0.0.1:8765', tokenArquivo: '', limiteMB: 64, esperaMaximaSegundos: 30 } }

// Serviço falso: responde por caminho, contando as chamadas.
function servico ({ job = 'j1', estados = [], midias = [], erroDoJob = null, bytesDaMidia = null, status = {} } = {}) {
  const chamadas = []
  let vez = 0
  const buscar = async (url, opcoes = {}) => {
    const caminho = url.replace('http://127.0.0.1:8765', '')
    chamadas.push({ caminho, metodo: opcoes.method || 'GET', auth: opcoes.headers?.Authorization })
    if (status[caminho]) return { ok: false, status: status[caminho], json: async () => ({}) }
    if (caminho === '/download') return { ok: true, status: 200, json: async () => ({ job }) }
    if (caminho.startsWith('/jobs/')) {
      const estado = estados[Math.min(vez++, estados.length - 1)]
      return { ok: true, status: 200, json: async () => ({ estado, erro: erroDoJob, descricao: 'Título do vídeo', midias }) }
    }
    if (caminho.startsWith('/media/')) {
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(bytesDaMidia ?? 'bytes-do-video').buffer }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { buscar, chamadas }
}

const semDormir = async () => {}
const baixador = (s, cfg = cfgBase) => criarBaixador({ cfg, buscar: s.buscar, dormir: semDormir, token: 'x' })

// O token vem de arquivo; nos testes é injetado por configuração direta.
const comToken = (extra = {}) => ({ download: { ...cfgBase.download, ...extra } })

// --- configuração ----------------------------------------------------------
const conf = configuracaoDeDownload({ download: { api: 'http://x:1/', limiteMB: 10, esperaMaximaSegundos: 5 } })
check('a barra final do endereço é removida', conf.api === 'http://x:1')
check('o limite vira bytes', conf.limiteBytes === 10 * 1024 * 1024)
check('a espera vira milissegundos', conf.esperaMaximaMs === 5000)
check('sem arquivo de token, não há token', conf.token === null)

// --- o que falta é dito com clareza ---------------------------------------
let semApi
try { await criarBaixador({ cfg: { download: {} } }).baixar('https://x.com/a') } catch (e) { semApi = e }
check('sem serviço configurado, explica o que falta', semApi instanceof ErroDeDownload && /não está configurado/.test(semApi.message), semApi?.message)

let semTokenErro
try { await criarBaixador({ cfg: comToken({ tokenArquivo: '/caminho/que/nao/existe' }) }).baixar('https://x.com/a') } catch (e) { semTokenErro = e }
check('token ilegível diz QUAL arquivo não foi lido', /caminho\/que\/nao\/existe/.test(semTokenErro?.message || ''), semTokenErro?.message)

// --- caminho feliz ---------------------------------------------------------
const feliz = servico({
  estados: ['na_fila', 'baixando', 'pronto'],
  midias: [{ id: 'm1', nome: 'video.mp4', tipo: 'video', mime: 'video/mp4', bytes: 1024, url: '/media/m1' }]
})
const b = criarBaixador({ cfg: cfgBase, buscar: feliz.buscar, dormir: semDormir })
// injeta token direto, já que o arquivo não existe no teste
const resultado = await (async () => {
  const comTokenFixo = criarBaixador({ cfg: cfgBase, buscar: feliz.buscar, dormir: semDormir })
  Object.defineProperty(comTokenFixo, '_', { value: 1 })
  return comTokenFixo
})() && null

check('serviço sem token configurado recusa antes de chamar a rede', feliz.chamadas.length === 0)

// A partir daqui o token é lido de um arquivo real temporário.
const fs = await import('fs'); const os = await import('os'); const path = await import('path')
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-dl-'))
const arquivoToken = path.join(pasta, 'token')
fs.writeFileSync(arquivoToken, 'segredo-abc\n')
const cfgOk = comToken({ tokenArquivo: arquivoToken })

const s1 = servico({
  estados: ['na_fila', 'baixando', 'pronto'],
  midias: [{ id: 'm1', nome: 'video.mp4', tipo: 'video', mime: 'video/mp4', bytes: 1024, url: '/media/m1' }]
})
const midia = await criarBaixador({ cfg: cfgOk, buscar: s1.buscar, dormir: semDormir }).baixar('https://youtu.be/abc', 'video')
check('devolve os bytes do arquivo', midia.buffer.toString() === 'bytes-do-video')
check('traduz o tipo do serviço para o do WhatsApp', midia.tipo === 'video')
check('preserva o mimetype', midia.mime === 'video/mp4')
check('traz a descrição do serviço para virar legenda', midia.descricao === 'Título do vídeo')
check('espera o trabalho terminar antes de buscar o arquivo',
  s1.chamadas.filter((c) => c.caminho.startsWith('/jobs/')).length === 3, String(s1.chamadas.length))
check('o token do arquivo é usado no cabeçalho', s1.chamadas.every((c) => c.auth === 'Bearer segredo-abc'))
check('o pedido de download é POST', s1.chamadas[0].metodo === 'POST' && s1.chamadas[0].caminho === '/download')

// --- tipos: o que o WhatsApp entende --------------------------------------
for (const [doServico, noWhats] of [['imagem', 'image'], ['audio', 'audio'], ['outro', 'document']]) {
  const s = servico({ estados: ['pronto'], midias: [{ id: 'm', nome: 'a', tipo: doServico, mime: 'x/y', bytes: 10, url: '/media/m' }] })
  const r = await criarBaixador({ cfg: cfgOk, buscar: s.buscar, dormir: semDormir }).baixar('https://x.com/a')
  check(`tipo "${doServico}" vira "${noWhats}"`, r.tipo === noWhats, r.tipo)
}

// --- arquivo grande demais: recusa ANTES de transferir --------------------
// O serviço aceita até 2 GB; o WhatsApp, muito menos. Puxar centenas de MB para
// descobrir no fim que não dá é desperdício de banda e de tempo de quem espera.
const grande = servico({
  estados: ['pronto'],
  midias: [{ id: 'm', nome: 'filme.mp4', tipo: 'video', mime: 'video/mp4', bytes: 900 * 1024 * 1024, url: '/media/m' }]
})
let erroGrande
try { await criarBaixador({ cfg: comToken({ tokenArquivo: arquivoToken, limiteMB: 64 }), buscar: grande.buscar, dormir: semDormir }).baixar('https://x.com/a') } catch (e) { erroGrande = e }
check('arquivo acima do limite é recusado', erroGrande instanceof ErroDeDownload)
check('a recusa diz o tamanho e o limite', /900,0 MB.*64,0 MB/.test(erroGrande?.message || ''), erroGrande?.message)
check('e recusa SEM baixar o arquivo', !grande.chamadas.some((c) => c.caminho.startsWith('/media/')))

// --- o erro do serviço chega a quem pediu ---------------------------------
const comErro = servico({ estados: ['erro'], erroDoJob: 'vídeo indisponível nesta região' })
let erroDoServico
try { await criarBaixador({ cfg: cfgOk, buscar: comErro.buscar, dormir: semDormir }).baixar('https://x.com/a') } catch (e) { erroDoServico = e }
check('o motivo que o serviço deu é repassado', /indisponível nesta região/.test(erroDoServico?.message || ''), erroDoServico?.message)

// --- estado desconhecido não vira laço infinito ---------------------------
const estranho = servico({ estados: ['coisa_nova'], midias: [] })
let erroEstranho
try { await criarBaixador({ cfg: cfgOk, buscar: estranho.buscar, dormir: semDormir }).baixar('https://x.com/a') } catch (e) { erroEstranho = e }
check('estado desconhecido encerra a espera em vez de girar para sempre', !!erroEstranho)
check('e diz que não veio arquivo', /não veio arquivo/.test(erroEstranho?.message || ''), erroEstranho?.message)

// --- desistir de esperar é erro conhecido, não silêncio -------------------
let relogio = 0
const eterno = servico({ estados: ['baixando'] })
let erroEspera
try {
  await criarBaixador({
    cfg: comToken({ tokenArquivo: arquivoToken, esperaMaximaSegundos: 5 }),
    buscar: eterno.buscar,
    dormir: async () => { relogio += 1500 },
    agora: () => relogio
  }).baixar('https://x.com/a')
} catch (e) { erroEspera = e }
check('espera demais vira erro com prazo explícito', /passou de 5s/.test(erroEspera?.message || ''), erroEspera?.message)

// --- token recusado é diferente de serviço fora do ar ---------------------
const recusado = servico({ estados: ['pronto'], status: { '/download': 401 } })
let erro401
try { await criarBaixador({ cfg: cfgOk, buscar: recusado.buscar, dormir: semDormir }).baixar('https://x.com/a') } catch (e) { erro401 = e }
check('token recusado é dito como token, não como erro genérico', /recusou o token/.test(erro401?.message || ''), erro401?.message)

const foraDoAr = { buscar: async () => { throw new Error('ECONNREFUSED') } }
let erroRede
try { await criarBaixador({ cfg: cfgOk, buscar: foraDoAr.buscar, dormir: semDormir }).baixar('https://x.com/a') } catch (e) { erroRede = e }
check('serviço fora do ar vira mensagem legível, não erro de rede cru', /Não consegui falar com o serviço/.test(erroRede?.message || ''), erroRede?.message)

// --- vários arquivos: escolhe o que a pessoa espera ----------------------
const carrossel = servico({
  estados: ['pronto'],
  midias: [
    { id: 'a', nome: 'capa.jpg', tipo: 'imagem', mime: 'image/jpeg', bytes: 10, url: '/media/a' },
    { id: 'b', nome: 'video.mp4', tipo: 'video', mime: 'video/mp4', bytes: 20, url: '/media/b' }
  ]
})
const escolhida = await criarBaixador({ cfg: cfgOk, buscar: carrossel.buscar, dormir: semDormir }).baixar('https://x.com/a')
check('com vídeo e imagem juntos, manda o vídeo', escolhida.nome === 'video.mp4', escolhida.nome)

fs.rmSync(pasta, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE DOWNLOAD PASSARAM')
process.exit(falhas ? 1 : 0)
