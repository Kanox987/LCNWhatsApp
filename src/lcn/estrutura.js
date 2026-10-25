// As arestas não distinguem `senão se` de `senão` com um `se` dentro.
// Guardamos os blocos para devolver a escrita sem adivinhar. O motor continua
// executando só o grafo; conferir os dois impede o editor de mostrar outra regra.
export function arestasDaEstrutura (estrutura, gatilhoId) {
  const arestas = []
  const ligar = (de, para) => {
    if (para) arestas.push({ from: de.from, to: para, on: de.on })
  }
  function bloco (itens, entradas) {
    let pendentes = entradas
    for (const item of itens) {
      const id = typeof item === 'string' ? item : item.nodeId
      for (const entrada of pendentes) ligar(entrada, id)
      pendentes = typeof item === 'string'
        ? [{ from: id, on: 'success' }]
        : [
            ...bloco(item.true, [{ from: id, on: 'true' }]),
            ...bloco(item.false || [], [{ from: id, on: 'false' }])
          ]
    }
    return pendentes
  }
  bloco(estrutura, [{ from: gatilhoId, on: 'matched' }])
  return arestas
}

export function precisaEstrutura (estrutura) {
  // A forma antiga (ações, uma condição final e ramos só de ações) já tem
  // escrita inequívoca, exceto pelo `senão` explicitamente vazio, que não
  // deixa aresta. Só guardamos o que não pode ser recuperado dessa forma.
  return estrutura.some((item, i) => typeof item !== 'string' && (
    i !== estrutura.length - 1 ||
    (item.false && !item.false.length) ||
    [...item.true, ...(item.false || [])].some((filho) => typeof filho !== 'string')
  ))
}

export function conferirEstrutura (flow) {
  const estrutura = flow?.structure
  if (estrutura === undefined) return
  const mapa = new Map(flow.nodes.map((no) => [no.id, no]))
  const gatilhos = flow.nodes.filter((no) => no.type.startsWith('trigger.'))
  if (gatilhos.length !== 1) throw new Error('a estrutura precisa de exatamente um gatilho')
  const vistos = new Set([gatilhos[0].id])
  const pilha = [estrutura]
  while (pilha.length) {
    const bloco = pilha.pop()
    if (!Array.isArray(bloco)) throw new Error('a estrutura precisa de listas de passos')
    for (const item of bloco) {
      const acao = typeof item === 'string'
      const id = acao ? item : item?.nodeId
      const no = mapa.get(id)
      if (!no || vistos.has(id)) throw new Error(`nó ausente ou repetido na estrutura: ${id}`)
      vistos.add(id)
      if (acao) {
        if (!no.type.startsWith('action.')) throw new Error(`o passo ${id} precisa ser uma ação`)
        continue
      }
      if (no.type !== 'condition.compare' || !Array.isArray(item.true) ||
          (item.false !== undefined && !Array.isArray(item.false))) {
        throw new Error(`a condição ${id} precisa de blocos true/false`)
      }
      if (!item.true.length && !item.false?.length) {
        throw new Error(`a condição ${id} precisa de pelo menos um ramo com ação`)
      }
      if (item.elseIf && (item.false?.length !== 1 || typeof item.false[0] !== 'object')) {
        throw new Error(`o senão se de ${id} precisa de uma condição no ramo falso`)
      }
      pilha.push(item.true, item.false || [])
    }
  }
  if (vistos.size !== mapa.size) throw new Error('a estrutura precisa incluir todos os nós do fluxo')
  const chave = (e) => JSON.stringify([e.from, e.to, e.on])
  const esperadas = arestasDaEstrutura(estrutura, gatilhos[0].id).map(chave).sort()
  const reais = flow.edges.map(chave).sort()
  if (JSON.stringify(esperadas) !== JSON.stringify(reais)) {
    throw new Error('a estrutura dos blocos não corresponde às arestas do fluxo')
  }
}

export function inferirEstrutura (flow, gatilhoId) {
  const mapa = new Map(flow.nodes.map((no) => [no.id, no]))
  const saidas = new Map()
  for (const e of flow.edges) {
    const chave = JSON.stringify([e.from, e.on])
    if (saidas.has(chave)) throw new Error('O fluxo tem mais de uma saída com o mesmo resultado.')
    saidas.set(chave, e.to)
  }
  const seguir = (id, on) => saidas.get(JSON.stringify([id, on])) ?? null
  const posteriores = new Map([[null, new Set([null])]])
  const ativos = new Set()
  function destinos (id) {
    if (posteriores.has(id)) return posteriores.get(id)
    if (ativos.has(id)) throw new Error('O fluxo não pode conter ciclo.')
    const no = mapa.get(id)
    if (!no) throw new Error(`Nó inexistente no fluxo: ${id}`)
    ativos.add(id)
    const rotulos = no.type === 'condition.compare' ? ['true', 'false'] : ['success']
    const caminhos = rotulos.map((on) => destinos(seguir(id, on)))
    const comuns = new Set([...caminhos[0]].filter((p) => caminhos.every((c) => c.has(p))))
    comuns.add(id)
    posteriores.set(id, comuns)
    ativos.delete(id)
    return comuns
  }
  const primeiro = seguir(gatilhoId, 'matched')
  destinos(primeiro)
  const vistos = new Set([gatilhoId])
  function bloco (inicio, fim) {
    const itens = []
    let id = inicio
    while (id !== fim && id !== null) {
      if (vistos.has(id)) throw new Error('O grafo compartilha passos fora de blocos estruturados.')
      vistos.add(id)
      const no = mapa.get(id)
      if (no.type === 'condition.compare') {
        // O primeiro nó inevitável nos dois caminhos é a continuação comum.
        // Interseção de alcançáveis não basta: poderia puxar para fora uma
        // ação que só acontece em parte das combinações de condições internas.
        const comuns = [...posteriores.get(id)].filter((p) => p !== id)
        const encontro = comuns.sort((a, b) => posteriores.get(b).size - posteriores.get(a).size)[0] ?? null
        const item = { nodeId: id, true: bloco(seguir(id, 'true'), encontro) }
        const falso = bloco(seguir(id, 'false'), encontro)
        if (falso.length) item.false = falso
        if (!item.true.length && !falso.length) throw new Error(`A condição ${id} precisa de pelo menos um ramo com ação.`)
        itens.push(item)
        id = encontro
      } else {
        if (!no.type.startsWith('action.')) throw new Error(`Passo não representável: ${no.type}`)
        itens.push(id)
        id = seguir(id, 'success')
      }
    }
    return itens
  }
  const estrutura = bloco(primeiro, null)
  conferirEstrutura({ ...flow, structure: estrutura })
  return estrutura
}
