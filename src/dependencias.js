// Programas EXTERNOS de que o bot depende — os que não fazem parte do LCN.
//
// POR QUE ISTO EXISTE. O dono leu o comando de figurinha e perguntou por que
// ele não aparecia como conexão, "sendo que é um comando que depende de um
// sistema externo". A conexão é outra coisa (endereço HTTP, credencial, função
// declarada), mas a observação por baixo estava certa: o ffmpeg é dependência
// de fora, e a única coisa que o sistema dizia sobre ela era uma linha de aviso
// no template. Se ele sumir da máquina, descobre-se quando alguém reclamar que
// a figurinha parou.
//
// Aqui a dependência vira estado observável, do mesmo jeito que a credencial de
// uma conexão já reporta "resolve / não resolve" sem devolver o valor.
import { spawn } from 'child_process'

const TIMEOUT_MS = 5000
// Lembrar o resultado evita rodar um processo por carregada de página, e 60 s é
// curto o bastante para alguém instalar o programa e ver a mudança sem
// reiniciar nada.
const VALIDADE_MS = 60000

export const DEPENDENCIAS = Object.freeze([
  Object.freeze({
    nome: 'ffmpeg',
    programa: 'ffmpeg',
    argumentos: ['-version'],
    usadoPor: 'Figurinha (/fig)',
    // Nenhuma é obrigatória para o bot subir, e isso é projeto: faltar ffmpeg
    // tira UM comando, não o sistema. Prometer menos do que isso faria a tela
    // assustar quem nunca vai usar figurinha.
    semEla: 'O comando de figurinha responde com erro explicando; todo o resto continua funcionando.',
    comoInstalar: 'Debian/Ubuntu: sudo apt install ffmpeg · Alpine: apk add ffmpeg · macOS: brew install ffmpeg'
  })
])

// `ffmpeg -version` começa com "ffmpeg version 6.1.1-3ubuntu5 Copyright...".
// Só a palavra depois de "version" interessa; o resto é aviso de copyright e
// lista de flags de compilação.
export function extrairVersao (saida) {
  const primeira = String(saida || '').split('\n')[0] || ''
  const m = primeira.match(/version\s+(\S+)/i)
  return m ? m[1] : (primeira.trim() || null)
}

function rodar (programa, argumentos) {
  return new Promise((resolve) => {
    let processo
    try {
      processo = spawn(programa, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ ok: false, motivo: e.message })
    }
    let saida = ''
    const juntar = (parte) => { saida += parte.toString() }
    processo.stdout?.on('data', juntar)
    processo.stderr?.on('data', juntar)

    const relogio = setTimeout(() => {
      processo.kill('SIGKILL')
      resolve({ ok: false, motivo: 'o programa não respondeu a tempo' })
    }, TIMEOUT_MS)

    processo.on('error', (e) => {
      clearTimeout(relogio)
      resolve({
        ok: false,
        motivo: e?.code === 'ENOENT' ? 'não está instalado nesta máquina' : e.message
      })
    })
    processo.on('close', (codigo) => {
      clearTimeout(relogio)
      // Saída diferente de zero com texto ainda conta como presente: o
      // programa existe e respondeu. "Não instalado" é o ENOENT acima, e
      // misturar os dois faria uma versão estranha virar "sumiu".
      resolve(codigo === 0 || saida.trim()
        ? { ok: true, saida }
        : { ok: false, motivo: `o programa respondeu com código ${codigo}` })
    })
  })
}

let cache = null

export async function verificarDependencias ({ agora = Date.now, forcar = false } = {}) {
  const momento = agora()
  if (!forcar && cache && momento - cache.em < VALIDADE_MS) return cache.lista

  const lista = await Promise.all(DEPENDENCIAS.map(async (dep) => {
    const r = await rodar(dep.programa, dep.argumentos)
    return {
      nome: dep.nome,
      usadoPor: dep.usadoPor,
      semEla: dep.semEla,
      comoInstalar: dep.comoInstalar,
      presente: r.ok,
      versao: r.ok ? extrairVersao(r.saida) : null,
      motivo: r.ok ? null : r.motivo
    }
  }))
  cache = { em: momento, lista }
  return lista
}

export function _limparCacheParaTeste () { cache = null }
