// Registro local de instâncias (~/.local/share/lcnwhatsapp/registry.json) —
// um arquivo JSON só, não SQLite: escrita rara (sempre disparada por humano
// via `lcn instances`), dataset pequeno mesmo em dezenas de instâncias.
// better-sqlite3 já existe no projeto, mas é pro store de sessão do Zapo
// (escrita frequente, precisa de transação de verdade) — não vale acoplar
// o registro a isso.
//
// Este módulo é só a camada de dados: ler/validar/escrever o registro e
// calcular os campos derivados de uma instância nova (id, caminhos, nome do
// container). Efeitos colaterais de verdade (mkdir, copiar config.example.json,
// gerar o unit Quadlet, chamar systemctl/podman) ficam em cli.js — mantém
// isto puro e fácil de testar sem tocar em processo nenhum.
import fs from 'fs'
import path from 'path'
import { ARQ_REGISTRO, PASTA_LCN, caminhoInstancia, caminhoUnit, nomeContainer } from './paths.js'

export const VERSAO_REGISTRO = 1

function registroVazio () {
  return { version: VERSAO_REGISTRO, nextSeq: 1, instances: {} }
}

// Sequencial (wa-000001, wa-000002, ...), não ULID — de propósito: é uma
// máquina só (sem risco de colisão entre hosts pra evitar) e um id curto é
// muito mais fácil de digitar em comando (`lcn instances stop wa-000003`).
export function formatarId (seq) {
  return `wa-${String(seq).padStart(6, '0')}`
}

function validar (bruto) {
  if (!bruto || typeof bruto !== 'object') return registroVazio()
  const instances = bruto.instances && typeof bruto.instances === 'object' ? bruto.instances : {}
  const nextSeq = Number.isInteger(bruto.nextSeq) && bruto.nextSeq > 0 ? bruto.nextSeq : 1
  return { version: VERSAO_REGISTRO, nextSeq, instances }
}

export function lerRegistro (caminho = ARQ_REGISTRO) {
  try {
    return validar(JSON.parse(fs.readFileSync(caminho, 'utf8')))
  } catch {
    return registroVazio()
  }
}

// Escrita atômica (arquivo temp + rename) — mesmo padrão de src/config.js/
// src/runtime.js: evita um crash no meio da escrita deixar registry.json
// truncado/corrompido (o registro é lido por qualquer invocação de
// `lcn instances`, corromper ele quebraria a ferramenta de gerência inteira).
export function salvarRegistro (registro, caminho = ARQ_REGISTRO) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true })
  const tmp = `${caminho}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(registro, null, 2) + '\n')
  fs.renameSync(tmp, caminho)
}

export function buscarPorTelefone (registro, telefoneE164) {
  if (!telefoneE164) return null
  return Object.values(registro.instances).find((i) => i.expectedPhoneE164 === telefoneE164) || null
}

export function buscarPorId (registro, id) {
  return registro.instances[id] || null
}

export function listarInstancias (registro) {
  return Object.values(registro.instances)
}

// Constrói o registro de uma instância nova e retorna { registro, instancia }
// — não muta o registro recebido (retorna um objeto novo), consistente com
// o resto do módulo sendo puro. Lança erro (sem side effect nenhum) se o
// telefone já está reivindicado por outra instância — é aqui que a
// unicidade é garantida, antes de qualquer diretório ser criado por cli.js.
export function adicionarInstancia (registro, { label, expectedPhoneE164, resources, transcricaoLocal } = {}) {
  if (expectedPhoneE164) {
    const existente = buscarPorTelefone(registro, expectedPhoneE164)
    if (existente) {
      throw new Error(`Telefone ${expectedPhoneE164} já está em uso pela instância ${existente.instanceId}`)
    }
  }

  const id = formatarId(registro.nextSeq)
  const instancia = {
    instanceId: id,
    label: label || id,
    expectedPhoneE164: expectedPhoneE164 || null,
    dataDir: caminhoInstancia(id),
    unitFile: caminhoUnit(id),
    containerName: nomeContainer(id),
    resources: { memory: resources?.memory ?? null, cpus: resources?.cpus ?? null },
    transcricaoLocal: { instalada: !!transcricaoLocal?.instalada, modelo: transcricaoLocal?.modelo || 'base' },
    createdAt: new Date().toISOString()
  }

  const novoRegistro = {
    ...registro,
    nextSeq: registro.nextSeq + 1,
    instances: { ...registro.instances, [id]: instancia }
  }
  return { registro: novoRegistro, instancia }
}

// Retorna um registro novo sem a instância — não apaga nada em disco (isso
// é responsabilidade de cli.js, que decide se remove ou só desregistra).
export function removerInstancia (registro, id) {
  const { [id]: _removida, ...resto } = registro.instances
  return { ...registro, instances: resto }
}

// Reconstrói o registro do zero varrendo instance.json de cada diretório —
// usado por `lcn instances rebuild-registry` se registry.json se perder/
// corromper. Cada instance.json já carrega os campos essenciais (é a
// "fonte de verdade que viaja com a instância", redundante de propósito
// com o registro central).
export function reconstruirDeInstanceJsons (pastaInstancias, lerJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))) {
  const registro = registroVazio()
  let entradas = []
  try {
    entradas = fs.readdirSync(pastaInstancias, { withFileTypes: true })
  } catch {
    return registro
  }
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue
    const arqInstancia = path.join(pastaInstancias, entrada.name, 'instance.json')
    if (!fs.existsSync(arqInstancia)) continue
    try {
      const dados = lerJson(arqInstancia)
      if (!dados?.instanceId) continue
      registro.instances[dados.instanceId] = {
        instanceId: dados.instanceId,
        label: dados.label || dados.instanceId,
        expectedPhoneE164: dados.expectedPhoneE164 || null,
        dataDir: caminhoInstancia(dados.instanceId),
        unitFile: caminhoUnit(dados.instanceId),
        containerName: nomeContainer(dados.instanceId),
        resources: dados.resources || { memory: null, cpus: null },
        transcricaoLocal: dados.transcricaoLocal || { instalada: false, modelo: 'base' },
        createdAt: dados.createdAt || new Date().toISOString()
      }
      const seq = parseInt(dados.instanceId.replace(/^wa-/, ''), 10)
      if (Number.isFinite(seq) && seq >= registro.nextSeq) registro.nextSeq = seq + 1
    } catch { /* instance.json corrompido — pula, não derruba o rebuild inteiro */ }
  }
  return registro
}

export { PASTA_LCN }
