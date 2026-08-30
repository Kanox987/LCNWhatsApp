// Bug real reportado pelo usuário: o painel não achava o nome de algumas
// pessoas na hora da seleção. Causa: o diretório só era alimentado por
// `info.pushName` (nome que a própria pessoa escolhe pro perfil, às vezes
// vazio) de quem já mandou mensagem — nunca pelo nome salvo na agenda.
// `registrarNomesDoDiretorio` cobre os eventos 'contacts.upsert'/'contacts.update'
// da Baileys (app-state sync), que trazem o nome salvo de verdade (`name`) e
// cobrem também gente que nunca mandou mensagem pro bot.
import fs from 'fs'
import { ARQ_CONTATOS } from '../src/paths.js'
import { listarContatos } from '../src/directory.js'
import { registrarNomesDoDiretorio } from '../src/connection.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const backup = fs.existsSync(ARQ_CONTATOS) ? fs.readFileSync(ARQ_CONTATOS, 'utf8') : null
try {
  fs.rmSync(ARQ_CONTATOS, { force: true })

  registrarNomesDoDiretorio([
    { id: '5511999999999@s.whatsapp.net', phoneNumber: '5511999999999', name: 'Fulano da Agenda' }
  ])
  check('nome salvo (name) de quem nunca mandou mensagem é registrado', listarContatos().find((c) => c.numero === '5511999999999')?.nome === 'Fulano da Agenda')

  registrarNomesDoDiretorio([
    { id: '5511888888888@s.whatsapp.net', phoneNumber: '5511888888888', notify: 'Apelido' }
  ])
  check('fallback pra notify quando não tem name', listarContatos().find((c) => c.numero === '5511888888888')?.nome === 'Apelido')

  registrarNomesDoDiretorio([{ id: '123456@lid', name: 'Só por LID' }])
  check('sem phoneNumber, usa o id (LID) como chave', listarContatos().find((c) => c.numero === '123456')?.nome === 'Só por LID')

  registrarNomesDoDiretorio([{ id: '5511999999999@s.whatsapp.net', phoneNumber: '5511999999999', imgUrl: 'changed' }])
  check('evento sem name/notify (ex.: mudança de foto) não apaga o nome já salvo', listarContatos().find((c) => c.numero === '5511999999999')?.nome === 'Fulano da Agenda')

  check('lista vazia/undefined não quebra', (registrarNomesDoDiretorio([]), registrarNomesDoDiretorio(undefined), true))
} finally {
  if (backup !== null) fs.writeFileSync(ARQ_CONTATOS, backup)
  else fs.rmSync(ARQ_CONTATOS, { force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nDIRETÓRIO/NOMES OK')
process.exit(falhas ? 1 : 0)
