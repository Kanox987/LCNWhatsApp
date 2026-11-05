// Perfil de provisionamento: o arquivo que descreve o que uma instância já
// nasce tendo (pacotes, templates avulsos, escopo, parâmetros, pools).
//
// Este módulo é PURO: lê, valida, normaliza, calcula o hash e traduz o perfil
// nas escolhas que `provisionar` já entende. Não toca no banco — quem aplica é
// `aplicacaoDePerfil.js`.
//
// POR QUE NÃO REAPROVEITAR O MANIFESTO DE PACOTE: o manifesto fixa
// `packageVersion`/`templateVersion` (é uma RECEITA); o perfil é uma ESCOLHA
// ("estes pacotes, estes templates, neste escopo"). Misturar os dois faria o
// perfil herdar a regra de versão exata, que não faz sentido para quem só
// quer dizer "instale o pacote de administração".
//
// Perfil vazio é válido de propósito: instância limpa, o cliente configura.
import fs from 'fs'
import path from 'path'
import Ajv from 'ajv'
import { fileURLToPath } from 'url'
import { ErroHttp } from './transport.js'
import { hashCanonico, resolverPacote } from '../templates/pacotes.js'

const PASTA = path.dirname(fileURLToPath(import.meta.url))
// O destino de escopo é o MESMO do documento de automação: tipo novo de escopo
// entra no schema de lá e o perfil passa a aceitá-lo sem segunda lista.
const { definitions: { scopeRef } } = JSON.parse(
  fs.readFileSync(path.join(PASTA, 'schema', 'automation.v1.schema.json'), 'utf8')
)

export const LIMITE_DO_ARQUIVO = 256 * 1024
export const VERSAO_DO_SCHEMA = 1

// Sem `..` nem barra por construção: o id nunca vira caminho, mas o padrão
// fechado impede que um dia alguém o use como tal.
const ID = '^[A-Za-z0-9][A-Za-z0-9_-]{0,78}$'
const listaDeIds = { type: 'array', uniqueItems: true, items: { type: 'string', pattern: ID } }
const valorDeParametro = { type: ['string', 'number', 'boolean'] }

const schemaDoPerfil = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'profileId', 'profileVersion'],
  definitions: { scopeRef },
  properties: {
    schemaVersion: { const: VERSAO_DO_SCHEMA },
    profileId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$' },
    profileVersion: { type: 'integer', minimum: 1 },
    packageIds: listaDeIds,
    templateIds: listaDeIds,
    scope: {
      type: 'object',
      additionalProperties: false,
      required: ['include'],
      properties: {
        include: { type: 'array', items: { $ref: '#/definitions/scopeRef' } },
        exclude: { type: 'array', items: { $ref: '#/definitions/scopeRef' } }
      }
    },
    deploymentMode: { enum: ['live', 'shadow'] },
    pools: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label'],
        properties: {
          id: { type: 'string', pattern: ID },
          label: { type: 'string', minLength: 1, maxLength: 80 }
        }
      }
    },
    parametrosComuns: { type: 'object', additionalProperties: valorDeParametro },
    parameters: { type: 'object', additionalProperties: { type: 'object', additionalProperties: valorDeParametro } }
  }
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validarSchema = ajv.compile(schemaDoPerfil)

function recusar (mensagem, erros) {
  const erro = new ErroHttp(400, mensagem)
  if (erros) erro.detalhes = { erros }
  return erro
}

// Aceita o texto do arquivo ou o objeto já lido. Devolve o perfil NORMALIZADO
// (padrões preenchidos): o hash é calculado sobre ele, então escrever um
// padrão por extenso não conta como mudar o perfil.
export function lerPerfil (entrada) {
  let bruto = entrada
  if (typeof entrada === 'string') {
    if (Buffer.byteLength(entrada, 'utf8') > LIMITE_DO_ARQUIVO) {
      throw recusar(`O perfil passa de ${LIMITE_DO_ARQUIVO} bytes.`)
    }
    try { bruto = JSON.parse(entrada) } catch (erro) { throw recusar(`O perfil não é JSON válido: ${erro.message}`) }
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw recusar('O perfil precisa ser um objeto JSON.')
  if (!validarSchema(bruto)) {
    const erros = validarSchema.errors.map((e) => `${e.instancePath || '/'} ${e.message}`)
    throw recusar(`Perfil inválido: ${erros.join('; ')}.`, erros)
  }
  const perfil = {
    schemaVersion: bruto.schemaVersion,
    profileId: bruto.profileId,
    profileVersion: bruto.profileVersion,
    packageIds: bruto.packageIds ?? [],
    templateIds: bruto.templateIds ?? [],
    scope: { include: bruto.scope?.include ?? [], exclude: bruto.scope?.exclude ?? [] },
    deploymentMode: bruto.deploymentMode ?? 'live',
    pools: bruto.pools ?? [],
    parametrosComuns: bruto.parametrosComuns ?? {},
    parameters: bruto.parameters ?? {}
  }
  return { perfil, hash: hashCanonico(perfil) }
}

export const perfilEhVazio = (perfil) => perfil.packageIds.length === 0 && perfil.templateIds.length === 0

// A parte que depende do catálogo: o schema só prova a FORMA. Diagnóstico
// completo de uma vez (e não "o primeiro que falha"), porque quem escreve um
// perfil de onze itens não quer descobrir os erros um por tentativa.
export function validarContraCatalogo (perfil, { catalogo, pacotes }) {
  const erros = []
  const membrosDosPacotes = new Map()
  for (const packageId of perfil.packageIds) {
    const manifesto = pacotes.get(packageId)
    if (!manifesto) { erros.push(`Pacote não encontrado: ${packageId}.`); continue }
    try {
      for (const m of resolverPacote(catalogo, manifesto).membros) {
        if (m.origem === 'pedido') membrosDosPacotes.set(m.templateId, packageId)
      }
    } catch (erro) {
      erros.push(`Pacote "${packageId}" não é instalável: ${erro.message}`)
    }
  }
  for (const templateId of perfil.templateIds) {
    if (!catalogo.get(templateId)) { erros.push(`Template não encontrado no catálogo: ${templateId}.`); continue }
    if (membrosDosPacotes.has(templateId)) {
      erros.push(`O template "${templateId}" já faz parte do pacote "${membrosDosPacotes.get(templateId)}"; tire-o de templateIds.`)
    }
  }
  if (!perfilEhVazio(perfil) && perfil.scope.include.length === 0) {
    erros.push('scope.include não pode ser vazio quando o perfil instala algo: lista vazia nunca significa "todos" — escreva { "kind": "everywhere" } se é isso que se quer.')
  }
  const idsDePool = new Set()
  for (const pool of perfil.pools) {
    if (idsDePool.has(pool.id)) erros.push(`Pool repetido no perfil: ${pool.id}.`)
    idsDePool.add(pool.id)
  }
  // Parâmetro para um template que o perfil não instala é quase sempre erro de
  // digitação, e silenciá-lo faria o valor nunca ser usado sem ninguém notar.
  const instalados = new Set([...membrosDosPacotes.keys(), ...perfil.templateIds])
  for (const templateId of Object.keys(perfil.parameters)) {
    if (!instalados.has(templateId)) erros.push(`parameters cita "${templateId}", que o perfil não instala.`)
  }
  if (erros.length) throw recusar(`Perfil inválido: ${erros.join(' ')}`, erros)
}

// O perfil vira as chamadas de `provisionar` que ele significa: um pacote por
// chamada (a API aceita UM packageId) e os templates avulsos numa só. O
// escopo, o modo e os parâmetros valem para todas.
export function escolhasDoPerfil (perfil) {
  const comum = {
    scope: perfil.scope,
    deploymentMode: perfil.deploymentMode,
    parametrosComuns: perfil.parametrosComuns,
    parameters: perfil.parameters
  }
  if (perfilEhVazio(perfil)) return [{ kind: 'vazia' }]
  const escolhas = perfil.packageIds.map((packageId) => ({ kind: 'pacote', packageId, ...comum }))
  if (perfil.templateIds.length) escolhas.push({ kind: 'especificas', templateIds: perfil.templateIds, ...comum })
  return escolhas
}

// Política administrativa: o que o OPERADOR permite que um perfil peça. Ela
// vive fora do perfil de propósito — quem escreve o perfil não pode ser quem
// decide o limite dele. Ausente = permite tudo; não há número fixo no código.
const schemaDaPolitica = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion'],
  properties: {
    schemaVersion: { const: VERSAO_DO_SCHEMA },
    allowedPackageIds: listaDeIds,
    allowedTemplateIds: listaDeIds
  }
}
const validarSchemaDaPolitica = ajv.compile(schemaDaPolitica)

export function lerPolitica (entrada) {
  let bruto = entrada
  if (typeof entrada === 'string') {
    if (Buffer.byteLength(entrada, 'utf8') > LIMITE_DO_ARQUIVO) throw recusar(`A política passa de ${LIMITE_DO_ARQUIVO} bytes.`)
    try { bruto = JSON.parse(entrada) } catch (erro) { throw recusar(`A política não é JSON válido: ${erro.message}`) }
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw recusar('A política precisa ser um objeto JSON.')
  if (!validarSchemaDaPolitica(bruto)) {
    throw recusar(`Política inválida: ${validarSchemaDaPolitica.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}.`)
  }
  return { allowedPackageIds: bruto.allowedPackageIds ?? null, allowedTemplateIds: bruto.allowedTemplateIds ?? null }
}

// `allowedPackageIds` limita `packageIds` e `allowedTemplateIds` limita
// `templateIds`. Os membros de um pacote permitido e as dependências de um
// template valem por herança: o operador autorizou o pacote, não cada peça.
// Excedeu: o perfil INTEIRO falha, nunca é cortado em silêncio.
export function aplicarPolitica (perfil, politica) {
  if (!politica) return
  const erros = []
  if (politica.allowedPackageIds) {
    for (const id of perfil.packageIds) {
      if (!politica.allowedPackageIds.includes(id)) erros.push(`A política não permite o pacote "${id}".`)
    }
  }
  if (politica.allowedTemplateIds) {
    for (const id of perfil.templateIds) {
      if (!politica.allowedTemplateIds.includes(id)) erros.push(`A política não permite o template "${id}".`)
    }
  }
  if (erros.length) {
    const erro = new ErroHttp(409, `${erros.join(' ')} O perfil não foi aplicado.`)
    erro.detalhes = { erros, politica: true }
    throw erro
  }
}
