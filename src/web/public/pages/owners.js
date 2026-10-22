// DONOS — quem pode usar comando restrito.
//
// Esta tela faltava, e a falta era um beco sem saída. O motor tem o CRUD
// inteiro desde sempre (`routes/owners.js`), a mensagem de erro de chave
// reservada manda, em letras, usar "a tela de Donos" — e a tela não existia.
// Como `__owner__` é chave reservada, nem pela aba Dados dava para contornar:
// a rota genérica de atributo recusa. Sobravam dois caminhos, e os dois fora
// do alcance de quem aluga o sistema: mandar mensagem de si para si no
// WhatsApp, ou falar HTTP direto com o motor.
//
// O estado de "nenhum dono cadastrado" não é um detalhe a esconder: enquanto
// ele vale, comando restrito responde só ao PRÓPRIO número do bot, e é assim
// que se cadastra o primeiro. Quem não sabe disso fica tentando no número
// errado. Por isso o motor devolve `noOwnerYet` — a rota diz que existe para a
// interface explicar em vez de a pessoa adivinhar.
import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, formatDate, notify, setBusy, setPageHeader } from '../ui.js'

// O mesmo formato que o motor exige (`JID_CONTATO` em routes/owners.js):
// dígitos, depois o domínio de contato. Conferir aqui é só para dar o recado
// antes da viagem — quem decide continua sendo o motor.
const SO_DIGITOS = /^\d{5,20}$/

export function paraJid (bruto) {
  const limpo = String(bruto ?? '').trim()
  if (!limpo) return null
  // JÁ VEIO COM DOMÍNIO: então é um endereço, e tem de ser de CONTATO.
  //
  // Limpar os dígitos de qualquer coisa com "@" transformaria
  // "120363000000000000@g.us" — um grupo — em um contato que não existe: uma
  // linha de autorização que parece autorizar alguém e não corresponde a
  // ninguém. O motor aceitaria, porque o que ele confere é o formato.
  if (limpo.includes('@')) {
    const [parte, dominio] = limpo.split('@')
    return dominio === 's.whatsapp.net' && SO_DIGITOS.test(parte) ? limpo : null
  }
  // Sem domínio, a pessoa digitou o número como ela o conhece: com +, espaço,
  // parênteses e traço. Recusar isso seria exigir que ela soubesse o formato
  // interno.
  const digitos = limpo.replace(/\D+/g, '')
  return SO_DIGITOS.test(digitos) ? `${digitos}@s.whatsapp.net` : null
}

function numeroLegivel (jid) {
  return String(jid || '').split('@')[0] || jid
}

export async function renderOwners ({ refresh }) {
  setPageHeader({
    eyebrow: 'Quem manda',
    title: 'Donos',
    description: 'Quem pode usar os comandos restritos — ligar o bot num grupo, mexer em configuração, moderar. Dono não é quem usa o bot; é quem o comanda.',
    actions: [button('Atualizar', { onClick: () => refresh?.() })]
  })

  let dados
  try {
    dados = await api.owners.list()
  } catch (erro) {
    return errorState('Não consegui carregar os donos.', erro.message)
  }

  const lista = dados?.owners || []
  const nenhumAinda = dados?.noOwnerYet === true

  const aviso = el('div', {})
  const limparAviso = () => aviso.replaceChildren()
  const mostrarErro = (titulo, mensagem) => aviso.replaceChildren(
    el('div', { className: 'notice notice-danger' }, [
      el('strong', { text: titulo }),
      el('p', { text: mensagem })
    ])
  )

  // --- cadastrar ----------------------------------------------------------
  const campoNumero = el('input', {
    type: 'text',
    className: 'input',
    placeholder: '5511999999999',
    autocomplete: 'off'
  })

  const adicionar = button('Tornar dono', {
    variant: 'primary',
    onClick: async () => {
      limparAviso()
      const jid = paraJid(campoNumero.value)
      if (!jid) {
        mostrarErro('Número inválido', 'Escreva o número com DDI e DDD, só dígitos — por exemplo 5511999999999. Pode colar com +, espaços ou traços.')
        return
      }
      setBusy(adicionar, true)
      try {
        await api.owners.add(jid)
        notify(`${numeroLegivel(jid)} agora é dono.`)
        campoNumero.value = ''
        await refresh?.()
      } catch (erro) {
        mostrarErro('Não consegui cadastrar', erro.message)
      } finally {
        setBusy(adicionar, false)
      }
    }
  })

  const formulario = el('section', { className: 'card stack' }, [
    el('h2', { text: 'Cadastrar um dono' }),
    field('Número no WhatsApp', campoNumero, 'Com DDI e DDD. O formato interno (@s.whatsapp.net) é montado aqui — não precisa escrever.'),
    el('div', { className: 'button-row' }, [adicionar])
  ])

  // --- a lista ------------------------------------------------------------
  // O motor devolve `{ contactId, since }`, não uma lista de textos. Ler isso
  // errado não dá erro: dá "[object Object]" na tela, que é o jeito mais
  // silencioso de uma lista mentir.
  const cartaoDeDono = (dono) => {
    const jid = dono?.contactId || String(dono)
    const desde = dono?.since
    const remover = button('Deixar de ser dono', {
      onClick: async () => {
        limparAviso()
        setBusy(remover, true)
        try {
          await api.owners.remove(jid)
          notify(`${numeroLegivel(jid)} não é mais dono.`)
          await refresh?.()
        } catch (erro) {
          mostrarErro('Não consegui remover', erro.message)
        } finally {
          setBusy(remover, false)
        }
      }
    })
    return el('div', { className: 'card row-between' }, [
      el('div', {}, [
        el('strong', { className: 'mono', text: numeroLegivel(jid) }),
        el('p', { className: 'muted compact', text: desde ? `dono desde ${formatDate(desde)}` : jid })
      ]),
      remover
    ])
  }

  const corpoDaLista = lista.length
    ? el('div', { className: 'stack-sm' }, lista.map(cartaoDeDono))
    : emptyState(
      'Nenhum dono cadastrado',
      'Enquanto não houver nenhum, comando restrito responde apenas ao próprio número do bot — e é por ali que se cadastra o primeiro.'
    )

  // O estado de arranque merece explicação, não um aviso vago: ele muda quem o
  // bot obedece, e é temporário por desenho.
  const explicacaoDoArranque = nenhumAinda
    ? el('div', { className: 'notice notice-info' }, [
      el('strong', { text: 'Ainda sem dono' }),
      el('p', { text: 'Comando restrito está respondendo só ao número onde o bot roda. Cadastre o primeiro dono aqui, ou mande o comando de dono a partir do próprio número do bot — as duas formas valem.' })
    ])
    : null

  return el('div', { className: 'stack-lg' }, [
    explicacaoDoArranque,
    aviso,
    el('section', { className: 'stack' }, [
      el('div', { className: 'row-between' }, [
        el('h2', { text: 'Donos cadastrados' }),
        badge(String(lista.length), lista.length ? 'success' : 'neutral')
      ]),
      corpoDaLista
    ]),
    formulario
  ])
}
