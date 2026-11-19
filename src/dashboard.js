// Dashboard de terminal do LCNWhatsApp (comando `lcn`).
// Porta de entrada do app: status, uso/conexões, limpeza e configurações.
// Fala com o bot só por arquivos (config.json, data/state.json, data/archive.json,
// midia/), então funciona igual em modo container ou seco.
import readline from 'readline'
import path from 'path'
import { spawnSync } from 'child_process'
import fs from 'fs'
import qrcode from 'qrcode-terminal'
import * as cfgMod from './config.js'
import * as archive from './archive.js'
import * as state from './state.js'
import * as runtime from './runtime.js'
import * as directoryMod from './directory.js'
import { PASTA_DADOS, ARQ_GRUPOS_REFRESH } from './paths.js'
import { soDigitos } from './util.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
// Se o stdin fechar (EOF / sem TTY), encerra em vez de entrar em loop.
rl.on('close', () => process.exit(0))
const ask = (q) => new Promise((r) => rl.question(q, r))
const pausar = () => ask('\nEnter pra voltar...')
const limpar = () => process.stdout.write('\x1Bc')

const B = '\x1b[1m'; const D = '\x1b[2m'; const G = '\x1b[32m'; const Y = '\x1b[33m'
const R = '\x1b[31m'; const C = '\x1b[36m'; const Z = '\x1b[0m'

function tempoRelativo (ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s atrás`
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`
  return `${Math.floor(s / 86400)}d atrás`
}

function duracao (ms) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return [d && `${d}d`, h && `${h}h`, `${m}min`].filter(Boolean).join(' ')
}

function cabecalho () {
  limpar()
  const st = state.ler()
  const rt = runtime.lerRuntime()
  const serv = runtime.statusServico()
  const conBadge = st?.conectado ? `${G}● conectado${Z}` : `${R}○ desconectado${Z}`
  const servBadge = serv === 'rodando' ? `${G}rodando${Z}` : serv === 'parado' ? `${Y}parado${Z}` : `${D}?${Z}`

  console.log(`${B}${C}╔══════════════════════════════════════════════════╗${Z}`)
  console.log(`${B}${C}║             LCNWhatsApp — painel                 ║${Z}`)
  console.log(`${B}${C}╚══════════════════════════════════════════════════╝${Z}`)
  console.log(` Conexão : ${conBadge}${st?.numero ? `  (${st.numero}${st.nome ? ', ' + st.nome : ''})` : ''}`)
  console.log(` Serviço : ${servBadge}   modo: ${B}${rt.mode}${Z}${rt.engine ? ` (${rt.engine})` : ''}`)
  if (st?.conectado && st?.desde) console.log(` Online há: ${duracao(Date.now() - st.desde)}`)
  const t = cfgMod.carregar().transcricao
  // pythonBin só é gravado pelo install.sh no modo nativo; no container o
  // ambiente vem de LCN_PYTHON (ENV do Dockerfile.whisper) — checar só
  // pythonBin dava falso positivo mesmo com a imagem certa já rodando.
  const pyOk = t.pythonBin ? fs.existsSync(t.pythonBin) : !!process.env.LCN_PYTHON
  if (t.provedor === 'faster-whisper' && !pyOk) {
    console.log(`${Y}⚠ faster-whisper configurado mas o ambiente Python não foi encontrado.${Z}`)
    if (dentroDeContainer()) {
      console.log(`${D}   Esta imagem não tem o ambiente do faster-whisper (foi construída com o Dockerfile${Z}`)
      console.log(`${D}   simples). No HOST, rode "sh update.sh" e ative a transcrição${Z}`)
      console.log(`${D}   local — isso reconstrói com Dockerfile.whisper e baixa o modelo.${Z}`)
    } else {
      console.log(`${D}   Rode o instalador (venv + pip install faster-whisper) — no 1º uso baixa o modelo (Hugging Face, pode demorar).${Z}`)
    }
  }
  console.log(`${D}────────────────────────────────────────────────────${Z}`)
}

async function menuPrincipal () {
  for (;;) {
    cabecalho()
    console.log(` ${B}1${Z}  Dados de uso e conexões`)
    console.log(` ${B}2${Z}  Limpar capturas antigas`)
    console.log(` ${B}3${Z}  Configurações`)
    console.log(` ${B}4${Z}  Serviço (conectar/QR, reiniciar, logs)`)
    console.log(` ${B}5${Z}  Atualizar sistema`)
    console.log(` ${B}0${Z}  Sair`)
    const op = (await ask('\n> ')).trim()
    if (op === '1') await telaUso()
    else if (op === '2') await telaLimpeza()
    else if (op === '3') await telaConfig()
    else if (op === '4') await telaServico()
    else if (op === '5') await telaAtualizar()
    else if (op === '0') { rl.close(); return }
  }
}

async function telaUso () {
  cabecalho()
  const st = state.ler()
  if (!st) { console.log('Sem dados de estado ainda. Inicie o bot pelo menu Serviço.'); return pausar() }
  const m = st.metricas || {}
  console.log(`${B}Dados de uso e conexões${Z}\n`)
  console.log(` Iniciado         : ${st.iniciadoEm ? tempoRelativo(st.iniciadoEm) : '—'}`)
  console.log(` Memória (RSS)    : ${st.memoriaMB ?? '—'} MB`)
  console.log(` Reconexões       : ${m.reconexoes ?? 0}`)
  console.log(` Quedas           : ${m.quedas ?? 0}`)
  if (fs.existsSync(caminhoFlag())) console.log(`\n${Y}⚠️  Sinalizado update do zapo-js (quedas seguidas). Ver menu Atualizar.${Z}`)
  await pausar()
}

function caminhoFlag () {
  return path.join(PASTA_DADOS, 'precisa-update.flag')
}

// Recuperação de visualização única saiu do LCN (a Meta mudou o tratamento
// desses arquivos). Nada mais grava em data/archive.json; esta tela só existe
// para apagar as capturas que ficaram de instalações antigas.
async function telaLimpeza () {
  cabecalho()
  console.log(`${B}Limpar capturas antigas${Z}  ${D}(${archive.total()} no índice)${Z}\n`)
  console.log(' 1  Apagar por seleção (escolher itens)')
  console.log(' 2  Apagar por remetente (lote)')
  console.log(' 3  Apagar por período (últimos N dias / mais antigos que N dias)')
  console.log(' 4  Apagar TUDO')
  console.log(' 0  Voltar')
  const op = (await ask('\n> ')).trim()

  if (op === '1') {
    const itens = archive.listar()
    itens.slice(0, 40).forEach((i, idx) => console.log(` ${String(idx + 1).padStart(2)} [${i.tipo}] ${i.numero} ${tempoRelativo(i.timestamp)}`))
    const sel = (await ask('\nNúmeros separados por vírgula (ex: 1,3,4): ')).trim()
    const idx = sel.split(',').map((s) => parseInt(s.trim(), 10) - 1).filter((n) => n >= 0)
    const ids = idx.map((k) => itens[k]?.id).filter(Boolean)
    if (ids.length && await confirmar(`Apagar ${ids.length} item(ns)?`)) console.log(`${G}Apagados: ${archive.apagar(ids)}${Z}`)
  } else if (op === '2') {
    const num = (await ask('Número do remetente (só dígitos): ')).trim().replace(/\D/g, '')
    const ids = archive.idsPorFiltro({ numero: num })
    if (ids.length && await confirmar(`Apagar ${ids.length} mídia(s) de ${num}?`)) console.log(`${G}Apagados: ${archive.apagar(ids)}${Z}`)
    else console.log('Nada a apagar.')
  } else if (op === '3') {
    const dias = parseInt((await ask('Apagar mais antigos que quantos dias? ')).trim(), 10)
    if (dias > 0) {
      const ids = archive.idsPorFiltro({ ate: Date.now() - dias * 86400000 })
      if (ids.length && await confirmar(`Apagar ${ids.length} mídia(s) com mais de ${dias}d?`)) console.log(`${G}Apagados: ${archive.apagar(ids)}${Z}`)
      else console.log('Nada a apagar.')
    }
  } else if (op === '4') {
    const ids = archive.listar().map((i) => i.id)
    if (ids.length && await confirmar(`${R}Apagar TODAS as ${ids.length} mídias?${Z}`)) console.log(`${G}Apagados: ${archive.apagar(ids)}${Z}`)
  } else return
  await pausar()
}

async function confirmar (msg) {
  const r = (await ask(`${msg} (s/N) `)).trim().toLowerCase()
  return r === 's' || r === 'sim'
}

// ————— Seleção por lista (em vez de digitar JID/número de cabeça) —————

// Pede pro bot atualizar data/grupos.json (o dashboard não abre conexão
// própria com o WhatsApp — só pede pro processo que já está conectado).
function solicitarRefreshGrupos () {
  try { fs.writeFileSync(ARQ_GRUPOS_REFRESH, String(Date.now())) } catch {}
}

function nomeDoId (id) {
  const ct = directoryMod.listarContatos().find((c) => c.numero === id)
  if (ct) return ct.nome ? `${ct.nome} (${ct.numero})` : ct.numero
  const g = directoryMod.listarGrupos().find((g) => g.id === id)
  if (g) return g.nome
  return id
}

// Lista numerada pra escolher UM item, com busca por nome. `itens` é
// [{id, nome}]. Retorna o id, ou null (chame o fallback manual) quando
// `itens` vier vazio, 'm' ou Enter.
async function selecionarUm (itens, titulo) {
  if (!itens.length) return null
  let filtro = ''
  for (;;) {
    const visiveis = filtro ? itens.filter((i) => i.nome.toLowerCase().includes(filtro)) : itens
    cabecalho()
    console.log(`${B}${titulo}${Z}${filtro ? `  ${D}(filtro: "${filtro}")${Z}` : ''}\n`)
    if (!visiveis.length) console.log(` ${D}nenhum resultado pro filtro${Z}`)
    visiveis.forEach((item, idx) => console.log(` ${String(idx + 1).padStart(2)}  ${item.nome}`))
    console.log(`\n Número do item | ${B}b${Z}=buscar${filtro ? ` ${B}t${Z}=tirar filtro` : ''} | ${B}m${Z}=manual | Enter cancela`)
    const op = (await ask('\n> ')).trim().toLowerCase()
    if (!op || op === 'm') return null
    if (op === 'b') { filtro = (await ask('Buscar por nome: ')).trim().toLowerCase(); continue }
    if (op === 't') { filtro = ''; continue }
    const escolhido = visiveis[parseInt(op, 10) - 1]
    if (escolhido) return escolhido.id
    return null
  }
}

function itensContatos () {
  return directoryMod.listarContatos().map((c) => ({ id: c.numero, nome: c.nome ? `${c.nome} (${c.numero})` : c.numero }))
}

function itensGrupos () {
  const grupos = directoryMod.listarGrupos()
  if (!grupos.length) solicitarRefreshGrupos()
  return grupos.map((g) => ({ id: g.id, nome: g.nome }))
}

// ————— Configurações por tópicos —————
// Item de menu com valor alinhado numa coluna fixa e colorido pelo estado
// (verde = ligado/ativo, apagado = desligado/off, ciano = informativo neutro).
function itemCfg (num, label, valor) {
  const ligado = /^(ligado|on|sim)$/i.test(valor)
  const desligado = /^(desligado|off|não)$/i.test(valor) || /^0 conversa/i.test(valor)
  const cor = ligado ? G : desligado ? D : C
  console.log(` ${B}${num}${Z}  ${label.padEnd(28)} ${D}(${Z}${cor}${valor}${Z}${D})${Z}`)
}

async function telaConfig () {
  for (;;) {
    cabecalho()
    const c = cfgMod.carregar()
    console.log(`${B}Configurações${Z}\n`)
    itemCfg(1, 'Transcrição', c.transcricao.provedor)
    itemCfg(2, 'Transcrição por conversa', `${(c.transcricao.conversas || []).length} conversa(s)`)
    console.log(` ${B}3${Z}  Hardware / baixo consumo`)
    itemCfg(4, 'Atualização (auto-update lib)', c.atualizacao.autoUpdateLib ? 'on' : 'off')
    console.log(` ${B}0${Z}  Voltar`)
    const op = (await ask('\n> ')).trim()
    if (op === '1') await cfgTranscricao(c)
    else if (op === '2') await cfgTranscricaoConversas(c)
    else if (op === '3') await cfgHardware(c)
    else if (op === '4') await cfgAtualizacao(c)
    else if (op === '0') return
  }
}

async function cfgTranscricao (c) {
  console.log('\n1 off  2 faster-whisper  3 openai  4 groq  5 custom')
  const op = (await ask('> ')).trim()
  const t = c.transcricao
  if (op === '1') t.provedor = 'off'
  else if (op === '2') { t.provedor = 'faster-whisper'; t.modelo = (await ask('Modelo (tiny/base/small) [base]: ')).trim() || 'base' }
  else if (op === '3') { t.provedor = 'openai'; t.openaiApiKey = (await ask('OpenAI API key: ')).trim(); t.openaiModelo = (await ask('Modelo [whisper-1]: ')).trim() || 'whisper-1' }
  else if (op === '4') { t.provedor = 'groq'; t.groqApiKey = (await ask('Groq API key: ')).trim(); t.groqModelo = (await ask('Modelo [whisper-large-v3-turbo]: ')).trim() || 'whisper-large-v3-turbo' }
  else if (op === '5') { t.provedor = 'custom'; t.comando = (await ask('Comando ({file} = caminho do áudio): ')).trim() }
  if (['2', '3', '4', '5'].includes(op)) t.idioma = (await ask('Idioma [pt]: ')).trim() || 'pt'
  t.comandoTerceiros = await confirmar(`Por padrão, qualquer participante pode usar /transcrever (respondendo um áudio)? (atual: ${!!t.comandoTerceiros})`)
  cfgMod.salvar(c); console.log(`${G}Salvo.${Z}`); await pausar()
}

// Nova: config por conversa — transcrição automática de todo áudio e/ou
// override do comandoTerceiros geral, só pra essa conversa.
async function cfgTranscricaoConversas (c) {
  const conversas = c.transcricao.conversas || (c.transcricao.conversas = [])
  for (;;) {
    cabecalho()
    console.log(`${B}Transcrição por conversa${Z}\n`)
    if (!conversas.length) console.log(` ${D}nenhuma conversa configurada${Z}`)
    conversas.forEach((cv, idx) => {
      const comandoTxt = cv.comandoTerceiros === true ? 'sim' : cv.comandoTerceiros === false ? 'não' : 'padrão geral'
      console.log(` ${String(idx + 1).padStart(2)}  ${nomeDoId(cv.id)}   auto:${cv.auto ? 'sim' : 'não'}   comando p/ terceiros:${comandoTxt}`)
    })
    console.log(`\n ${B}a${Z}=adicionar  ${B}e${Z}=editar  ${B}r${Z}=remover  ${B}0${Z}=voltar`)
    const op = (await ask('\n> ')).trim().toLowerCase()
    if (op === '0' || op === '') return

    if (op === 'a') {
      const itens = [...itensContatos(), ...itensGrupos()]
      const escolhido = await selecionarUm(itens, 'Escolha a conversa')
      const id = escolhido || soDigitos((await ask('Número/ID do grupo: ')).trim())
      if (!id) continue
      const entrada = await editarConversaTranscricao()
      entrada.id = id
      const existente = conversas.findIndex((cv) => cv.id === id)
      if (existente >= 0) conversas[existente] = entrada; else conversas.push(entrada)
      cfgMod.salvar(c); console.log(`${G}Salvo.${Z}`)
    } else if (op === 'e' || op === 'r') {
      const idx = parseInt((await ask('Número do item: ')).trim(), 10) - 1
      if (idx < 0 || idx >= conversas.length) continue
      if (op === 'r') {
        conversas.splice(idx, 1)
      } else {
        const entrada = await editarConversaTranscricao()
        conversas[idx] = { ...entrada, id: conversas[idx].id }
      }
      cfgMod.salvar(c); console.log(`${G}Salvo.${Z}`)
    }
  }
}

async function editarConversaTranscricao () {
  const auto = await confirmar('Transcrever automaticamente todo áudio dessa conversa?')
  const ct = (await ask('Liberar /transcrever pra terceiros nessa conversa? (s/n/Enter=padrão geral): ')).trim().toLowerCase()
  const comandoTerceiros = ct === 's' ? true : ct === 'n' ? false : null
  return { auto, comandoTerceiros }
}

function parseTaxaBytes (valor) {
  const texto = valor.trim().toLowerCase().replace(',', '.')
  if (texto === 'null') return 0
  const match = texto.match(/^(\d+(?:\.\d+)?)\s*([km]?)$/)
  if (!match) return null
  const multiplicador = match[2] === 'k' ? 1000 : match[2] === 'm' ? 1000000 : 1
  const bytes = Math.round(Number(match[1]) * multiplicador)
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null
}

async function cfgHardware (c) {
  const h = c.hardware
  h.markOnline = await confirmar(`Marcar bot como "online" ao conectar? (atual: ${h.markOnline})`)
  const mx = (await ask(`Limite de tamanho de mídia em MB [${h.maxMidiaMB}]: `)).trim()
  if (mx) h.maxMidiaMB = parseInt(mx, 10) || h.maxMidiaMB
  const cc = (await ask(`Downloads simultâneos [${h.downloadConcorrencia}]: `)).trim()
  if (cc) h.downloadConcorrencia = parseInt(cc, 10) || h.downloadConcorrencia
  const banda = h.bandwidthLimit || (h.bandwidthLimit = { downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 })
  const down = (await ask(`Banda de download em bytes/s (500k/2m; 0=sem limite) [${banda.downloadBytesPerSecond || 0}]: `)).trim()
  if (down) {
    const taxa = parseTaxaBytes(down)
    if (taxa === null) console.log(`${Y}Valor de download inválido; mantido.${Z}`)
    else banda.downloadBytesPerSecond = taxa
  }
  const up = (await ask(`Banda de upload em bytes/s (500k/2m; 0=sem limite) [${banda.uploadBytesPerSecond || 0}]: `)).trim()
  if (up) {
    const taxa = parseTaxaBytes(up)
    if (taxa === null) console.log(`${Y}Valor de upload inválido; mantido.${Z}`)
    else banda.uploadBytesPerSecond = taxa
  }
  const lv = (await ask(`Log level (silent/error/info) [${h.logLevel}]: `)).trim()
  if (lv) h.logLevel = lv
  h.debug = await confirmar(`Modo debug (loga cada mensagem recebida)? (atual: ${!!h.debug})`)
  cfgMod.salvar(c); console.log(`${G}Salvo.${Z}`); await pausar()
}

async function cfgAtualizacao (c) {
  c.atualizacao.autoUpdateLib = await confirmar(`Auto-sinalizar update do zapo-js em quedas persistentes? (atual: ${c.atualizacao.autoUpdateLib})`)
  if (c.atualizacao.autoUpdateLib) {
    const n = (await ask(`Após quantas quedas seguidas? [${c.atualizacao.falhasParaUpdate}]: `)).trim()
    if (n) c.atualizacao.falhasParaUpdate = parseInt(n, 10) || c.atualizacao.falhasParaUpdate
  }
  cfgMod.salvar(c); console.log(`${G}Salvo.${Z}`); await pausar()
}

// ————— Serviço —————
async function telaServico () {
  for (;;) {
    cabecalho()
    const st = state.ler()
    console.log(`${B}Serviço${Z}   estado: ${runtime.statusServico()}   conexão: ${st?.conectado ? G + 'conectado' + Z : R + 'desconectado' + Z}\n`)
    console.log(` ${B}1${Z}  Conectar / mostrar QR${st?.conectado ? D + ' (já conectado)' + Z : ''}`)
    console.log(` ${B}2${Z}  Reiniciar bot`)
    console.log(` ${B}3${Z}  Ver logs`)
    console.log(` ${B}4${Z}  ${Y}Apagar dados do número (desconectar e reparear)${Z}`)
    console.log(` ${B}0${Z}  Voltar`)
    const op = (await ask('\n> ')).trim()
    if (op === '1') await telaConectar()
    else if (op === '2') {
      if (await confirmar('Reiniciar o bot agora?')) { const r = runtime.reiniciarBot(); console.log(r.ok ? `${G}${r.out}${Z}` : `${R}${r.out}${Z}`); await pausar() }
    } else if (op === '3') { const r = runtime.logsServico(40); console.log('\n' + (r.out || '(sem logs)')); await pausar() }
    else if (op === '4') { await apagarDadosNumero(); await pausar() }
    else return
  }
}

// Mostra o QR pra conectar. O bot salva o QR em data/state.json quando gera um;
// aqui a gente renderiza. Atualiza até conectar.
async function telaConectar () {
  cabecalho()
  const st = state.ler()
  if (st?.conectado) {
    console.log(`${G}Já conectado${Z}${st.numero ? ` como ${st.numero}` : ''}.`)
    console.log('Pra trocar de número, use "Apagar dados do número".')
    return pausar()
  }
  if (st?.qr) {
    console.log(`${B}Escaneie o QR no WhatsApp${Z}  (Aparelhos conectados > Conectar aparelho)\n`)
    qrcode.generate(st.qr, { small: true })
    const idade = st.qrEm ? Math.floor((Date.now() - st.qrEm) / 1000) : null
    if (idade !== null) console.log(`${D}QR gerado há ${idade}s (ele expira e é renovado automaticamente — reabra esta tela pra pegar o novo).${Z}`)
  } else {
    console.log(`${Y}Nenhum QR disponível ainda.${Z}`)
    console.log('O bot gera o QR quando está rodando e desconectado.')
    console.log(`Verifique se o serviço está rodando (estado: ${runtime.statusServico()}).`)
    console.log('Se acabou de subir, aguarde alguns segundos e reabra esta tela.')
  }
  await pausar()
}

// Solicita ao bot: logout + limpar sessão + reiniciar pra novo login.
async function apagarDadosNumero () {
  console.log(`\n${R}Isto desconecta o WhatsApp, apaga a sessão salva e reinicia o bot.${Z}`)
  console.log('Você vai precisar escanear o QR / parear o número de novo.')
  if (!await confirmar('Continuar?')) { console.log('Cancelado.'); return }
  try {
    fs.writeFileSync(path.join(PASTA_DADOS, 'logout.request'), String(Date.now()))
  } catch (e) { console.log(`${R}Falha ao solicitar: ${e.message}${Z}`); return }
  const rt = runtime.lerRuntime()
  console.log(`${G}Solicitado.${Z} O bot vai limpar a sessão e reiniciar em alguns segundos.`)
  if (rt.mode === 'docker') console.log('Acompanhe o novo login em:  docker logs -f LCNWhatsApp')
  else console.log('Acompanhe o novo login no terminal onde o bot roda (ou: pm2 logs LCNWhatsApp).')
}

// ————— Atualizar —————
// `lcn` em modo docker roda DENTRO do container (bin/lcn faz `docker exec`);
// dali não dá pra reconstruir a própria imagem — o container não enxerga o
// Docker/Podman do host. Detecta isso (marcador do container + LCN_MODE) pra
// avisar em vez de tentar (e falhar) o rebuild de dentro.
function dentroDeContainer () {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv') || process.env.LCN_MODE === 'docker'
}

async function telaAtualizar () {
  cabecalho()
  console.log(`${B}Atualizar sistema${Z}\n`)
  const rt = runtime.lerRuntime()
  if (rt.mode === 'docker' && dentroDeContainer()) {
    console.log(`${Y}Este painel está rodando DENTRO do container${Z} — daqui não dá pra`)
    console.log(`reconstruir a própria imagem (sem acesso ao Docker/Podman do host).\n`)
    console.log('Rode a atualização no HOST (fora do container), na pasta do projeto:')
    console.log(`  ${B}sh update.sh${Z}`)
    return pausar()
  }
  console.log('Isto roda o script de atualização (git pull + rebuild/npm install + restart).')
  if (!await confirmar('Continuar?')) return
  const r = spawnSync('sh', ['./update.sh'], { cwd: process.cwd(), encoding: 'utf8' })
  console.log(r.stdout || '')
  if (r.stderr) console.log(`${Y}${r.stderr}${Z}`)
  await pausar()
}

menuPrincipal().catch((e) => { console.error(e); rl.close() })
