import { ErroHttp } from '../transport.js'
import { criarServicoDePerfis } from '../aplicacaoDePerfil.js'
import { lerPolitica, LIMITE_DO_ARQUIVO } from '../perfilDeProvisionamento.js'
import { lerArquivoRegular } from '../../arquivoSeguro.js'

// A política é lida a CADA aplicação, não no boot do motor: o operador pode
// corrigi-la sem reiniciar. Falhar ao lê-la recusa a aplicação (falha fechada)
// — ignorar uma política ilegível seria deixar passar justamente o que ela
// existe para barrar — mas não derruba o motor, que continua servindo o resto.
function leitorDePolitica (env) {
  return () => {
    const caminho = env.LCN_PROVISION_POLICY
    if (!caminho) return null
    try {
      return lerPolitica(lerArquivoRegular(caminho, LIMITE_DO_ARQUIVO))
    } catch (erro) {
      // Problema do AMBIENTE (arquivo ausente, ilegível, ainda não montado),
      // não do perfil: não gasta o registro do perfil. Marcado `semRegistro`
      // para que, corrigido o caminho, o próximo reinício aplique em vez de
      // pular um perfil dado como bloqueado.
      const falha = erro instanceof ErroHttp ? erro : new ErroHttp(409, `A política de provisionamento não pôde ser lida: ${erro.message} O perfil não foi aplicado.`)
      falha.semRegistro = true
      throw falha
    }
  }
}

const opcoesDoCorpo = (body) => ({ reconcile: body?.reconcile === true, retry: body?.retry === true })

function exigirPerfil (body) {
  if (!body || body.perfil == null) throw new ErroHttp(400, 'Campo obrigatório: perfil.')
  return body.perfil
}

export function registrarRotasPerfis (roteador, db, { provisionamento, env }) {
  const servico = criarServicoDePerfis(db, { provisionamento, politica: leitorDePolitica(env) })
  roteador.get('/perfis/estado', () => servico.estado())
  roteador.post('/perfis/validar', ({ body }) => servico.validar(exigirPerfil(body), opcoesDoCorpo(body)))
  roteador.post('/perfis/aplicar', ({ body }) => servico.aplicar(exigirPerfil(body), opcoesDoCorpo(body)))
}
