// Carga, validação, salvamento e observação (hot-reload) do config.json.
import fs from 'fs'
import { ARQ_CONFIG, ARQ_CONFIG_EXEMPLO } from './paths.js'

// Config padrão — usado quando falta o arquivo ou faltam chaves nele.
export const PADRAO = {
  destino: { tipo: 'self', jid: '' },
  captura: {
    contatos: 'todos',
    blocklist: [],
    grupos: { ativo: false, allowlist: [] },
    destinoProprioContatos: [],
    downloadAutomatico: { conversas: [] }
  },
  hardware: {
    markOnline: true,
    logLevel: 'silent',
    maxMidiaMB: 60,
    downloadConcorrencia: 2,
    bandwidthLimit: {
      downloadBytesPerSecond: 0,
      uploadBytesPerSecond: 0
    },
    modoEconomia: true,
    debug: false,
    // Como a conexão aparece em "Aparelhos conectados" no celular. Só rótulo e
    // ícone — não muda o que a conexão é. Gravado no pareamento: trocar depois
    // não renomeia sessão existente. Ver src/aparelho.js para a lista.
    aparelho: { navegador: 'chrome', sistema: '' }
  },
  transcricao: {
    provedor: 'off',
    modelo: 'base',
    idioma: 'pt',
    pythonBin: '',
    openaiApiKey: '',
    openaiModelo: 'whisper-1',
    comando: '',
    comandoTerceiros: false,
    conversas: []
  },
  atualizacao: { autoUpdateLib: false, falhasParaUpdate: 5 },
  // Limiar bem mais alto que atualizacao.falhasParaUpdate de propósito:
  // "marcar pra atualizar" é um sinal leve, quarentena é a última instância
  // (para de tentar reconectar sozinho) — não fazem sentido no mesmo limiar.
  confiabilidade: { falhasConsecutivasParaQuarentena: 15 },
  outputApi: { enabled: false, host: '127.0.0.1', porta: 8787, token: '' },
  // Serviço externo que baixa mídia de link (YouTube, TikTok, Instagram…).
  //
  // O token fica num ARQUIVO, não aqui: assim ele não passa pelo painel, não
  // entra em backup de configuração por acidente e continua com a permissão
  // que o dono deu a ele no disco. `tokenArquivo` aceita ~ no começo.
  //
  // `limiteMB` é o teto do que vale a pena reenviar pelo WhatsApp — a API
  // aceita arquivos muito maiores do que o WhatsApp entrega.
  download: {
    api: '',
    tokenArquivo: '',
    modoPadrao: 'auto',
    limiteMB: 64,
    esperaMaximaSegundos: 300
  }
}

// Junta o padrão com o config do usuário, sem sobrescrever objeto por primitivo.
function mesclar (base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base
  if (base && typeof base === 'object') {
    const saida = { ...base }
    if (extra && typeof extra === 'object') {
      for (const k of Object.keys(extra)) saida[k] = mesclar(base[k], extra[k])
    }
    return saida
  }
  return extra === undefined ? base : extra
}

// Migração: o provedor "codex" (e o campo codexModelo) foram removidos do
// LCNWhatsApp. Config antigo com transcricao.provedor === 'codex' vira "off"
// automaticamente, com um aviso curto — sem apagar o resto da configuração.
// O nome da chave ficou para trás na migração de biblioteca.
//
// A funcionalidade NÃO é resto de Baileys: ela sinaliza "muitas quedas seguidas,
// pode ser mudança de protocolo do WhatsApp, atualize a biblioteca" — e vale
// igual para a zapo-js. O código já lê `autoUpdateLib`; só a chave no arquivo de
// quem instalou antes continuava com o nome antigo.
//
// E isso não era cosmético: quem tinha `autoUpdateBaileys` no config.json estava
// ligando uma chave que o código não lê. A pessoa marcava "ligado" e a
// funcionalidade seguia desligada, sem nada avisando — a mesma família do painel
// dizendo "Conectado" para um bot que não está rodando.
//
// Migra PRESERVANDO o valor: quem tinha ligado continua ligado, e agora de
// verdade.
// RODA NO ARQUIVO CRU, antes da mesclagem com o padrão — e isso não é detalhe.
//
// Depois de `mesclar(PADRAO, bruto)` a chave `autoUpdateLib` SEMPRE existe, com
// o `false` do padrão. Rodando depois, "o novo já existe, não sobrescrevo"
// descartava o valor do usuário e a migração não fazia nada, em silêncio —
// exatamente o defeito que ela existe para consertar. Um teste pegou.
function migrarNomeDoAutoUpdate (bruto) {
  const a = bruto?.atualizacao
  if (!a || typeof a !== 'object' || !('autoUpdateBaileys' in a)) return false
  // Com os dois no arquivo do usuário, o nome NOVO ganha: é o que o código lê,
  // então é o que reflete o que está valendo hoje.
  if (!('autoUpdateLib' in a)) a.autoUpdateLib = a.autoUpdateBaileys === true
  delete a.autoUpdateBaileys
  console.warn('config.json: "atualizacao.autoUpdateBaileys" virou "autoUpdateLib" (a biblioteca é a zapo-js desde a migração). Valor preservado.')
  return true
}

function migrarCodex (cfg) {
  const t = cfg.transcricao
  if (!t) return false
  let alterado = false
  if (t.provedor === 'codex') {
    console.warn('config.json: provedor de transcrição "codex" foi removido — migrado para "off". Reconfigure em lcn > Configurações > Transcrição, se quiser.')
    t.provedor = 'off'
    alterado = true
  }
  if ('codexModelo' in t) {
    delete t.codexModelo
    alterado = true
  }
  return alterado
}

export function carregar () {
  let bruto = {}
  try {
    if (fs.existsSync(ARQ_CONFIG)) {
      bruto = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'))
    }
  } catch (e) {
    console.error('config.json inválido, usando padrão:', e.message)
  }
  // Antes de mesclar: ver o comentário de migrarNomeDoAutoUpdate.
  const renomeou = migrarNomeDoAutoUpdate(bruto)
  const cfg = mesclar(PADRAO, bruto)
  if (migrarCodex(cfg) || renomeou) {
    try { fs.writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2) + '\n') } catch {}
  }
  return cfg
}

export function salvar (cfg) {
  const completo = mesclar(PADRAO, cfg)
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify(completo, null, 2) + '\n')
  return completo
}

// Cria config.json a partir do exemplo/padrão se ainda não existir.
export function garantirConfig () {
  if (fs.existsSync(ARQ_CONFIG)) return carregar()
  let inicial = PADRAO
  try {
    if (fs.existsSync(ARQ_CONFIG_EXEMPLO)) {
      inicial = mesclar(PADRAO, JSON.parse(fs.readFileSync(ARQ_CONFIG_EXEMPLO, 'utf8')))
    }
  } catch {}
  return salvar(inicial)
}

// Observa o arquivo e chama onChange(novoConfig) quando muda (debounce simples).
// Só dispara se o arquivo for lido e parseado com sucesso — evita reagir a uma
// leitura parcial durante a escrita (que causava reconexões espúrias).
export function observar (onChange) {
  let timer = null
  try {
    fs.watch(ARQ_CONFIG, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        let bruto
        try {
          bruto = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'))
        } catch {
          return // escrita ainda em andamento / JSON inválido — ignora este evento
        }
        // Mesma ordem da carga: renomear ANTES de mesclar, senão o padrão
        // já preencheu a chave nova e o valor do usuário se perde.
        const renomeou = migrarNomeDoAutoUpdate(bruto)
        const cfg = mesclar(PADRAO, bruto)
        if (migrarCodex(cfg) || renomeou) {
          try { fs.writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2) + '\n') } catch {}
        }
        try { onChange(cfg) } catch (e) { console.error('reload config:', e.message) }
      }, 400)
    })
  } catch {
    // fs.watch pode não existir em alguns FS montados; ignora silenciosamente.
  }
}
