// Conexões que já vêm declaradas — e que são EDITÁVEIS como qualquer outra.
//
// O dono pediu "as duas: prontas e customizáveis". A razão de existirem prontas
// não é conveniência: é que elas são o exemplo de como se declara uma. Quem
// quiser ligar uma IA abre a do download, vê a forma, e escreve a sua.
//
// O que está aqui hoje é EXATAMENTE o protocolo que vive fixo dentro de
// src/downloader.js:
//
//   POST {endereço}/download   {url, modo}     -> { job }
//   GET  {endereço}/jobs/{job}                 -> { estado, midias[], descricao, erro }
//   estados "na_fila" e "baixando" significam "ainda não acabou"
//
// Trazer isso para cá é a diferença entre o dono PODER trocar o serviço de
// download e ter que me pedir.
import { FORMAS_DE_RESPOSTA } from './declaracao.js'

// O acompanhamento de trabalho, declarado uma vez: as duas funções de download
// compartilham o mesmo protocolo, e repetir o bloco convidaria as duas a
// divergirem no dia em que uma fosse ajustada.
const TRABALHO_DE_DOWNLOAD = Object.freeze({
  forma: FORMAS_DE_RESPOSTA.trabalho,
  campoDoTrabalho: 'job',
  caminhoDeAcompanhamento: '/jobs/{job}',
  campoDoEstado: 'estado',
  estadosEmAndamento: ['na_fila', 'baixando'],
  campoDoResultado: 'midias',
  campoDoErro: 'erro'
})

export const CONEXOES_PRONTAS = Object.freeze([
  {
    id: 'midia',
    kind: 'http',
    titulo: 'Serviço de download de mídia',
    descricao: 'Baixa vídeo, áudio e foto de link de rede social. É o serviço que o /dow e o download automático usam.',
    config: {
      // Loopback por padrão: o serviço baixa URL arbitrária e devolve o
      // arquivo, então em endereço de rede ele viraria um proxy de download
      // aberto. Quem quiser expor precisa dizer isso de propósito.
      endereco: 'http://127.0.0.1:8765',
      // É como o downloader autentica hoje: Authorization: Bearer <token>.
      autenticacao: { tipo: 'bearer' },
      funcoes: [
        {
          nome: 'baixar',
          descricao: 'Baixa a mídia de um link e devolve os arquivos.',
          metodo: 'POST',
          caminho: '/download',
          entradas: [
            { nome: 'url', tipo: 'texto', obrigatoria: true },
            { nome: 'modo', tipo: 'opção', opcoes: ['auto', 'video', 'audio', 'thumbnail'], obrigatoria: false, padrao: 'auto' }
          ],
          resposta: TRABALHO_DE_DOWNLOAD
        }
      ]
    }
  }
])

export function conexaoProntaPorId (id) {
  return CONEXOES_PRONTAS.find((c) => c.id === id) || null
}
