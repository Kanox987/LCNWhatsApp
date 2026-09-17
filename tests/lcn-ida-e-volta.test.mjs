// A linguagem `.lcn` tem que representar TUDO que o motor executa.
//
// Este arquivo existe por causa de um problema concreto: a tela de criação do
// painel monta uma forma só (um comando que responde um texto), e as automações
// instaladas estão todas fora dela — o /ping inclusive. Elas abriam em somente
// leitura porque a tela não consegue REPRESENTÁ-LAS, não porque editar fosse
// perigoso.
//
// O caso que vale por todos é a ida e volta: pegar cada template do catálogo,
// virar texto, voltar a documento, e o documento precisa ser o MESMO. Se a
// linguagem perder um campo pelo caminho, editar pelo texto apagaria esse campo
// em silêncio — exatamente o defeito que o modo somente-leitura evita hoje.
import fs from 'fs'
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { ACOES } from '../src/lcn/vocabulario.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'
import { ACOES_SUPORTADAS } from '../src/engine/server/runtimeCapabilities.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// Ordem de chave em objeto JSON não é informação — o que precisa bater é o
// significado.
const canon = (v) => Array.isArray(v)
  ? v.map(canon)
  : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v
const mesmo = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

// --- ida e volta com TODO o catálogo -------------------------------------
// O catálogo agora É .lcn. A ida e volta que importa passou a ser a do
// carregador: o arquivo compila, e compilar de novo o texto que ele gera
// devolve a mesma coisa. Se a linguagem perdesse um campo, o template
// instalaria diferente do que está escrito.
const { carregarCatalogo } = await import('../src/engine/templates/catalog.js')
const catalogoLcn = [...carregarCatalogo().values()]
check('o catálogo tem templates para exercitar', catalogoLcn.length >= 20, String(catalogoLcn.length))

for (const template of catalogoLcn) {
  const documento = renderizarTemplate(template, Object.fromEntries(
    (template.parameters || []).filter((p) => p.default === undefined || p.default === null).map((p) => [p.key, 'x1'])
  ))
  documento.id = template.templateId
  documento.revision = 1

  let volta, erro
  try { volta = compilar(descompilar(documento)) } catch (e) { erro = e }
  if (erro) { check(`${template.templateId}: ida e volta`, false, erro.message); continue }
  check(`${template.templateId}: o documento volta igual`, mesmo(documento, volta),
    mesmo(documento, volta) ? '' : primeiraDiferenca(documento, volta))
}

function primeiraDiferenca (a, b) {
  const ca = canon(a); const cb = canon(b)
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
    const x = JSON.stringify(ca[k]); const y = JSON.stringify(cb[k])
    if (x !== y) return `${k}: era ${String(x).slice(0, 120)} / veio ${String(y).slice(0, 120)}`
  }
  return ''
}

// --- o TEMPLATE inteiro também volta igual -------------------------------
// Um template é mais que o documento: carrega o formulário que quem instala
// preenche, as variáveis que o comando usa e os avisos. Se a linguagem perdesse
// o formulário, converter os templates para .lcn transformaria comando
// configurável em comando fixo — sem ninguém notar até tentar instalar.
{
  const { carregarCatalogo } = await import('../src/engine/templates/catalog.js')
  const catalogo = [...carregarCatalogo().values()]
  check('o catálogo carrega', catalogo.length >= 20, String(catalogo.length))

  let iguais = 0
  const problemas = []
  for (const t of catalogo) {
    try {
      const volta = compilar(descompilar(t.documentTemplate, t))
      const reconstruido = { ...volta.template, documentTemplate: volta.documentTemplate }
      if (mesmo(t, reconstruido)) iguais++
      else problemas.push(`${t.templateId}: ${primeiraDiferenca(t, reconstruido)}`)
    } catch (e) {
      problemas.push(`${t.templateId}: ${e.message}`)
    }
  }
  check('todo template do catálogo vira .lcn e volta IGUAL',
    iguais === catalogo.length, problemas.slice(0, 3).join(' | '))
}

// --- o formulário declarado no .lcn --------------------------------------
// É o que deixa quem NÃO programa configurar o comando pelo painel: quem
// escreve declara o esquema, quem usa preenche.
{
  const { template } = compilar(`template exemplo v1
  nome: Exemplo
  descrição: Mostra os quatro tipos de configuração
  categoria: utilitarios

comando /exemplo
  nome: Exemplo
  onde: em qualquer lugar
  pool: p1
  tipos: texto
  casa: exato
  de: externo

  responde "oi"

configurável
  frase: texto = "olá"
    rótulo: O que responder
    ajuda: Escreva o que quiser
  limite: número = 3
    rótulo: Quantas vezes
  formato: opção (texto, botões) = texto
    rótulo: Como mostrar
  ligado: liga/desliga = sim
    rótulo: Começa ligado?
`)
  const porChave = Object.fromEntries(template.parameters.map((p) => [p.key, p]))
  check('digitar livremente vira texto', porChave.frase?.type === 'string' && porChave.frase.default === 'olá')
  check('número mantém o tipo', porChave.limite?.type === 'number' && porChave.limite.default === 3,
    JSON.stringify(porChave.limite))
  check('escolher da lista guarda as opções',
    porChave.formato?.type === 'enum' && JSON.stringify(porChave.formato.options) === '["texto","botões"]',
    JSON.stringify(porChave.formato))
  check('liga/desliga vira booleano', porChave.ligado?.type === 'boolean' && porChave.ligado.default === true,
    JSON.stringify(porChave.ligado))
  check('o rótulo do formulário chega', porChave.frase?.label === 'O que responder')
  check('a ajuda do formulário chega', porChave.frase?.help === 'Escreva o que quiser')
}

// --- bloco de template em arquivo que não é template é RECUSADO ----------
// Cair num objeto descartado perderia a configuração inteira em silêncio: o
// formulário simplesmente não apareceria, e ninguém saberia por quê.
{
  let e
  try {
    compilar(`comando /x
  nome: X
  onde: em qualquer lugar
  pool: p
  tipos: texto
  casa: exato
  de: externo

  responde "oi"

configurável
  a: texto = "b"
`)
  } catch (erro) { e = erro }
  check('bloco de template fora de template é recusado',
    e instanceof ErroDeSintaxe && /só existe em arquivo de template/.test(e.message), e?.message)
}

// --- toda ação que o motor executa tem palavra na linguagem --------------
// Sem isto, uma ação nova nasce impossível de escrever — o mesmo defeito que
// deixou `sendFile` invisível no painel por semanas.
{
  const naLinguagem = new Set(ACOES.map((a) => a.tipo))
  const faltando = [...ACOES_SUPORTADAS].filter((t) => !naLinguagem.has(t))
  check('toda ação executável tem palavra na linguagem', faltando.length === 0, faltando.join(', '))

  const suportadas = new Set(ACOES_SUPORTADAS)
  const sobrando = [...naLinguagem].filter((t) => !suportadas.has(t))
  check('a linguagem não oferece ação que o motor não executa', sobrando.length === 0, sobrando.join(', '))
}

// --- o texto é legível por gente -----------------------------------------
{
  const doc = compilar(`comando /oi
  id: oi
  nome: Saudação
  onde: em qualquer lugar
  pool: p1
  tipos: texto
  casa: exato
  de: externo

  responde "olá!"
`)
  check('um .lcn escrito à mão compila', doc.flow.nodes.length === 2)
  check('o gatilho sai certo', doc.flow.nodes[0].type === 'trigger.command' && doc.flow.nodes[0].config.command === '/oi')
  check('a ação sai certa', doc.flow.nodes[1].type === 'action.whatsapp.reply' && doc.flow.nodes[1].config.text === 'olá!')
  check('a aresta liga gatilho e ação', doc.flow.edges.length === 1 && doc.flow.edges[0].on === 'matched')
  // Sem rodapé de nomes, o compilador gera — quem escreve automação não pensa
  // em id de nó.
  check('os nós ganham nome sozinhos', doc.flow.nodes.every((n) => typeof n.id === 'string' && n.id.length > 0),
    JSON.stringify(doc.flow.nodes.map((n) => n.id)))
}

// --- condição com dois ramos ---------------------------------------------
{
  const doc = compilar(`comando /alterna
  id: alterna
  nome: Alterna
  onde: em qualquer lugar
  pool: p1
  tipos: texto
  casa: exato
  de: externo
  só dono

  se var chat ligado == "sim"
    define chat ligado = ""
    responde "desliguei"
  senão
    define chat ligado = "sim"
    responde "liguei"
`)
  const tipos = doc.flow.nodes.map((n) => n.type)
  check('a condição vira condition.compare', tipos.includes('condition.compare'))
  check('os dois ramos existem',
    doc.flow.edges.some((e) => e.on === 'true') && doc.flow.edges.some((e) => e.on === 'false'))
  check('cada ramo encadeia as ações com "success"',
    doc.flow.edges.filter((e) => e.on === 'success').length === 2,
    JSON.stringify(doc.flow.edges))
  check('"só dono" chega ao gatilho', doc.flow.nodes[0].config.requireOwner === true)
}

// --- erro de escrita é RECUSADO, com a linha ------------------------------
// Um `.lcn` que compila "mais ou menos" produziria automação que salva, publica
// e não faz o que está escrito.
{
  const casos = [
    ['', 'arquivo vazio'],
    ['responde "oi"', 'começa com'],
    ['comando /x\n  nomee: errado\n', 'não conheço o campo'],
    ['comando /x\n  casa: torto\n', 'modo de casamento desconhecido'],
    ['comando /x\n  onde: no além\n', 'destino desconhecido'],
    ['comando /x\n  tipos: hologramas\n', 'tipo de mensagem desconhecido'],
    ['comando /x\n\n  dança "oi"\n', 'não conheço a ação'],
    ['comando /x\n\n  responde sem aspas\n', 'esperava texto entre aspas'],
    ['comando /x\n\n  responde "oi"\n    cor: "azul"\n', 'não tem campo'],
    ['comando /x\n\n  se var chat a b\n', 'precisa de um operador']
  ]
  for (const [fonte, esperado] of casos) {
    let e
    try { compilar(fonte) } catch (erro) { e = erro }
    check(`recusa: ${esperado}`, e instanceof ErroDeSintaxe && e.message.includes(esperado),
      e ? e.message : '(não recusou)')
  }

  let comLinha
  try { compilar('comando /x\n  nomee: errado\n') } catch (e) { comLinha = e }
  check('o erro diz em que linha está', /linha 2/.test(comLinha?.message || ''), comLinha?.message)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DA LINGUAGEM PASSARAM')
process.exit(falhas ? 1 : 0)
