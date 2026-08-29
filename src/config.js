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
    destinoProprioContatos: []
  },
  hardware: {
    markOnline: true,
    logLevel: 'silent',
    maxMidiaMB: 60,
    downloadConcorrencia: 2,
    modoEconomia: true,
    debug: false,
    placeholderResend: false
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
  atualizacao: { autoUpdateBaileys: false, falhasParaUpdate: 5 },
  outputApi: { enabled: false, host: '127.0.0.1', porta: 8787, token: '' }
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
  const cfg = mesclar(PADRAO, bruto)
  if (migrarCodex(cfg)) {
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
        const cfg = mesclar(PADRAO, bruto)
        if (migrarCodex(cfg)) {
          try { fs.writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2) + '\n') } catch {}
        }
        try { onChange(cfg) } catch (e) { console.error('reload config:', e.message) }
      }, 400)
    })
  } catch {
    // fs.watch pode não existir em alguns FS montados; ignora silenciosamente.
  }
}
