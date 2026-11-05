// Aplica um perfil de provisionamento ao motor: decide SE aplica (estado
// gravado), aplica TUDO numa transação só, e registra o resultado.
//
// ATOMICIDADE REAL: a criação dos pools do perfil e cada escolha de
// `provisionar` rodam dentro de UMA `db.transaction`; as de `provisionar` são
// aninhadas e viram savepoints. Se a última escolha falha, nem os pools nem as
// primeiras escolhas ficam. Criar os pools por `POST /pools` antes deixaria
// pool órfão em caso de rollback — e a "atomicidade" seria falsa.
//
// `validar` roda este MESMO caminho e desfaz no fim: o plano e os erros são os
// que a aplicação teria, não uma simulação paralela que pode divergir dela.
import { ErroHttp } from './transport.js'
import {
  lerPerfil, validarContraCatalogo, escolhasDoPerfil, aplicarPolitica
} from './perfilDeProvisionamento.js'

const RESUMO_MAXIMO = 500

class DesfazerPlano extends Error {
  constructor (resultado) { super('plano'); this.resultado = resultado }
}

// A conduta de cada falha é diferente, e o registro precisa dizer qual: o que
// é erro do PERFIL não adianta repetir a cada reinício; o que é erro do MOTOR
// merece nova tentativa.
export function classificarFalha (erro) {
  if (erro instanceof ErroHttp) {
    if (erro.status === 409 && erro.detalhes?.itens) return 'needs_operator'
    if (erro.status >= 400 && erro.status < 500) return 'blocked'
  }
  return 'transient_failure'
}

export function criarServicoDePerfis (db, { provisionamento, politica = () => null, agora = () => new Date().toISOString() }) {
  const { catalogo, pacotes, provisionar } = provisionamento
  const lerLinhas = db.prepare('SELECT * FROM provisioning_profile_applications WHERE profile_id = ? ORDER BY profile_version DESC')
  const lerTodas = db.prepare('SELECT * FROM provisioning_profile_applications ORDER BY profile_id, profile_version')
  const gravar = db.prepare(`INSERT INTO provisioning_profile_applications
    (profile_id, profile_version, content_hash, status, applied_at, last_attempt_at, error_code, error_summary)
    VALUES (@id, @versao, @hash, @status, @aplicadoEm, @tentadoEm, @codigo, @resumo)
    ON CONFLICT(profile_id, profile_version) DO UPDATE SET
      content_hash = excluded.content_hash, status = excluded.status, applied_at = excluded.applied_at,
      last_attempt_at = excluded.last_attempt_at, error_code = excluded.error_code, error_summary = excluded.error_summary`)
  const poolExiste = db.prepare('SELECT 1 FROM pools WHERE id = ?')
  const criarPool = db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)')

  const expor = (linha) => ({
    profileId: linha.profile_id,
    profileVersion: linha.profile_version,
    hash: linha.content_hash,
    status: linha.status,
    appliedAt: linha.applied_at,
    lastAttemptAt: linha.last_attempt_at,
    errorCode: linha.error_code,
    errorSummary: linha.error_summary
  })

  // Devolve o que fazer com este perfil. Lança só quando o perfil contradiz o
  // que já foi aplicado com o mesmo número de versão.
  function decidir ({ perfil, hash }, { reconcile = false, retry = false } = {}) {
    const linhas = lerLinhas.all(perfil.profileId)
    const mesma = linhas.find((l) => l.profile_version === perfil.profileVersion)
    if (mesma) {
      if (mesma.content_hash !== hash) {
        const erro = new ErroHttp(409, `O perfil "${perfil.profileId}" versão ${perfil.profileVersion} já foi registrado com outro conteúdo. Mudou o perfil? Suba o profileVersion.`)
        erro.imutabilidade = true
        throw erro
      }
      if (mesma.status === 'applied') return { acao: 'ja-aplicado' }
      if (mesma.status === 'transient_failure' || retry) return { acao: 'aplicar' }
      return { acao: 'bloqueado', estado: expor(mesma) }
    }
    if (linhas.some((l) => l.status === 'applied' && l.profile_version > perfil.profileVersion)) {
      return { acao: 'versao-antiga' }
    }
    const anterior = linhas.find((l) => l.status === 'applied')
    if (anterior && !reconcile) return { acao: 'versao-nova-pendente', versaoAplicada: anterior.profile_version }
    return { acao: 'aplicar' }
  }

  function resumir (r) {
    return {
      kind: r.kind,
      packageId: r.packageId,
      installationId: r.installationId,
      jaExistia: r.jaExistia,
      instaladas: r.installed.map((a) => a.id),
      restauradas: r.restored.map((a) => a.id),
      jaInstaladas: r.alreadyInstalled.map((a) => a.automationId),
      avisos: r.avisos.map((a) => ({ codigo: a.codigo, automationId: a.automationId }))
    }
  }

  function executar (perfil, { desfazer }) {
    const transacao = db.transaction(() => {
      const poolsCriados = []
      for (const pool of perfil.pools) {
        if (poolExiste.get(pool.id)) continue
        const instante = agora()
        criarPool.run(pool.id, pool.label, instante, instante)
        poolsCriados.push(pool.id)
      }
      const escolhas = escolhasDoPerfil(perfil).map((escolha) => resumir(provisionar(escolha)))
      const resultado = { poolsCriados, escolhas }
      if (desfazer) throw new DesfazerPlano(resultado)
      return resultado
    })
    try {
      return transacao()
    } catch (erro) {
      if (erro instanceof DesfazerPlano) return erro.resultado
      throw erro
    }
  }

  function preparar (entrada) {
    const lido = lerPerfil(entrada)
    validarContraCatalogo(lido.perfil, { catalogo, pacotes })
    return lido
  }

  const identidade = ({ perfil, hash }) => ({ profileId: perfil.profileId, profileVersion: perfil.profileVersion, hash })

  return {
    estado: () => ({ aplicacoes: lerTodas.all().map(expor) }),

    // Não grava estado nenhum: serve para o operador ver o plano e os erros
    // ANTES de subir o container.
    validar (entrada, opcoes = {}) {
      const lido = preparar(entrada)
      aplicarPolitica(lido.perfil, politica())
      const decisao = decidir(lido, opcoes)
      const base = { ...identidade(lido), ...decisao }
      if (decisao.acao !== 'aplicar') return base
      return { ...base, ...executar(lido.perfil, { desfazer: true }), simulado: true }
    },

    aplicar (entrada, opcoes = {}) {
      const lido = preparar(entrada)
      const registrar = (status, erro) => gravar.run({
        id: lido.perfil.profileId,
        versao: lido.perfil.profileVersion,
        hash: lido.hash,
        status,
        aplicadoEm: status === 'applied' ? agora() : null,
        tentadoEm: agora(),
        codigo: erro ? (erro.status ? `http_${erro.status}` : (erro.code || 'erro_interno')) : null,
        resumo: erro ? String(erro.message).slice(0, RESUMO_MAXIMO) : null
      })
      try {
        aplicarPolitica(lido.perfil, politica())
        const decisao = decidir(lido, opcoes)
        if (decisao.acao !== 'aplicar') return { ...identidade(lido), ...decisao }
        const resultado = executar(lido.perfil, { desfazer: false })
        registrar('applied')
        return { ...identidade(lido), acao: 'aplicado', ...resultado }
      } catch (erro) {
        // A imutabilidade não é falha DESTA tentativa: gravá-la por cima
        // apagaria o registro do que foi aplicado de verdade.
        if (!erro.imutabilidade) registrar(classificarFalha(erro), erro)
        throw erro
      }
    }
  }
}
