import { concessoesDoProcesso } from './agent/concessoes.js'

const MB = 1024 * 1024

function emBytes (valor, padraoMB) {
  const n = Number(valor)
  const bytes = Math.floor(n * MB)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : padraoMB * MB
}

// A concessão é TETO, nunca piso: ela só pode BAIXAR o que a pessoa escolheu.
// O fallback é o deste arquivo (64 MB), não o `padrao` de `src/agent/concessoes.js`
// — passar por `valorEfetivo` aqui substituiria valor ausente OU inválido pelo
// padrão do código (60), e um padrão que ninguém escolheu cortaria o
// `download.limiteMB` que a pessoa escolheu. Dois testes pegam isso:
// `tests/downloader.test.mjs:113` e a tabela de precedência em
// `tests/memoria-runtime.test.mjs`.
function limiteEmBytes (bruto, concedido, padraoMB) {
  const escolhido = emBytes(bruto, padraoMB)
  const teto = concedido === undefined ? Infinity : emBytes(concedido, padraoMB)
  return Math.min(escolhido, teto)
}

// `concessoes` entra como argumento, com o teto do processo como padrão: a
// função continua PURA para quem passa o mapa (a bateria), e obedece o teto do
// administrador para quem só passa a config (o runtime).
//
// O limite vale aqui, na LEITURA, e não só na gravação pelo painel. Config
// editado à mão, configuração importada ou arquivo trocado por fora passam por
// este ponto do mesmo jeito. Ver src/agent/concessoes.js.
export function limitesDeMidia (cfg, concessoes = concessoesDoProcesso()) {
  // Ausente continua protegido, e o limite específico não pode furar o geral.
  const geral = limiteEmBytes(cfg?.hardware?.maxMidiaMB, concessoes['hardware.maxMidiaMB'], 64)
  return {
    geral,
    downloadConcorrencia: Number.isSafeInteger(cfg?.hardware?.downloadConcorrencia) && cfg.hardware.downloadConcorrencia > 0
      ? cfg.hardware.downloadConcorrencia : 2,
    download: Math.min(geral, limiteEmBytes(cfg?.download?.limiteMB, concessoes['download.limiteMB'], 64)),
    // O álbum fica vivo até a entrega: limitar cada arquivo não limita a
    // soma. Este padrão pode ser trocado em hardware.orcamentoMidiaMB.
    orcamento: emBytes(cfg?.hardware?.orcamentoMidiaMB, 256)
  }
}
