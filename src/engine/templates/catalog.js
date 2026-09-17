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
import { compilar } from '../../lcn/compilar.js'

const PASTA_TEMPLATES = path.dirname(fileURLToPath(import.meta.url))
const PASTA_CATALOGO = path.join(PASTA_TEMPLATES, 'catalog')
const arquivoSchema = path.join(PASTA_TEMPLATES, 'template.schema.json')
const schemaTemplate = JSON.parse(fs.readFileSync(arquivoSchema, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true })
const validarSchemaTemplate = ajv.compile(schemaTemplate)

// O catálogo é escrito em `.lcn` — a mesma linguagem que o painel mostra ao
// editar. Um formato só para o comando, do arquivo à tela.
//
// O JSON continua sendo a forma EXECUTADA: o `.lcn` compila para ele aqui, no
// carregamento, e a partir daí nada mais no sistema sabe que a linguagem
// existe. O motor não ganhou um interpretador — ganhou um formato de arquivo.
//
// A validação de schema continua valendo depois de compilar, pelo mesmo motivo
// de sempre: o compilador pode ter um defeito, e o portão não pode depender de
// quem ele guarda.
function carregarArquivo (pastaCatalogo, nomeArquivo) {
  const texto = fs.readFileSync(path.join(pastaCatalogo, nomeArquivo), 'utf8')
  let compilado
  try {
    compilado = compilar(texto)
  } catch (erro) {
    throw new Error(`Template inválido em ${nomeArquivo}: ${erro.message}`)
  }
  if (!compilado?.template) {
    throw new Error(`Template inválido em ${nomeArquivo}: falta o cabeçalho "template <id> v<n>".`)
  }
  const bruto = { ...compilado.template, documentTemplate: compilado.documentTemplate }
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
  for (const nomeArquivo of fs.readdirSync(pastaCatalogo).filter((n) => n.endsWith('.lcn')).sort()) {
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
