// Módulo 3 da Etapa 4.5: busca de contato/grupo por instância pro seletor
// de escopo do painel. Achado importante coberto aqui: o diretório grava
// contato como dígito cru (soDigitos), mas o avaliador de automações
// compara scope.include[].id contra a forma JID canônica — por isso todo
// contato precisa sair já como "<numero>@s.whatsapp.net", nunca o dígito cru.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { criarDirectoryService } from '../src/agent/directoryService.js'
import { InstanciaNaoEncontradaError } from '../src/agent/instanceService.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const pastaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-agent-directory-'))
const dataDir = path.join(pastaTmp, 'wa-000001')
fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true })

const instanciaFixture = { instanceId: 'wa-000001', label: 'Teste', dataDir, containerName: 'lcn-wa-000001' }
function registroFixture () {
  return { version: 1, nextSeq: 2, instances: { 'wa-000001': instanciaFixture } }
}

// validarAlvoGerenciado() (achado de segurança) exige que dataDir/containerName
// batam com o caminho canônico derivado do id — injeta os resolvers pra
// apontar pro diretório de teste isolado em vez do caminho XDG real.
const caminhoInstanciaFn = (id) => path.join(pastaTmp, id)
const nomeContainerFn = (id) => `lcn-${id}`

fs.writeFileSync(path.join(dataDir, 'data', 'contatos.json'), JSON.stringify([
  { numero: '5511999999999', nome: 'Maria' },
  { numero: '5511888888888', nome: 'João' },
  { numero: '5511777777777', nome: '' }
]))
fs.writeFileSync(path.join(dataDir, 'data', 'grupos.json'), JSON.stringify([
  { id: '120363000000000001@g.us', nome: 'Família' },
  { id: '120363000000000002@g.us', nome: 'Trabalho' }
]))

try {
  const service = criarDirectoryService({ obterRegistro: registroFixture, caminhoInstanciaFn, nomeContainerFn })

  const contatos = service.listarContatos('wa-000001')
  check('contatos: devolve os 3 registrados', contatos.items.length === 3)
  check('contatos: id sai na forma JID canônica, não o dígito cru', contatos.items[0].id === '5511999999999@s.whatsapp.net')
  check('contatos: kind é "contact"', contatos.items.every((c) => c.kind === 'contact'))
  check('contatos: sem próxima página (só 3 itens, limit default 50)', contatos.nextCursor === null)

  const busca = service.listarContatos('wa-000001', { q: 'mari' })
  check('contatos: busca por texto (case-insensitive) filtra certo', busca.items.length === 1 && busca.items[0].label === 'Maria')

  const pagina1 = service.listarContatos('wa-000001', { limit: 2 })
  check('contatos: respeita limit', pagina1.items.length === 2)
  check('contatos: devolve cursor quando há mais itens', pagina1.nextCursor !== null)
  const pagina2 = service.listarContatos('wa-000001', { limit: 2, cursor: pagina1.nextCursor })
  check('contatos: segunda página completa sem duplicar', pagina2.items.length === 1 && pagina2.nextCursor === null)

  const grupos = service.listarGrupos('wa-000001')
  check('grupos: devolve os 2 registrados', grupos.items.length === 2)
  check('grupos: id já é o JID de grupo, sem transformação', grupos.items[0].id === '120363000000000001@g.us')
  check('grupos: kind é "group"', grupos.items.every((g) => g.kind === 'group'))

  const viaListarGenerico = service.listar('wa-000001', { kind: 'group' })
  check('listar genérico: kind=group delega pra listarGrupos', viaListarGenerico.items.length === 2)

  let lancouKindInvalido = false
  try { service.listar('wa-000001', { kind: 'nada' }) } catch { lancouKindInvalido = true }
  check('listar genérico: kind inválido lança erro claro', lancouKindInvalido)

  let lancouInstanciaInexistente = false
  try { service.listarContatos('wa-999999') } catch (e) { lancouInstanciaInexistente = e instanceof InstanciaNaoEncontradaError }
  check('instância inexistente lança InstanciaNaoEncontradaError', lancouInstanciaInexistente)

  let lancouParaProto = false
  try { service.listarContatos('__proto__') } catch (e) { lancouParaProto = e instanceof InstanciaNaoEncontradaError }
  check('id "__proto__" nunca resolve pra um objeto herdado, sempre 404', lancouParaProto)
} finally {
  fs.rmSync(pastaTmp, { recursive: true, force: true })
}

// --- instância virtual "bare" (modo simples, sem registro nenhum) ---
const pastaTmpBare = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-agent-directory-bare-'))
const bareArqContatos = path.join(pastaTmpBare, 'contatos.json')
const bareArqGrupos = path.join(pastaTmpBare, 'grupos.json')
fs.writeFileSync(bareArqContatos, JSON.stringify([{ numero: '5511555555555', nome: 'Contato Bare' }]))
fs.writeFileSync(bareArqGrupos, JSON.stringify([{ id: '120363999999999999@g.us', nome: 'Grupo Bare' }]))

try {
  const serviceBare = criarDirectoryService({
    obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
    bareArqContatos,
    bareArqGrupos
  })
  const contatosBare = serviceBare.listarContatos('bare')
  check('listarContatos("bare"): lê o contatos.json do modo simples, não exige registro', contatosBare.items[0]?.label === 'Contato Bare')
  const gruposBare = serviceBare.listarGrupos('bare')
  check('listarGrupos("bare"): lê o grupos.json do modo simples', gruposBare.items[0]?.label === 'Grupo Bare')

  // --- segundo número do modo simples ------------------------------------
  // A tela LISTAVA a instância descoberta e a busca de contatos dela quebrava
  // com "Instância não encontrada": este serviço tinha a própria resolução, que
  // não conhecia a varredura por pasta. Agora reaproveita a mesma.
  const pastaOutro = path.join(pastaTmpBare, 'instancias', 'pessoal')
  fs.mkdirSync(pastaOutro, { recursive: true })
  fs.writeFileSync(path.join(pastaOutro, 'state.json'), JSON.stringify({ conectado: true, numero: '5599999999999' }))
  fs.writeFileSync(path.join(pastaOutro, 'contatos.json'), JSON.stringify([{ numero: '5511444444444', nome: 'Contato da Pessoal' }]))
  fs.writeFileSync(path.join(pastaOutro, 'grupos.json'), JSON.stringify([{ id: '120363111111111111@g.us', nome: 'Grupo da Pessoal' }]))

  const contatosOutro = serviceBare.listarContatos('simples:pessoal')
  check('contatos da instância descoberta vêm da pasta dela', contatosOutro.items[0]?.label === 'Contato da Pessoal', contatosOutro.items[0]?.label)
  const gruposOutro = serviceBare.listarGrupos('simples:pessoal')
  check('grupos da instância descoberta também', gruposOutro.items[0]?.label === 'Grupo da Pessoal')

  // Cada instância vê a AGENDA DELA — misturar seria mostrar contato de um
  // número na busca do outro.
  check('a agenda de uma não vaza na da outra', serviceBare.listarContatos('bare').items[0]?.label === 'Contato Bare')

  let erroInventada
  try { serviceBare.listarContatos('simples:nao-existe') } catch (e) { erroInventada = e }
  check('instância descoberta inexistente é recusada', !!erroInventada)

  let erroTravessia
  try { serviceBare.listarContatos('simples:../../etc') } catch (e) { erroTravessia = e }
  check('id com travessia de caminho é recusado', !!erroTravessia)
} finally {
  fs.rmSync(pastaTmpBare, { recursive: true, force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO DIRECTORY SERVICE PASSARAM')
process.exit(falhas ? 1 : 0)
