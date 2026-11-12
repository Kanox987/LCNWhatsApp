// O editor da linguagem: um só, usado por criar e por editar.
//
// Eram dois, com o mesmo textarea copiado, o mesmo tratamento de erro copiado,
// e ajuda só num deles — quem CRIAVA via o cartão "o essencial", quem EDITAVA
// não via nada. Com um componente, tudo que entra aqui aparece nos dois por
// construção, e é por isso que o realce e a conferência ao vivo não precisaram
// ser escritos duas vezes.
//
// Três coisas que ele faz e o textarea nu não fazia:
//
//   1. NÚMERO DE LINHA. O erro sempre disse "linha 12"; contar doze linhas num
//      texto de sessenta era metade do trabalho, e era trabalho da pessoa.
//   2. PALAVRAS COLORIDAS, por uma camada espelhando o texto. As palavras vêm
//      do servidor (derivadas do vocabulário), nunca escritas aqui.
//   3. CONFERÊNCIA ENQUANTO ESCREVE. Antes, compilar e salvar eram a mesma
//      ação: o erro aparecia ao clicar em salvar, um por vez.
//
// O QUE ELE NÃO FAZ, de propósito: mexer no cursor. `marcarLinha` dá foco e
// seleciona, e isso briga com quem está digitando — ao vivo a linha é marcada
// só visualmente, e o salto continua existindo na falha de salvar, que é o
// momento em que a pessoa parou de escrever e está olhando o resultado.
import { api } from '../api.js'
import { ajudaNaPosicao } from '../logic/ajuda-ao-passar.js'
import { ajudaNoCursor } from '../logic/ajuda-no-cursor.js'
import { realcar } from '../logic/realce.js'
import { inserirTrecho } from '../logic/trechos.js'
import { button, el } from '../ui.js'
import { corpoDaAcao } from './referencia-lcn.js'

const ESPERA_ANTES_DE_CONFERIR = 400
// Quanto o ponteiro fica parado antes da caixa abrir. Menos que isso, ela
// pisca enquanto a pessoa só atravessa o texto com o mouse.
const ESPERA_ANTES_DA_CAIXA = 350

// A camada de realce é um espelho do textarea: mesma fonte, mesmo tamanho,
// mesma entrelinha, mesmo recuo (travados numa regra só do CSS). O que ela tem
// de acompanhar em JavaScript é a ROLAGEM — nos dois eixos, porque a linguagem
// tem linha comprida e o textarea rola de lado.
function acompanharRolagem (area, camada, numeros) {
  const acompanhar = () => {
    camada.scrollTop = area.scrollTop
    camada.scrollLeft = area.scrollLeft
    numeros.scrollTop = area.scrollTop
  }
  area.addEventListener('scroll', acompanhar)
  // O textarea é redimensionável à mão (`resize: vertical` no CSS). Sem
  // observar isso, a camada fica do tamanho antigo e o texto colorido sobra
  // para fora do campo.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { camada.style.height = `${area.clientHeight}px` }).observe(area)
  }
  return acompanhar
}

/**
 * Monta o editor.
 *
 * @param {object} opcoes
 * @param {string} opcoes.texto O texto inicial.
 * @param {Array} [opcoes.botoes] Os botões do pé (salvar, criar, publicar).
 * @returns {{elemento: Node, area: Node, aviso: Node, marcarLinha: Function,
 *   mostrarErro: Function, limparAviso: Function, inserir: Function}}
 */
export function editorLcn ({ texto = '', botoes = [] } = {}) {
  const area = el('textarea', {
    className: 'lcn-editor',
    rows: String(Math.max(16, String(texto).split('\n').length + 2)),
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off'
  }, texto)

  const camada = el('pre', { className: 'lcn-realce', 'aria-hidden': 'true' })
  const numeros = el('div', { className: 'lcn-numeros', 'aria-hidden': 'true' })
  const estado = el('div', { className: 'lcn-estado', role: 'status' })
  const aviso = el('div', {})
  const ajuda = el('div', { className: 'lcn-ajuda', role: 'complementary' })

  // Sem palavras, o editor funciona e não acende — é o que acontece se o
  // servidor não responder. Perder a cor é aceitável; perder o editor não.
  let palavras = {}
  // As 38 ações, com os catorze campos de explicação que o servidor deriva do
  // vocabulário e do MESMO JSON Schema que o Ajv usa na instalação. Chegam na
  // mesma resposta de onde saem as palavras do realce — uma requisição só.
  let acoes = []
  // A resposta inteira, para a caixa de passar o mouse: ela explica também o
  // cabeçalho, as marcas e a condição, que não são ações.
  let referencia = null
  const acompanhar = acompanharRolagem(area, camada, numeros)
  const repintar = () => {
    // `palavras` é relido a cada pintura porque ele chega depois, por rede.
    const linhas = realcar(area.value, palavras)
    camada.replaceChildren(...linhas.flatMap((pedacos, i) => {
      const filhos = pedacos.map((p) => (
        p.c ? el('span', { className: p.c, text: p.t }) : document.createTextNode(p.t)
      ))
      return i === linhas.length - 1 ? filhos : [...filhos, document.createTextNode('\n')]
    }))
    numeros.replaceChildren(...linhas.map((_, i) =>
      el('span', { className: 'lcn-num', text: String(i + 1) })
    ))
    acompanhar()
  }

  // --- a ajuda da ação onde o cursor está --------------------------------
  //
  // O pedido manda a explicação ficar ao alcance "sem abandonar a IDE", e manda
  // montá-la a partir da mesma fonte de verdade do compilador. Por isso quem
  // desenha é `corpoDaAcao`, o MESMO componente da aba de referência: a aba e o
  // editor explicam a ação com as mesmas palavras, ou divergiriam na primeira
  // correção.
  //
  // Ela só LÊ `selectionStart`. Dar foco ou mexer na seleção aqui brigaria com
  // quem está digitando, e é a regra que este arquivo declara no cabeçalho.
  let ultimaAcao = null
  const atualizarAjuda = () => {
    if (!acoes.length) return
    const achado = ajudaNoCursor({ texto: area.value, posicao: area.selectionStart, acoes })
    if (!achado) {
      ultimaAcao = null
      ajuda.replaceChildren(el('p', { className: 'lcn-ajuda-vazia', text: 'Ponha o cursor numa linha de ação para ver o que ela faz, o que aceita e como ela erra.' }))
      return
    }
    // Remontar o mesmo bloco a cada tecla fecharia o `details` que a pessoa
    // acabou de abrir. Enquanto o cursor não trocar de ação, não se mexe.
    const campo = achado.campo ? `  ${achado.campo.escrita}` : ''
    if (ultimaAcao === achado.acao && ajuda.dataset.campo === campo) return
    ultimaAcao = achado.acao
    ajuda.dataset.campo = campo
    ajuda.replaceChildren(el('details', { className: 'lcn-ref-item', open: true }, [
      el('summary', {}, [
        el('code', { text: achado.acao.palavra }),
        achado.acao.rotulo ? el('span', { className: 'lcn-ref-detalhe', text: achado.acao.rotulo }) : null,
        achado.campo ? el('span', { className: 'lcn-ref-detalhe', text: `no campo ${achado.campo.escrita}` }) : null
      ]),
      el('div', { className: 'lcn-ref-corpo' }, corpoDaAcao(achado.acao))
    ]))
  }

  api.linguagem.referencia()
    .then((ref) => {
      palavras = ref?.palavras || {}
      acoes = ref?.acoes || []
      referencia = ref || null
      repintar()
      atualizarAjuda()
    })
    .catch(() => { /* sem cor e sem ajuda, e o editor continua */ })

  // O cursor anda por tecla, por clique e por seleção — e nenhum desses eventos
  // é `input`, porque andar não altera o texto.
  for (const evento of ['click', 'keyup', 'focus', 'select']) {
    area.addEventListener(evento, atualizarAjuda)
  }

  // --- a caixa de passar o mouse, como numa IDE ---------------------------
  //
  // O textarea não diz qual caractere está sob o ponteiro, mas a fonte é
  // monoespaçada e a entrelinha é fixa (as três regras de alinhamento do CSS):
  // linha e coluna saem de conta, com a largura de um caractere medida na
  // fonte que o navegador de fato usou. Quem decide O QUE explicar é
  // `ajudaNaPosicao`, função pura e testada contra a referência real.
  const caixa = el('div', { className: 'lcn-dica', role: 'tooltip', hidden: true })
  let larguraDoCaractere = 0
  const medirCaractere = () => {
    if (larguraDoCaractere) return larguraDoCaractere
    const contexto = document.createElement('canvas').getContext('2d')
    if (!contexto) return 0
    contexto.font = getComputedStyle(area).font
    larguraDoCaractere = contexto.measureText('0'.repeat(100)).width / 100
    return larguraDoCaractere
  }
  const esconderCaixa = () => { caixa.hidden = true }
  const posicaoDoPonteiro = (evento) => {
    const estilo = getComputedStyle(area)
    const entrelinha = parseFloat(estilo.lineHeight)
    const largura = medirCaractere()
    if (!entrelinha || !largura) return null
    const retangulo = area.getBoundingClientRect()
    const x = evento.clientX - retangulo.left - area.clientLeft - parseFloat(estilo.paddingLeft) + area.scrollLeft
    const y = evento.clientY - retangulo.top - area.clientTop - parseFloat(estilo.paddingTop) + area.scrollTop
    if (x < 0 || y < 0) return null
    const linha = Math.floor(y / entrelinha) + 1
    return {
      linha,
      coluna: Math.floor(x / largura),
      // Logo abaixo da linha apontada, em coordenadas da moldura.
      topo: area.offsetTop + area.clientTop + parseFloat(estilo.paddingTop) + linha * entrelinha - area.scrollTop + 4
    }
  }
  const mostrarCaixa = (evento) => {
    if (!referencia) return
    const lugar = posicaoDoPonteiro(evento)
    const dica = lugar && ajudaNaPosicao({ texto: area.value, linha: lugar.linha, coluna: lugar.coluna, referencia })
    if (!dica) { esconderCaixa(); return }
    const linhaDe = (rotulo, valor) => el('p', { className: 'lcn-dica-linha' }, [el('strong', { text: `${rotulo} ` }), valor])
    caixa.replaceChildren(
      el('div', { className: 'lcn-dica-titulo' }, [
        el('code', { text: dica.titulo }),
        dica.rotulo ? el('span', { text: dica.rotulo }) : null
      ]),
      dica.texto ? el('p', { className: 'lcn-dica-texto', text: dica.texto }) : null,
      dica.aceita ? linhaDe('Aceita:', dica.aceita.join(' · ')) : null,
      dica.padrao !== null && dica.padrao !== undefined ? linhaDe('Padrão:', String(dica.padrao)) : null,
      dica.campos ? linhaDe('Campos:', dica.campos.join(' · ')) : null,
      dica.obrigatorio ? el('p', { className: 'lcn-dica-linha', text: 'Obrigatório.' }) : null
    )
    caixa.hidden = false
    // Encostada no ponteiro, sem passar da borda direita da moldura.
    const moldura = caixa.parentElement
    const esquerda = evento.clientX - (moldura?.getBoundingClientRect().left ?? 0)
    const limite = (moldura?.clientWidth ?? 0) - caixa.offsetWidth
    caixa.style.left = `${Math.max(0, Math.min(esquerda, limite))}px`
    caixa.style.top = `${lugar.topo}px`
  }
  let relogioDaCaixa = null
  area.addEventListener('mousemove', (evento) => {
    clearTimeout(relogioDaCaixa)
    relogioDaCaixa = setTimeout(() => mostrarCaixa(evento), ESPERA_ANTES_DA_CAIXA)
  })
  // Digitar, rolar ou sair do campo deixa a caixa velha mentindo sobre o lugar.
  for (const evento of ['mouseleave', 'input', 'keydown', 'scroll', 'blur']) {
    area.addEventListener(evento, () => { clearTimeout(relogioDaCaixa); esconderCaixa() })
  }

  // --- a linha do erro, marcada sem mexer no cursor -----------------------
  let linhaComErro = null
  const marcarVisualmente = (linha) => {
    linhaComErro = linha
    for (const [i, no] of [...numeros.children].entries()) {
      no.classList.toggle('lcn-num-erro', linha === i + 1)
    }
  }

  const limparAviso = () => {
    aviso.replaceChildren()
    estado.replaceChildren()
    marcarVisualmente(null)
  }

  const mostrarErro = (titulo, mensagem, linha) => {
    aviso.replaceChildren(el('div', { className: 'notice notice-danger' }, [
      el('strong', { text: linha ? `${titulo} — linha ${linha}` : titulo }),
      el('p', { text: mensagem })
    ]))
    if (linha) marcarVisualmente(linha)
  }

  // Leva o cursor para a linha. Só no erro de SALVAR: ao vivo isso tiraria o
  // cursor do lugar a cada 400 ms.
  const marcarLinha = (linha) => {
    const linhas = area.value.split('\n')
    const inicio = linhas.slice(0, Math.max(0, linha - 1)).reduce((n, l) => n + l.length + 1, 0)
    const fim = inicio + (linhas[linha - 1]?.length ?? 0)
    area.focus()
    try { area.setSelectionRange(inicio, fim) } catch { /* navegador antigo */ }
    marcarVisualmente(linha)
  }

  // --- conferência ao vivo ------------------------------------------------
  let relogio = null
  const conferir = async () => {
    const texto = area.value
    if (!texto.trim()) { estado.replaceChildren(); return }
    let resultado
    try {
      resultado = await api.linguagem.validar(texto)
    } catch {
      // Painel sem servidor: a conferência cala a boca em vez de encher a tela
      // de erro de rede no meio da digitação.
      estado.replaceChildren()
      return
    }
    // O texto pode ter mudado enquanto a resposta vinha.
    if (area.value !== texto) return
    if (resultado.ok) {
      marcarVisualmente(null)
      const o = resultado.tipo === 'template' ? 'Template' : 'Automação'
      const quantas = resultado.resumo?.acoes ?? 0
      estado.replaceChildren(el('span', { className: 'lcn-ok', text: `✓ ${o} de pé — ${quantas} ${quantas === 1 ? 'ação' : 'ações'}` }))
    } else {
      const linha = resultado.erro?.linha ?? null
      marcarVisualmente(linha)
      estado.replaceChildren(el('span', {
        className: 'lcn-erro',
        text: linha ? `linha ${linha}: ${resultado.erro.mensagem.replace(/^linha \d+: /, '')}` : resultado.erro.mensagem
      }), linha
        ? button('ir para a linha', { onClick: () => marcarLinha(linha) })
        : null)
    }
  }

  area.addEventListener('input', () => {
    aviso.replaceChildren()
    if (linhaComErro !== null) marcarVisualmente(null)
    repintar()
    atualizarAjuda()
    clearTimeout(relogio)
    relogio = setTimeout(conferir, ESPERA_ANTES_DE_CONFERIR)
  })

  const inserir = (trecho) => {
    const { texto: novo, posicao } = inserirTrecho(area.value, area.selectionStart, trecho)
    area.value = novo
    area.focus()
    try { area.setSelectionRange(posicao, posicao) } catch { /* navegador antigo */ }
    repintar()
    clearTimeout(relogio)
    relogio = setTimeout(conferir, ESPERA_ANTES_DE_CONFERIR)
  }

  repintar()
  atualizarAjuda()
  conferir()

  const elemento = el('section', { className: 'card stack' }, [
    // A moldura existe por causa da caixa: `.lcn-caixa` corta o que transborda
    // (é o que alinha o realce), e a dica precisa poder passar da borda.
    el('div', { className: 'lcn-moldura' }, [
      el('div', { className: 'lcn-caixa' }, [numeros, camada, area]),
      caixa
    ]),
    estado,
    ajuda,
    aviso,
    botoes.length ? el('div', { className: 'button-row' }, botoes) : null
  ])

  return { elemento, area, aviso, marcarLinha, mostrarErro, limparAviso, inserir }
}
