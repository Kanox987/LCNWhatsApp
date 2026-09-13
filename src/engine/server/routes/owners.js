import { ErroHttp } from '../transport.js'
import { definirDono, listarDonos, semDonoCadastrado } from '../owners.js'

// Um JID de contato do WhatsApp: só dígitos antes do domínio. Validar aqui
// evita gravar lixo como "dono" e, principalmente, evita que um id inventado
// vire uma linha que nunca corresponde a ninguém mas parece autorizar alguém.
const JID_CONTATO = /^\d{5,20}@s\.whatsapp\.net$/

function exigirJid (valor) {
  if (typeof valor !== 'string' || !JID_CONTATO.test(valor)) {
    throw new ErroHttp(400, 'Informe o contato no formato 5511999999999@s.whatsapp.net.')
  }
  return valor
}

export function registrarRotasOwners (roteador, db) {
  roteador.get('/owners', () => ({
    owners: listarDonos(db),
    // Sem dono cadastrado, comando restrito só responde ao PRÓPRIO número do
    // bot — é assim que se cadastra o primeiro dono pelo WhatsApp. A UI usa
    // isto para explicar o estado em vez de deixar a pessoa adivinhar.
    noOwnerYet: semDonoCadastrado(db),
    onlySelfCanUseRestricted: semDonoCadastrado(db)
  }))

  roteador.post('/owners', ({ body }) => {
    const contactId = exigirJid(body?.contactId)
    return definirDono(db, contactId, true)
  })

  roteador.delete('/owners/:contactId', ({ params }) => {
    const contactId = exigirJid(decodeURIComponent(params.contactId))
    return definirDono(db, contactId, false)
  })
}
