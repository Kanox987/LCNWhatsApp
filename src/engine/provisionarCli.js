// `lcn engine provisionar`: lê o perfil do disco e pede ao MOTOR que o valide
// ou aplique. A CLI é só cliente — nunca abre o SQLite — e por isso a regra de
// "o que fazer com este perfil" mora no motor, num lugar só.
//
// Código de saída: 0 quando o perfil está no ar ou nada havia a fazer; ≠ 0 quando
// ele foi recusado, está bloqueado ou o motor falhou. Quem sobe o container
// decide o que fazer com o código (o boot só registra, não derruba nada).
import { lerArquivoRegular } from './arquivoSeguro.js'
import { LIMITE_DO_ARQUIVO } from './server/perfilDeProvisionamento.js'

const ESPERA_ENTRE_TENTATIVAS_MS = 500

export function lerOpcoes (argv) {
  const opcoes = { perfil: null, check: false, reconcile: false, retry: false, aguardar: 0 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') opcoes.check = true
    else if (a === '--reconcile') opcoes.reconcile = true
    else if (a === '--retry') opcoes.retry = true
    else if (a === '--perfil' || a === '--aguardar') {
      const valor = argv[++i]
      if (valor === undefined) throw new Error(`${a} precisa de um valor.`)
      if (a === '--perfil') opcoes.perfil = valor
      else {
        const segundos = Number(valor)
        if (!Number.isFinite(segundos) || segundos < 0) throw new Error('--aguardar precisa de um número de segundos.')
        opcoes.aguardar = segundos
      }
    } else throw new Error(`Opção desconhecida: ${a}`)
  }
  if (!opcoes.perfil) throw new Error('Informe o perfil: --perfil <arquivo.json>.')
  return opcoes
}

// O socket aparece antes de o motor responder. Quem sobe o container precisa
// de /health, não só do arquivo do socket.
async function esperarMotor (cliente, segundos, dormir) {
  const limite = Date.now() + segundos * 1000
  for (;;) {
    try { return await cliente.saude() } catch (erro) {
      if (Date.now() >= limite) throw erro
      await dormir(ESPERA_ENTRE_TENTATIVAS_MS)
    }
  }
}

function descreverResultado (r, log) {
  const rotulo = `${r.profileId} v${r.profileVersion}`
  if (r.acao === 'ja-aplicado') return log(`Perfil ${rotulo}: já aplicado, nada a fazer.`)
  if (r.acao === 'versao-antiga') return log(`Perfil ${rotulo}: já existe uma versão mais nova aplicada; ignorado.`)
  if (r.acao === 'versao-nova-pendente') {
    return log(`Perfil ${rotulo}: a versão ${r.versaoAplicada} está aplicada; use --reconcile para aplicar esta.`)
  }
  if (r.acao === 'bloqueado') {
    return log(`Perfil ${rotulo}: bloqueado (${r.estado.status}: ${r.estado.errorSummary ?? 'sem detalhe'}). Corrija o perfil ou use --retry.`)
  }
  const verbo = r.simulado ? 'Plano (nada foi gravado)' : 'Aplicado'
  log(`${verbo}: ${rotulo}`)
  if (r.poolsCriados.length) log(`  pools criados: ${r.poolsCriados.join(', ')}`)
  for (const e of r.escolhas) {
    const alvo = e.packageId ? `pacote ${e.packageId}` : e.kind
    log(`  ${alvo}: ${e.instaladas.length} instalada(s), ${e.restauradas.length} restaurada(s), ${e.jaInstaladas.length} já estava(m)`)
    for (const aviso of e.avisos) log(`    aviso ${aviso.codigo}${aviso.automationId ? ` (${aviso.automationId})` : ''}`)
  }
}

export async function executarProvisionar (argv, { cliente, log = console.log, erro = console.error, dormir = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let opcoes
  let texto
  try {
    opcoes = lerOpcoes(argv)
    texto = lerArquivoRegular(opcoes.perfil, LIMITE_DO_ARQUIVO)
  } catch (e) {
    erro(`Erro: ${e.message}`)
    return 2
  }
  let perfil
  try { perfil = JSON.parse(texto) } catch (e) {
    erro(`Erro: o perfil não é JSON válido: ${e.message}`)
    return 2
  }
  try {
    if (opcoes.aguardar > 0) await esperarMotor(cliente, opcoes.aguardar, dormir)
    const pedido = { reconcile: opcoes.reconcile, retry: opcoes.retry }
    const resultado = opcoes.check
      ? await cliente.perfis.validar(perfil, pedido)
      : await cliente.perfis.aplicar(perfil, pedido)
    descreverResultado(resultado, log)
    return resultado.acao === 'bloqueado' ? 3 : 0
  } catch (e) {
    erro(`Erro: ${e.message}`)
    for (const item of e.details?.erros ?? []) erro(`  - ${item}`)
    return e.status && e.status < 500 ? 3 : 1
  }
}
