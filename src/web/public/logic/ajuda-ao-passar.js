// A ajuda de passar o mouse, como numa IDE: o que é a palavra sob o ponteiro,
// o que ela faz e o que aceita.
//
// `ajuda-no-cursor.js` já responde "em qual AÇÃO o cursor está", e o painel
// lateral desenha essa ação inteira. Faltava o resto da linguagem: o
// cabeçalho (`casa:`, `prioridade:`, `família:`…), as marcas (`só dono`), a
// condição (`se`) e os campos do modelo. Tudo isso a referência de
// `/meta/linguagem` já traz, com a mesma explicação da aba Referência; aqui só
// se decide QUAL entrada cabe na linha e na coluna apontadas.
//
// Função pura, sem DOM, para rodar em teste contra a referência real.
import { comecaCom } from './realce.js'
import { ajudaNoCursor } from './ajuda-no-cursor.js'

// Um texto curto para a caixa. A explicação técnica fica de reserva para o
// campo que não tem ajuda escrita para pessoas.
const recuoDe = (l) => String(l ?? '').length - String(l ?? '').replace(/^\s+/, '').length

const explicar = (item) => item?.ajuda || item?.explicacaoTecnica || null

// O que a pessoa escreve. `palavras` são as do .lcn ("começa com"); os
// `valoresAceitos` são os do documento ("prefix") e só servem quando não há
// palavra própria.
function aceita (item) {
  if (Array.isArray(item?.palavras) && item.palavras.length) return item.palavras
  if (Array.isArray(item?.valoresAceitos) && item.valoresAceitos.length) return item.valoresAceitos.map(String)
  return null
}

function deCampo (item, titulo) {
  return {
    titulo,
    rotulo: item.rotulo || null,
    texto: explicar(item),
    aceita: aceita(item),
    padrao: item.padrao ?? null,
    obrigatorio: item.obrigatorio === true
  }
}

// Mais longa primeiro, como no compilador: "sem vaga:" não pode perder para
// "sem ele:" por ordem de lista.
function chaveDaLinha (resto, itens) {
  let achado = null
  for (const item of itens || []) {
    const chave = item?.chave
    if (typeof chave !== 'string' || !chave) continue
    if (!resto.startsWith(`${chave}:`)) continue
    if (!achado || chave.length > achado.chave.length) achado = item
  }
  return achado
}

/**
 * A ajuda da palavra na posição apontada, ou `null` quando o ponteiro está em
 * espaço vazio ou numa linha que a linguagem não conhece.
 *
 * @param {object} opcoes
 * @param {string} opcoes.texto O documento inteiro.
 * @param {number} opcoes.linha Linha apontada, base 1.
 * @param {number} opcoes.coluna Coluna apontada, base 0.
 * @param {object} opcoes.referencia A resposta de /meta/linguagem.
 * @returns {{titulo: string, rotulo: string|null, texto: string|null,
 *   aceita: string[]|null, padrao: *, obrigatorio: boolean,
 *   campos?: string[]}|null}
 */
export function ajudaNaPosicao ({ texto = '', linha = 1, coluna = 0, referencia = null } = {}) {
  if (!referencia) return null
  const linhas = String(texto ?? '').split('\n')
  const atual = linhas[linha - 1]
  if (typeof atual !== 'string') return null
  const recuo = recuoDe(atual)
  // Só sobre o que está escrito: o espaço do recuo e o vazio depois do fim
  // da linha não são palavra nenhuma, e uma caixa ali seria ruído.
  if (coluna < recuo || coluna >= atual.length) return null
  const resto = atual.slice(recuo)
  if (resto.startsWith('#')) return null

  // Ação, ou um campo dela. A regra de "qual ação" é a do painel lateral, para
  // a caixa e o painel nunca explicarem coisas diferentes. Só vale quando a
  // linha É a da ação ou está recuada DEBAIXO dela: o cabeçalho também vem
  // recuado (dentro de `automação`), e `menu:` ali não é campo de ação nenhuma.
  const posicao = linhas.slice(0, linha - 1).reduce((n, l) => n + l.length + 1, 0) + coluna
  const achado = ajudaNoCursor({ texto, posicao, acoes: referencia.acoes })
  if (achado) {
    const { acao, campo } = achado
    const recuoDaAcao = recuoDe(linhas[achado.linha - 1])
    if (achado.linha === linha) {
      const nomes = (acao.campos || [])
        .map((c) => c?.escrita)
        .filter((e) => typeof e === 'string' && e.endsWith(':'))
      return {
        titulo: acao.palavra,
        rotulo: acao.rotulo || null,
        texto: acao.resumo || null,
        aceita: campo ? aceita(campo) : null,
        padrao: null,
        obrigatorio: false,
        campos: nomes.length ? nomes : undefined
      }
    }
    if (campo && recuo > recuoDaAcao) return deCampo(campo, campo.escrita)
  }

  // Cabeçalho da automação ou do modelo: `chave: valor`.
  const campo = chaveDaLinha(resto, referencia.cabecalho) || chaveDaLinha(resto, referencia.template)
  if (campo) return deCampo(campo, `${campo.chave}:`)

  // Blocos do modelo (`configurável`, `declara`, `avisa`) e os campos que
  // vêm debaixo deles (`rótulo:`, `ajuda:`).
  const blocos = referencia.blocos || []
  const bloco = blocos.find((b) => typeof b?.bloco === 'string' && comecaCom(resto, b.bloco))
  if (bloco) {
    return {
      titulo: bloco.bloco,
      rotulo: bloco.forma || null,
      texto: bloco.ajuda || null,
      aceita: Array.isArray(bloco.palavras) && bloco.palavras.length ? bloco.palavras : null,
      padrao: null,
      obrigatorio: false
    }
  }
  const filho = chaveDaLinha(resto, blocos.flatMap((b) => b?.filhos || []))
  if (filho) return deCampo(filho, `${filho.chave}:`)
  // A declaração debaixo de um bloco (`command: texto = "/abrir"`) tem nome
  // inventado por quem escreve; quem explica a forma dela é o bloco.
  for (let i = linha - 2; i >= 0; i--) {
    const acima = linhas[i] ?? ''
    if (!acima.trim()) continue
    if (recuoDe(acima) >= recuo) continue
    const dono = blocos.find((b) => typeof b?.bloco === 'string' && comecaCom(acima.trim(), b.bloco))
    if (dono) {
      return {
        titulo: resto.split(':')[0],
        rotulo: `campo de ${dono.bloco} · ${dono.forma || ''}`.trim(),
        texto: dono.ajuda || null,
        aceita: Array.isArray(dono.palavras) && dono.palavras.length ? dono.palavras : null,
        padrao: null,
        obrigatorio: false
      }
    }
    break
  }

  // Marca: uma linha que é só a palavra ("só dono").
  const marca = (referencia.marcas || []).find((m) => typeof m?.chave === 'string' && comecaCom(resto, m.chave))
  if (marca) return deCampo(marca, marca.chave)

  // Condição.
  const c = referencia.condicao
  if (c && (comecaCom(resto, 'se') || comecaCom(resto, 'senão'))) {
    return {
      titulo: comecaCom(resto, 'senão') ? 'senão' : 'se',
      rotulo: c.forma || null,
      texto: c.ajuda || null,
      aceita: Array.isArray(c.operadores) ? c.operadores : null,
      padrao: null,
      obrigatorio: false
    }
  }
  return null
}
