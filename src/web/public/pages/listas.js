// LISTAS — pessoas autorizadas por nome.
//
// Uma lista é só um nome com gente dentro. Quem está nela passa em todo comando
// instalado com "quem pode usar: lista <nome>"; lista vazia não libera ninguém.
// Pôr alguém numa lista é dar permissão, e por isso esta tela só existe no
// painel local, como a de Donos.
//
// O motor guarda a lista como atributo de contato com chave reservada: ela
// nasce quando entra o primeiro membro e some quando sai o último. Então
// "criar uma lista" aqui é cadastrar o primeiro membro.
import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, notify, setBusy, setPageHeader } from '../ui.js'
import { paraJid } from './owners.js'

// O mesmo formato que o motor exige (`normalizarNomeDeLista`); conferir aqui é
// só dar o recado antes da viagem.
const NOME_DE_LISTA = /^[a-z][a-z0-9_]{0,31}$/

export function nomeDeLista (bruto) {
  const limpo = String(bruto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/[\s-]+/g, '_')
  return NOME_DE_LISTA.test(limpo) ? limpo : null
}

const numeroLegivel = (jid) => String(jid || '').split('@')[0] || jid

// O texto do arquivo escolhido na tela → o objeto que o motor valida. O motor é
// quem decide se as pessoas servem; aqui só se evita mandar o que nem é JSON.
export function lerJsonDaLista (texto) {
  try { return { dados: JSON.parse(String(texto ?? '')), problema: null } } catch {
    return { dados: null, problema: 'Esse arquivo não é um JSON válido. Use o arquivo exportado por esta tela ou uma lista de números, como ["5511999999999"].' }
  }
}

// A frase da prévia. "Substituir" fala em quem sai, porque é o que surpreende.
export function resumoDaImportacao (r) {
  const partes = [`${r.adicionar} ${r.adicionar === 1 ? 'entra' : 'entram'}`, `${r.jaEstavam} já ${r.jaEstavam === 1 ? 'estava' : 'estavam'}`]
  if (r.mode === 'replace') partes.push(`${r.remover} ${r.remover === 1 ? 'sai' : 'saem'}`)
  if (r.repeated) partes.push(`${r.repeated} repetida${r.repeated === 1 ? '' : 's'} no arquivo ignorada${r.repeated === 1 ? '' : 's'}`)
  return `${partes.join(', ')}. A lista ficaria com ${r.totalFinal} ${r.totalFinal === 1 ? 'pessoa' : 'pessoas'}.`
}

function baixarComoArquivo (nome, objeto) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(objeto, null, 2)}\n`], { type: 'application/json' }))
  const ancora = el('a', { href: url, download: `${nome}.json` })
  document.body.appendChild(ancora)
  ancora.click()
  ancora.remove()
  URL.revokeObjectURL(url)
}

export async function renderListas ({ refresh }) {
  setPageHeader({
    eyebrow: 'Quem pode',
    title: 'Listas',
    description: 'Grupos de pessoas autorizadas. Quem está numa lista pode usar os comandos instalados com “quem pode usar: lista …”. Lista vazia não libera ninguém.',
    actions: [button('Atualizar', { onClick: () => refresh?.() })]
  })

  let dados
  try {
    dados = await api.listas.list()
  } catch (erro) {
    return errorState('Não consegui carregar as listas.', erro.message)
  }

  const existentes = dados?.lists || []
  const aviso = el('div', {})
  const mostrarErro = (titulo, mensagem) => aviso.replaceChildren(
    el('div', { className: 'notice notice-danger' }, [
      el('strong', { text: titulo }),
      el('p', { text: mensagem })
    ])
  )

  // --- adicionar (cria a lista se ainda não existe) -------------------------
  const campoLista = el('input', { type: 'text', className: 'input', placeholder: 'autorizados', autocomplete: 'off', list: 'listas-existentes' })
  const sugestoes = el('datalist', { id: 'listas-existentes' }, existentes.map((l) => el('option', { value: l.nome })))
  const campoNumero = el('input', { type: 'text', className: 'input', placeholder: '5511999999999', autocomplete: 'off' })

  const adicionar = button('Pôr na lista', {
    variant: 'primary',
    onClick: async () => {
      aviso.replaceChildren()
      const nome = nomeDeLista(campoLista.value)
      if (!nome) {
        mostrarErro('Nome de lista inválido', 'Use letras, números e “_”, começando por letra, até 32 caracteres. Exemplo: autorizados.')
        return
      }
      const jid = paraJid(campoNumero.value)
      if (!jid) {
        mostrarErro('Número inválido', 'Escreva o número com DDI e DDD, só dígitos — por exemplo 5511999999999.')
        return
      }
      setBusy(adicionar, true)
      try {
        await api.listas.add(nome, jid)
        notify(`${numeroLegivel(jid)} entrou em “${nome}”.`)
        campoNumero.value = ''
        await refresh?.()
      } catch (erro) {
        mostrarErro('Não consegui adicionar', erro.message)
      } finally {
        setBusy(adicionar, false)
      }
    }
  })

  const formulario = el('section', { className: 'card stack' }, [
    el('h2', { text: 'Pôr alguém numa lista' }),
    field('Nome da lista', campoLista, 'Se a lista ainda não existe, ela nasce com este primeiro membro.'),
    sugestoes,
    field('Número no WhatsApp', campoNumero, 'Com DDI e DDD. O formato interno (@s.whatsapp.net) é montado aqui.'),
    el('div', { className: 'button-row' }, [adicionar])
  ])

  // --- cada lista, com os membros carregados sob demanda ---------------------
  const cartaoDeLista = (lista) => {
    const membros = el('div', { className: 'stack-sm' })
    const carregar = async () => {
      try {
        const r = await api.listas.get(lista.nome)
        membros.replaceChildren(...(r.members || []).map((jid) => {
          const tirar = button('Tirar', {
            onClick: async () => {
              setBusy(tirar, true)
              try {
                await api.listas.remove(lista.nome, jid)
                notify(`${numeroLegivel(jid)} saiu de “${lista.nome}”.`)
                await refresh?.()
              } catch (erro) {
                mostrarErro('Não consegui remover', erro.message)
                setBusy(tirar, false)
              }
            }
          })
          return el('div', { className: 'row-between' }, [el('span', { className: 'mono', text: numeroLegivel(jid) }), tirar])
        }))
      } catch (erro) {
        membros.replaceChildren(el('p', { className: 'muted', text: `Não consegui carregar: ${erro.message}` }))
      }
    }
    const limpar = button('Apagar a lista', {
      onClick: async () => {
        if (!window.confirm(`Apagar a lista “${lista.nome}”? Quem estava nela deixa de passar nos comandos que a usam.`)) return
        setBusy(limpar, true)
        try {
          await api.listas.clear(lista.nome)
          notify(`Lista “${lista.nome}” apagada.`)
          await refresh?.()
        } catch (erro) {
          mostrarErro('Não consegui apagar', erro.message)
          setBusy(limpar, false)
        }
      }
    })
    const exportar = button('Exportar', {
      onClick: async () => {
        setBusy(exportar, true)
        try {
          baixarComoArquivo(lista.nome, await api.listas.export(lista.nome))
        } catch (erro) {
          mostrarErro('Não consegui exportar', erro.message)
        } finally {
          setBusy(exportar, false)
        }
      }
    })
    carregar()
    return el('div', { className: 'card stack' }, [
      el('div', { className: 'row-between' }, [
        el('div', {}, [el('strong', { className: 'mono', text: lista.nome }), badge(`${lista.membros} ${lista.membros === 1 ? 'pessoa' : 'pessoas'}`, 'neutral')]),
        el('div', { className: 'button-row' }, [exportar, limpar])
      ]),
      membros
    ])
  }

  // --- importar de arquivo ---------------------------------------------------
  // Dois passos de propósito: primeiro só conta o que mudaria; gravar é um
  // segundo clique, com o `estado` que a prévia devolveu. Se a lista mudou no
  // meio do caminho, o motor recusa a substituição.
  const importNome = el('input', { type: 'text', className: 'input', placeholder: 'autorizados', autocomplete: 'off', list: 'listas-existentes' })
  const importModo = el('select', { className: 'input' }, [
    el('option', { value: 'merge', text: 'Acrescentar às pessoas que já estão' }),
    el('option', { value: 'replace', text: 'Substituir: a lista passa a ser só o arquivo' })
  ])
  const importArquivo = el('input', { type: 'file', accept: 'application/json,.json' })
  const previa = el('div', {})
  let pendente = null // { nome, modo, dados, estado, resumo }

  const aplicarImport = button('Aplicar', {
    variant: 'primary',
    onClick: async () => {
      if (!pendente) return
      if (pendente.modo === 'replace' && !window.confirm(`Substituir a lista “${pendente.nome}”? ${pendente.resumo}`)) return
      setBusy(aplicarImport, true)
      try {
        const r = await api.listas.import(pendente.nome, { dados: pendente.dados, modo: pendente.modo, simular: false, estado: pendente.estado })
        notify(`Lista “${r.name}” atualizada: ${r.totalFinal} ${r.totalFinal === 1 ? 'pessoa' : 'pessoas'}.`)
        pendente = null
        await refresh?.()
      } catch (erro) {
        mostrarErro('Não consegui importar', erro.message)
        previa.replaceChildren()
        pendente = null
      } finally {
        setBusy(aplicarImport, false)
      }
    }
  })
  aplicarImport.hidden = true
  // A prévia vale para aquele nome, modo e arquivo: mexer em qualquer um a descarta.
  const descartarPrevia = () => { pendente = null; aplicarImport.hidden = true; previa.replaceChildren() }
  for (const campo of [importNome, importModo, importArquivo]) campo.addEventListener('change', descartarPrevia)
  importNome.addEventListener('input', descartarPrevia)

  const verMudancas = button('Ver o que muda', {
    onClick: async () => {
      aviso.replaceChildren()
      previa.replaceChildren()
      aplicarImport.hidden = true
      pendente = null
      const nome = nomeDeLista(importNome.value)
      if (!nome) { mostrarErro('Nome de lista inválido', 'Use letras, números e “_”, começando por letra, até 32 caracteres.'); return }
      const arquivo = importArquivo.files?.[0]
      if (!arquivo) { mostrarErro('Escolha um arquivo', 'Selecione o arquivo .json da lista.'); return }
      const { dados, problema } = lerJsonDaLista(await arquivo.text())
      if (problema) { mostrarErro('Arquivo inválido', problema); return }
      setBusy(verMudancas, true)
      try {
        const modo = importModo.value
        const r = await api.listas.import(nome, { dados, modo, simular: true })
        const resumo = resumoDaImportacao(r)
        pendente = { nome, modo, dados, estado: r.estado, resumo }
        previa.replaceChildren(el('div', { className: 'notice' }, [el('strong', { text: 'Nada foi gravado ainda' }), el('p', { text: resumo })]))
        aplicarImport.hidden = false
      } catch (erro) {
        mostrarErro('Importação cancelada', erro.message)
      } finally {
        setBusy(verMudancas, false)
      }
    }
  })

  const importar = el('section', { className: 'card stack' }, [
    el('h2', { text: 'Importar de arquivo' }),
    el('p', { className: 'muted', text: 'Quem entra na lista passa a valer em todo comando com “quem pode usar: lista …”. Por isso a importação mostra o que muda antes de gravar, e recusa o arquivo inteiro se alguma entrada não for um número de WhatsApp.' }),
    field('Lista', importNome, 'A lista afetada é esta, não a que estiver escrita dentro do arquivo.'),
    field('Arquivo', importArquivo, 'O arquivo exportado por aqui, ou um JSON com números, como [“5511999999999”].'),
    field('Como importar', importModo),
    previa,
    el('div', { className: 'button-row' }, [verMudancas, aplicarImport])
  ])

  const corpo = existentes.length
    ? el('div', { className: 'stack' }, existentes.map(cartaoDeLista))
    : emptyState('Nenhuma lista ainda', 'Cadastre o primeiro membro abaixo e a lista passa a existir.')

  return el('div', { className: 'stack-lg' }, [
    aviso,
    el('section', { className: 'stack' }, [
      el('div', { className: 'row-between' }, [el('h2', { text: 'Listas' }), badge(String(existentes.length), existentes.length ? 'success' : 'neutral')]),
      corpo
    ]),
    formulario,
    importar
  ])
}
