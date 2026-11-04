// §8: "os pacotes reais devem ser derivados das capacidades existentes e dos
// recursos que forem implementados. Não apresente uma funcionalidade como
// disponível quando ela depender de um serviço ausente."
//
// Estes casos guardam a camada ESTÁTICA do pacote — a que não escreve no banco
// e por isso pode ser provada sem instância nenhuma. O que eles impedem:
//
//  · composição que mente: pacote oferecendo template que o catálogo não tem,
//    ou que depende de serviço que `prontas.js` não declara;
//  · substituição silenciosa de receita: versão fixada que o catálogo mudou;
//  · deriva invisível: template editado sem subir `templateVersion`, ou
//    dependência transitiva nova entrando sem ninguém revisar.
import fs from 'fs'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import {
  carregarPacotes, resolverPacote, montarTrava, lerTrava,
  conexoesDoTemplate, hashCanonico, PASTA_PACOTES
} from '../src/engine/templates/pacotes.js'
import { CONEXOES_PRONTAS } from '../src/engine/server/conexoes/prontas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const recusa = (nome, fn, pedaco) => {
  try { fn(); check(nome, false, 'não lançou') } catch (erro) {
    check(nome, erro.message.includes(pedaco), erro.message)
  }
}

const catalogo = carregarCatalogo()
const pacotes = carregarPacotes()

// ---------------------------------------------------------------- composição

check('os quatro pacotes de §8 existem', pacotes.size === 4, [...pacotes.keys()].join(', '))
for (const id of ['basico', 'atendimento', 'administracao', 'protecao']) {
  check(`pacote "${id}" carregado`, pacotes.has(id))
}

// Resolver cada pacote contra o catálogo é o caso principal, e ele falha com
// MENSAGEM em vez de rastro de pilha: quem editar um template e esquecer de
// subir a versão precisa ler o que está errado, não onde o teste quebrou.
const resolvidos = new Map()
for (const id of pacotes.keys()) {
  try {
    resolvidos.set(id, resolverPacote(catalogo, pacotes.get(id)))
  } catch (erro) {
    check(`pacote "${id}" resolve contra o catálogo`, false, erro.message)
  }
}
if (resolvidos.size !== pacotes.size) {
  console.log(`\n${falhas} FALHA(S)\n`)
  process.exit(1)
}

// Dependência de template NÃO está escrita no manifesto: ela é resolvida pelo
// `dependsOn` do `.lcn`, pelo mesmo caminhador que a instalação usa. Se um dia
// alguém listar a dependência à mão, o membro continua único — mas estes dois
// casos provam que a resolução é quem a traz.
const basico = resolvidos.get('basico')
const menu = basico.membros.find((m) => m.templateId === 'menu')
const configMenu = basico.membros.find((m) => m.templateId === 'config-menu')
check('basico resolve config-menu como dependência', configMenu?.origem === 'dependencia')
check('config-menu NÃO está escrito no manifesto', !pacotes.get('basico').items.some((i) => i.templateId === 'config-menu'))
check('a dependência vem ANTES de quem depende dela',
  basico.membros.indexOf(configMenu) < basico.membros.indexOf(menu))
check('menu entra como item pedido, fixado em v2', menu?.origem === 'pedido' && menu?.templateVersion === 2)

const atendimento = resolvidos.get('atendimento')
const devolver = atendimento.membros.find((m) => m.templateId === 'devolver-ao-bot')
check('atendimento resolve devolver-ao-bot como dependência', devolver?.origem === 'dependencia')
check('atendimento tem 7 membros (6 pedidos + 1 dependência)', atendimento.membros.length === 7, String(atendimento.membros.length))

// ------------------------------------------------- serviço ausente, §8 direto

const conexoesDeclaradas = new Set(CONEXOES_PRONTAS.map((c) => c.id))
check('prontas.js declara midia e imagem', conexoesDeclaradas.has('midia') && conexoesDeclaradas.has('imagem'))

for (const [id, resolvido] of resolvidos) {
  const ausentes = resolvido.conexoesExigidas.filter((c) => !conexoesDeclaradas.has(c))
  check(`pacote "${id}" não depende de serviço ausente`, ausentes.length === 0, ausentes.join(', '))
}

// E a derivação tem de estar VIVA, não só devolvendo vazio por acidente: um
// template que chama serviço de verdade precisa aparecer com a conexão dele.
const comConexao = [...catalogo.values()].filter((t) => conexoesDoTemplate(t).length > 0)
check('a derivação acha templates que chamam serviço', comConexao.length >= 30, String(comConexao.length))
check('figurinha-api exige a conexão imagem',
  conexoesDoTemplate(catalogo.get('figurinha-api')).join(',') === 'imagem')
check('clima exige a conexão clima, que NÃO está declarada',
  conexoesDoTemplate(catalogo.get('clima')).join(',') === 'clima' && !conexoesDeclaradas.has('clima'))

// ------------------------------------------------------------------- recusas

const comVersaoErrada = {
  ...pacotes.get('basico'),
  // `menu` está em v2 no catálogo. Fixar v1 é pedir uma receita que não existe
  // mais: o pacote reprova em vez de instalar a v2 calado (D-26).
  items: pacotes.get('basico').items.map((i) => (i.templateId === 'menu' ? { ...i, templateVersion: 1 } : i))
}
recusa('versão fixada que o catálogo não tem reprova',
  () => resolverPacote(catalogo, comVersaoErrada), 'e o catálogo tem v2')

const comTemplateRemovido = {
  ...pacotes.get('protecao'),
  items: [...pacotes.get('protecao').items, { itemKey: 'fantasma', templateId: 'nao-existe-mesmo', templateVersion: 1 }]
}
recusa('template referenciado que não existe reprova',
  () => resolverPacote(catalogo, comTemplateRemovido), 'Template não encontrado no catálogo')

const comTemplateRepetido = {
  ...pacotes.get('protecao'),
  items: [...pacotes.get('protecao').items, { itemKey: 'anti-link-de-novo', templateId: 'anti-link', templateVersion: 1 }]
}
recusa('o mesmo template em dois itens do pacote reprova',
  () => resolverPacote(catalogo, comTemplateRepetido), 'aparece em dois itens')

// Uma dependência resolvida usa o próprio templateId como chave. Se um item
// pedido escolher essa mesma chave para OUTRO template, a ligação entre
// manifesto e automação instalada ficaria ambígua.
const comChaveColidindo = {
  ...pacotes.get('basico'),
  items: pacotes.get('basico').items.map((i) => (i.templateId === 'ping' ? { ...i, itemKey: 'config-menu' } : i))
}
recusa('chave de item colidindo com dependência resolvida reprova',
  () => resolverPacote(catalogo, comChaveColidindo), 'serve a dois membros')

// -------------------------------------------------------- trava sem deriva

const travaGravada = lerTrava()
check('a trava revisada está versionada no repositório', travaGravada !== null)
const travaCalculada = montarTrava(catalogo, pacotes)
// Comparação por hash canônico, não por `JSON.stringify` dos dois lados: a
// trava vem de arquivo, e a ordem das chaves no arquivo não é contrato.
check('a trava gravada bate com a composição do catálogo vivo',
  hashCanonico(travaCalculada) === hashCanonico(travaGravada),
  'rode `npm run pacotes:trava` e revise o diff: template mudou, versão subiu, ou dependência nova entrou')

// O hash é de conteúdo canônico, então tem de ser estável entre execuções —
// senão o caso acima acusaria deriva que não existe, como já aconteceu neste
// projeto com um `IGUAL? false` que era só ordem de chave.
check('o hash canônico é estável entre duas execuções',
  hashCanonico(catalogo.get('ping')) === hashCanonico(catalogo.get('ping')))
check('o hash ignora a ordem das chaves',
  hashCanonico({ a: 1, b: { c: 2, d: 3 } }) === hashCanonico({ b: { d: 3, c: 2 }, a: 1 }))
check('o hash muda quando o conteúdo muda',
  hashCanonico({ a: 1 }) !== hashCanonico({ a: 2 }))

// --------------------------------------------- o esquema guarda o manifesto

const arquivos = fs.readdirSync(PASTA_PACOTES).filter((n) => n.endsWith('.json'))
check('o esquema do manifesto está ao lado dos manifestos', arquivos.includes('pacote.schema.json'))
check('a trava está ao lado dos manifestos', arquivos.includes('pacotes.lock.json'))
check('nenhum manifesto a mais entrou sem teste', arquivos.length === 6, arquivos.join(', '))

console.log(falhas === 0
  ? '\nOS PACOTES DE §8 NÃO PROMETEM O QUE O CATÁLOGO NÃO TEM\n'
  : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
