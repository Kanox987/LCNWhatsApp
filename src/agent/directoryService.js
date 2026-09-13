// Módulo 3 da Etapa 4.5 — busca de contato/grupo por instância, pro seletor
// de escopo do painel web (lacuna apontada na consulta de arquitetura do
// plano: hoje `src/directory.js` só lê o diretório da instância ATUAL
// via src/paths.js — o agente precisa ler o diretório de QUALQUER instância
// dado seu dataDir, por isso não reaproveita aquele módulo diretamente).
//
// Achado importante (mesma classe do bug de chat.id em zapoAdapter.js): o
// diretório grava contatos como dígitos crus (`numero`, via soDigitos()),
// mas o avaliador de automações compara `scope.include[].id` contra a forma
// JID canônica (`5511999@s.whatsapp.net`). Devolver o dígito cru aqui faria
// o painel montar um scope que nunca bate — por isso todo item de contato
// já sai daqui na forma canônica.
import fs from 'fs'
import path from 'path'
import { buscarPorId, lerRegistro } from '../instances/registry.js'
import { ARQ_CONTATOS as ARQ_CONTATOS_BARE, ARQ_GRUPOS as ARQ_GRUPOS_BARE } from '../paths.js'
import { idValido, validarAlvoGerenciado, InstanciaNaoEncontradaError, ID_BARE } from './instanceService.js'

function lerListaJson (arquivo) {
  try {
    if (!fs.existsSync(arquivo)) return []
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    return Array.isArray(dados) ? dados : []
  } catch {
    return []
  }
}

function paginar (itens, { cursor, limit = 50 } = {}) {
  const limite = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50
  const inicio = cursor ? Number(cursor) : 0
  const pagina = Number.isInteger(inicio) && inicio >= 0 ? itens.slice(inicio, inicio + limite) : itens.slice(0, limite)
  const proximo = inicio + limite < itens.length ? String(inicio + limite) : null
  return { items: pagina, nextCursor: proximo }
}

function filtrarPorTexto (itens, campo, q) {
  if (!q) return itens
  const alvo = q.trim().toLowerCase()
  if (!alvo) return itens
  return itens.filter((item) => String(item[campo] || '').toLowerCase().includes(alvo))
}

// `obterRegistro`/`caminhoInstanciaFn`/`nomeContainerFn` injetáveis pelo
// mesmo motivo de instanceService.js: nunca tocar o registry.json real do
// usuário nem exigir o caminho XDG real durante um teste automatizado.
// `bareArqContatos`/`bareArqGrupos` pelo mesmo motivo: nunca ler o
// data/contatos.json ou data/grupos.json REAIS deste checkout num teste.
export function criarDirectoryService ({
  obterRegistro = lerRegistro,
  caminhoInstanciaFn,
  nomeContainerFn,
  bareArqContatos = ARQ_CONTATOS_BARE,
  bareArqGrupos = ARQ_GRUPOS_BARE
} = {}) {
  function exigirInstancia (id) {
    if (id === ID_BARE) return { instanceId: ID_BARE, isBare: true }
    // Ver instanceService.js (idValido/validarAlvoGerenciado) — id="__proto__"
    // resolveria pra Object.prototype num lookup cru `registro.instances[id]`,
    // e um registro adulterado poderia apontar dataDir pra outro diretório.
    if (!idValido(id)) throw new InstanciaNaoEncontradaError(id)
    const instancia = buscarPorId(obterRegistro(), id)
    if (!instancia) throw new InstanciaNaoEncontradaError(id)
    validarAlvoGerenciado(instancia, { caminhoInstanciaFn, nomeContainerFn })
    return instancia
  }

  function caminhoContatos (instancia) {
    return instancia.isBare ? bareArqContatos : path.join(instancia.dataDir, 'data', 'contatos.json')
  }

  function caminhoGrupos (instancia) {
    return instancia.isBare ? bareArqGrupos : path.join(instancia.dataDir, 'data', 'grupos.json')
  }

  function listarContatos (instanciaId, { q, cursor, limit } = {}) {
    const instancia = exigirInstancia(instanciaId)
    const bruto = lerListaJson(caminhoContatos(instancia))
    const itens = bruto.map((c) => ({
      kind: 'contact',
      id: `${c.numero}@s.whatsapp.net`,
      label: c.nome || c.numero
    }))
    return paginar(filtrarPorTexto(itens, 'label', q), { cursor, limit })
  }

  function listarGrupos (instanciaId, { q, cursor, limit } = {}) {
    const instancia = exigirInstancia(instanciaId)
    const bruto = lerListaJson(caminhoGrupos(instancia))
    const itens = bruto.map((g) => ({ kind: 'group', id: g.id, label: g.nome || g.id }))
    return paginar(filtrarPorTexto(itens, 'label', q), { cursor, limit })
  }

  function listar (instanciaId, { kind, q, cursor, limit } = {}) {
    if (kind === 'group') return listarGrupos(instanciaId, { q, cursor, limit })
    if (kind === 'contact') return listarContatos(instanciaId, { q, cursor, limit })
    throw new Error("kind deve ser 'contact' ou 'group'.")
  }

  return { listar, listarContatos, listarGrupos }
}
