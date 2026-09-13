// Carrega e valida o catálogo de templates (Parte C, Módulo 4 do plano) e
// resolve a árvore `dependsOn` numa ordem de instalação segura (dependência
// sempre antes de quem depende dela), detectando ciclo — mesmo algoritmo
// (DFS com "visitando"/"visitados") já usado em server/validate.js pra
// ciclo de fluxo de automação, aqui reaplicado pro grafo de dependência
// entre templates.
import fs from 'fs'
import path from 'path'
import Ajv from 'ajv'
import { fileURLToPath } from 'url'

const PASTA_TEMPLATES = path.dirname(fileURLToPath(import.meta.url))
const PASTA_CATALOGO = path.join(PASTA_TEMPLATES, 'catalog')
const arquivoSchema = path.join(PASTA_TEMPLATES, 'template.schema.json')
const schemaTemplate = JSON.parse(fs.readFileSync(arquivoSchema, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true })
const validarSchemaTemplate = ajv.compile(schemaTemplate)

function carregarArquivo (pastaCatalogo, nomeArquivo) {
  const bruto = JSON.parse(fs.readFileSync(path.join(pastaCatalogo, nomeArquivo), 'utf8'))
  if (!validarSchemaTemplate(bruto)) {
    const detalhe = validarSchemaTemplate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')
    throw new Error(`Template inválido em ${nomeArquivo}: ${detalhe}`)
  }
  return bruto
}

// Carregado uma vez por processo — o catálogo é conteúdo versionado no
// próprio repositório (não editável pelo usuário final), igual ao schema
// de automação em server/schema/automation.v1.schema.json. `pastaCatalogo`
// injetável só pra teste (catálogo de fixture isolado, nunca o real).
export function carregarCatalogo ({ pastaCatalogo = PASTA_CATALOGO } = {}) {
  if (!fs.existsSync(pastaCatalogo)) return new Map()
  const catalogo = new Map()
  for (const nomeArquivo of fs.readdirSync(pastaCatalogo).filter((n) => n.endsWith('.json')).sort()) {
    const template = carregarArquivo(pastaCatalogo, nomeArquivo)
    if (catalogo.has(template.templateId)) throw new Error(`templateId duplicado no catálogo: ${template.templateId}`)
    catalogo.set(template.templateId, template)
  }
  return catalogo
}

export function obterTemplate (catalogo, templateId) {
  const template = catalogo.get(templateId)
  if (!template) throw new Error(`Template não encontrado no catálogo: ${templateId}.`)
  return template
}

// DFS pós-ordem: um template só entra na lista depois de TODAS as suas
// dependências — ordem já pronta pra instalar em sequência (ou dentro de
// uma única transação, ver automationsService.criarEPublicar).
export function resolverOrdemInstalacao (catalogo, templateIdRaiz) {
  const ordem = []
  const visitando = new Set()
  const visitados = new Set()

  function visitar (templateId) {
    if (visitados.has(templateId)) return
    if (visitando.has(templateId)) {
      throw new Error(`Ciclo de dependência detectado envolvendo o template "${templateId}".`)
    }
    const template = obterTemplate(catalogo, templateId)
    visitando.add(templateId)
    for (const dependencia of template.dependsOn || []) visitar(dependencia)
    visitando.delete(templateId)
    visitados.add(templateId)
    ordem.push(templateId)
  }

  visitar(templateIdRaiz)
  return ordem
}
