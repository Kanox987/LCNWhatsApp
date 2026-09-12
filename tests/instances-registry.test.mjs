// src/instances/registry.js — camada de dados do registro de múltiplas
// instâncias (Parte A do plano). Usa um arquivo temporário via os.tmpdir(),
// nunca o ~/.local/share/lcnwhatsapp real, pra não arriscar mexer em dados
// de uma instalação de verdade da máquina que roda o teste.
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  formatarId,
  lerRegistro,
  salvarRegistro,
  adicionarInstancia,
  removerInstancia,
  buscarPorTelefone,
  buscarPorId,
  listarInstancias,
  reconstruirDeInstanceJsons
} from '../src/instances/registry.js'

let falhas = 0
const check = (nome, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
  if (!ok) console.log(`   exp=${JSON.stringify(exp)} got=${JSON.stringify(got)}`)
}
const checkBool = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

check('formatarId zero-preenche até 6 dígitos', formatarId(1), 'wa-000001')
check('formatarId não trunca números grandes', formatarId(123456), 'wa-123456')

// lerRegistro num caminho inexistente devolve um registro vazio válido, não lança.
const arqTmp = path.join(os.tmpdir(), `lcn-registry-test-${process.pid}-${Date.now()}.json`)
const registroVazio = lerRegistro(arqTmp)
check('registro inexistente vira vazio válido', registroVazio, { version: 1, nextSeq: 1, instances: {} })

// Adicionar instância aloca id sequencial e não muta o registro original.
const { registro: r1, instancia: inst1 } = adicionarInstancia(registroVazio, { label: 'Suporte', expectedPhoneE164: '+5511999999999' })
checkBool('adicionarInstancia não muta o registro original', Object.keys(registroVazio.instances).length === 0)
check('primeira instância recebe id wa-000001', inst1.instanceId, 'wa-000001')
check('label preservado', inst1.label, 'Suporte')
check('telefone preservado', inst1.expectedPhoneE164, '+5511999999999')
check('nextSeq avança pra 2', r1.nextSeq, 2)

const { registro: r2, instancia: inst2 } = adicionarInstancia(r1, { label: 'Vendas' })
check('segunda instância recebe id wa-000002', inst2.instanceId, 'wa-000002')
check('sem telefone informado vira null (não undefined/string vazia)', inst2.expectedPhoneE164, null)

// Unicidade de telefone — recusa antes de criar qualquer coisa.
let lancouErroTelefoneDuplicado = false
try {
  adicionarInstancia(r2, { label: 'Duplicada', expectedPhoneE164: '+5511999999999' })
} catch (e) {
  lancouErroTelefoneDuplicado = /wa-000001/.test(e.message)
}
checkBool('recusa telefone já usado por outra instância, mensagem cita o id existente', lancouErroTelefoneDuplicado)

check('buscarPorTelefone acha a instância certa', buscarPorTelefone(r2, '+5511999999999')?.instanceId, 'wa-000001')
check('buscarPorTelefone com telefone inexistente retorna null', buscarPorTelefone(r2, '+5500000000000'), null)
check('buscarPorId acha por id', buscarPorId(r2, 'wa-000002')?.label, 'Vendas')
check('listarInstancias retorna as duas', listarInstancias(r2).map((i) => i.instanceId).sort(), ['wa-000001', 'wa-000002'])

// Persistência — grava e relê do disco de verdade (arquivo temporário).
salvarRegistro(r2, arqTmp)
const relido = lerRegistro(arqTmp)
check('registro relido do disco bate com o que foi salvo', relido, r2)
checkBool('arquivo temp de escrita atômica não sobra no diretório', !fs.existsSync(`${arqTmp}.tmp`))

// removerInstancia tira só a instância pedida, sem mexer nas outras.
const r3 = removerInstancia(r2, 'wa-000001')
check('instância removida some da lista', Object.keys(r3.instances).sort(), ['wa-000002'])
checkBool('remover não muta o registro original', Object.keys(r2.instances).length === 2)

// reconstruirDeInstanceJsons — rebuild a partir de instance.json espalhados,
// sem tocar no filesystem de verdade (injeta um leitor fake).
const pastaFake = '/fake/instances'
const instanceJsons = {
  [`${pastaFake}/wa-000005/instance.json`]: { instanceId: 'wa-000005', label: 'Recuperada', createdAt: '2026-01-01T00:00:00Z' }
}
const leitorFake = (p) => {
  if (!instanceJsons[p]) throw new Error('ENOENT')
  return instanceJsons[p]
}
// Como reconstruirDeInstanceJsons também chama fs.readdirSync de verdade,
// isso só testa o caminho de "pasta não existe" (retorna vazio sem lançar)
// — a varredura real de diretório fica coberta pela verificação manual do
// plano (rodar `lcn instances rebuild-registry` de verdade).
const registroReconstruidoVazio = reconstruirDeInstanceJsons(pastaFake, leitorFake)
check('pasta de instâncias inexistente não lança, devolve registro vazio', registroReconstruidoVazio, { version: 1, nextSeq: 1, instances: {} })

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO REGISTRO DE INSTÂNCIAS PASSARAM')
process.exit(falhas ? 1 : 0)
