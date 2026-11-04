// Manifestos de pacote: a composição declarada de um "pacote pronto" do
// provisionamento (§8 — pacote básico, de atendimento, de administração, de
// proteção). Este módulo NÃO publica nada: ele só lê, valida e resolve. É
// por isso que ele pode existir antes da decisão de isolamento do motor —
// nenhuma escrita acontece aqui.
//
// Três invariantes que ele existe para provar, e que estão em DECISIONS.md:
//
//   D-26  versão fixada que o catálogo não tem REPROVA. O catálogo guarda uma
//         versão por templateId, então "quase a mesma receita" não serve:
//         trocar a receita por outra sem dizer é pior do que recusar.
//   D-27  dependência de SERVIÇO não se escreve no manifesto — ela é derivada
//         do próprio `.lcn`. Lista à mão envelhece em silêncio.
//   D-31  dependência de TEMPLATE também não se escreve: `dependsOn` já existe
//         e `resolverOrdemInstalacao` já resolve. O manifesto diz o que o
//         cliente PEDIU; a resolução diz o que vai ser instalado.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Ajv from 'ajv'
import { fileURLToPath } from 'url'
import { obterTemplate, resolverOrdemInstalacao } from './catalog.js'

const PASTA_TEMPLATES = path.dirname(fileURLToPath(import.meta.url))
export const PASTA_PACOTES = path.join(PASTA_TEMPLATES, 'pacotes')
export const ARQUIVO_TRAVA = path.join(PASTA_PACOTES, 'pacotes.lock.json')

const arquivoSchema = path.join(PASTA_PACOTES, 'pacote.schema.json')
const schemaPacote = JSON.parse(fs.readFileSync(arquivoSchema, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const validarSchemaPacote = ajv.compile(schemaPacote)

// JSON canônico: chaves ordenadas em toda profundidade. Sem isso o hash
// mudaria por ordem de propriedade, e a deriva detectada seria falsa — foi
// exatamente o que já aconteceu neste projeto com um `IGUAL? false` que era
// só ordem de chave.
export function canonizar (valor) {
  if (Array.isArray(valor)) return valor.map(canonizar)
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const chave of Object.keys(valor).sort()) saida[chave] = canonizar(valor[chave])
    return saida
  }
  return valor
}

export function hashCanonico (valor) {
  return crypto.createHash('sha256').update(JSON.stringify(canonizar(valor))).digest('hex')
}

// A conexão exigida sai do fluxo compilado, não de prosa. `connectionRef` é
// obrigatório em `action.connection.call` pelo schema de automação, e no
// catálogo ele é sempre `{{params.X}}` — então o id efetivo é o padrão do
// parâmetro, que é o que o cliente recebe se não mexer em nada.
export function conexoesDoTemplate (template) {
  const exigidas = new Set()
  for (const no of template.documentTemplate?.flow?.nodes || []) {
    if (no.type !== 'action.connection.call') continue
    const ref = no.config?.connectionRef
    if (typeof ref !== 'string' || !ref) continue
    const placeholder = /^\{\{params\.([A-Za-z0-9_]+)\}\}$/.exec(ref)
    if (!placeholder) { exigidas.add(ref); continue }
    const parametro = (template.parameters || []).find((p) => p.key === placeholder[1])
    if (parametro && typeof parametro.default === 'string' && parametro.default) {
      exigidas.add(parametro.default)
    } else {
      // Sem padrão, quem instala escolhe. Não dá para prometer nem recusar.
      exigidas.add(`?${placeholder[1]}`)
    }
  }
  return [...exigidas].sort()
}

export function carregarPacotes ({ pastaPacotes = PASTA_PACOTES } = {}) {
  const pacotes = new Map()
  if (!fs.existsSync(pastaPacotes)) return pacotes
  const arquivos = fs.readdirSync(pastaPacotes)
    .filter((n) => n.endsWith('.json') && n !== 'pacote.schema.json' && n !== 'pacotes.lock.json')
    .sort()
  for (const nomeArquivo of arquivos) {
    let manifesto
    try {
      manifesto = JSON.parse(fs.readFileSync(path.join(pastaPacotes, nomeArquivo), 'utf8'))
    } catch (erro) {
      throw new Error(`Manifesto inválido em ${nomeArquivo}: ${erro.message}`)
    }
    if (!validarSchemaPacote(manifesto)) {
      const detalhe = validarSchemaPacote.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')
      throw new Error(`Manifesto inválido em ${nomeArquivo}: ${detalhe}`)
    }
    if (manifesto.packageId !== path.basename(nomeArquivo, '.json')) {
      throw new Error(`Manifesto inválido em ${nomeArquivo}: o packageId "${manifesto.packageId}" não bate com o nome do arquivo.`)
    }
    if (pacotes.has(manifesto.packageId)) throw new Error(`packageId duplicado nos manifestos: ${manifesto.packageId}`)
    const vistos = new Set()
    for (const item of manifesto.items) {
      if (vistos.has(item.itemKey)) {
        throw new Error(`Manifesto inválido em ${nomeArquivo}: itemKey duplicado "${item.itemKey}".`)
      }
      vistos.add(item.itemKey)
    }
    pacotes.set(manifesto.packageId, manifesto)
  }
  return pacotes
}

// Resolve o manifesto contra um catálogo concreto. Lança — não devolve aviso —
// quando a composição não é satisfazível, porque um pacote que não instala por
// inteiro não deve ser oferecido como opção na tela.
export function resolverPacote (catalogo, manifesto) {
  const membros = []
  const porTemplate = new Map()

  const registrar = (templateId, itemKey, origem) => {
    const existente = porTemplate.get(templateId)
    if (existente) {
      // Mesmo template pedido duas vezes dentro do MESMO pacote: instalar duas
      // automações do mesmo template com escopo igual seria conflito de comando.
      if (existente.origem === 'pedido' && origem === 'pedido') {
        throw new Error(`Pacote "${manifesto.packageId}": o template "${templateId}" aparece em dois itens ("${existente.itemKey}" e "${itemKey}").`)
      }
      // Dependência que também foi pedida explicitamente continua UM membro só,
      // e o pedido explícito é quem nomeia a chave.
      if (origem === 'pedido') { existente.origem = 'pedido'; existente.itemKey = itemKey }
      return
    }
    const template = obterTemplate(catalogo, templateId)
    const membro = {
      itemKey,
      templateId,
      templateVersion: template.templateVersion,
      origem,
      contentHash: hashCanonico(template),
      conexoesExigidas: conexoesDoTemplate(template)
    }
    porTemplate.set(templateId, membro)
    membros.push(membro)
  }

  for (const item of manifesto.items) {
    // obterTemplate lança "Template não encontrado no catálogo" — é o cenário
    // "template referenciado foi removido → falha na validação do pacote".
    const template = obterTemplate(catalogo, item.templateId)
    if (template.templateVersion !== item.templateVersion) {
      throw new Error(`Pacote "${manifesto.packageId}": o item "${item.itemKey}" fixa ${item.templateId} v${item.templateVersion}, e o catálogo tem v${template.templateVersion}. Versão fixada indisponível reprova — o pacote não substitui a receita em silêncio.`)
    }
    // Pós-ordem: a dependência entra ANTES de quem depende dela, pronto para
    // instalar em sequência dentro de uma transação só.
    const ordem = resolverOrdemInstalacao(catalogo, item.templateId)
    for (const templateId of ordem) {
      if (templateId === item.templateId) registrar(templateId, item.itemKey, 'pedido')
      else registrar(templateId, templateId, 'dependencia')
    }
  }

  const chaves = new Set()
  for (const membro of membros) {
    if (chaves.has(membro.itemKey)) {
      throw new Error(`Pacote "${manifesto.packageId}": a chave "${membro.itemKey}" serve a dois membros. Uma dependência resolvida usa o próprio templateId como chave, então renomeie o item que colide.`)
    }
    chaves.add(membro.itemKey)
  }

  const conexoesExigidas = [...new Set(membros.flatMap((m) => m.conexoesExigidas))].sort()
  return {
    packageId: manifesto.packageId,
    packageVersion: manifesto.packageVersion,
    name: manifesto.name,
    membros,
    conexoesExigidas
  }
}

// A trava é revisada à mão e versionada: ela é a afirmação "esta composição é
// a que eu conferi". O teste de deriva recalcula e compara, então template que
// muda sem subir a versão aparece como hash diferente, e dependência
// transitiva acrescentada aparece como membro novo.
export function montarTrava (catalogo, pacotes) {
  const travados = {}
  for (const packageId of [...pacotes.keys()].sort()) {
    const resolvido = resolverPacote(catalogo, pacotes.get(packageId))
    travados[packageId] = {
      packageVersion: resolvido.packageVersion,
      conexoesExigidas: resolvido.conexoesExigidas,
      membros: resolvido.membros.map((m) => ({
        itemKey: m.itemKey,
        templateId: m.templateId,
        templateVersion: m.templateVersion,
        origem: m.origem,
        contentHash: m.contentHash
      }))
    }
  }
  return { versaoDaTrava: 1, pacotes: travados }
}

export function lerTrava ({ arquivo = ARQUIVO_TRAVA } = {}) {
  if (!fs.existsSync(arquivo)) return null
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'))
}
