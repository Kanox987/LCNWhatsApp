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
    carregar()
    return el('div', { className: 'card stack' }, [
      el('div', { className: 'row-between' }, [
        el('div', {}, [el('strong', { className: 'mono', text: lista.nome }), badge(`${lista.membros} ${lista.membros === 1 ? 'pessoa' : 'pessoas'}`, 'neutral')]),
        limpar
      ]),
      membros
    ])
  }

  const corpo = existentes.length
    ? el('div', { className: 'stack' }, existentes.map(cartaoDeLista))
    : emptyState('Nenhuma lista ainda', 'Cadastre o primeiro membro abaixo e a lista passa a existir.')

  return el('div', { className: 'stack-lg' }, [
    aviso,
    el('section', { className: 'stack' }, [
      el('div', { className: 'row-between' }, [el('h2', { text: 'Listas' }), badge(String(existentes.length), existentes.length ? 'success' : 'neutral')]),
      corpo
    ]),
    formulario
  ])
}
