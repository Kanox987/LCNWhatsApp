// A ajuda da IDE sai da MESMA fonte que recusa o documento, ou não sai.
//
// `/api/v1/meta/linguagem` passou a carregar, por campo de cada ação, o tipo, a
// obrigatoriedade, os valores aceitos, o padrão e os limites. Nada disso é
// escrito à mão: tudo é DERIVADO do JSON Schema que o Ajv usa na instalação,
// pela ponte que já existia no glossário (`acharDefinicao`/`campoDoSchema`).
//
// Este arquivo é a guarda que faltava. Sem ela, a derivação pode parar de
// funcionar em silêncio — um campo novo no vocabulário sem campo no schema sai
// com `tipo: null`, a tela diz "aceita qualquer coisa", e a instalação recusa
// com 422 o valor que a ajuda prometeu. Verde por ausência de teste não é
// prova: é prova de que nenhum teste contradiz.
import fs from 'fs'
import { montarReferencia } from '../src/lcn/referencia.js'
import * as glossario from '../src/web/public/logic/acoes.js'
import { ACOES_SUPORTADAS } from '../src/engine/server/runtimeCapabilities.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const ref = montarReferencia({ prosa: glossario, schema })

// --- a junção fecha, ou a ajuda tem buraco ---------------------------------
const semDefinicao = ref.acoes.filter((a) => !glossario.acharDefinicao(schema, a.tipo)).map((a) => a.tipo)
check('toda ação da linguagem tem definição no schema', semDefinicao.length === 0, semDefinicao.join(', '))

const semTipo = []
let totalDeCampos = 0
for (const acao of ref.acoes) {
  for (const campo of acao.campos) {
    totalDeCampos++
    if (!campo.tipo) semTipo.push(`${acao.tipo}.${campo.chave}`)
  }
}
check('todo campo de ação sai com tipo derivado do schema', semTipo.length === 0, semTipo.join(', '))
check('e são os campos todos, não uma amostra', totalDeCampos > 150, `${totalDeCampos} campos`)

// --- o que o schema EXIGE é o que a ajuda diz que é obrigatório ------------
const obrigatorioTorto = []
const enumTorto = []
const limiteTorto = []
for (const acao of ref.acoes) {
  const def = glossario.acharDefinicao(schema, acao.tipo)
  const config = def?.properties?.config
  const exigidos = config?.required || []
  for (const campo of acao.campos) {
    const prop = config?.properties?.[campo.chave]
    if (!prop) continue
    if (campo.obrigatorio !== exigidos.includes(campo.chave)) obrigatorioTorto.push(`${acao.tipo}.${campo.chave}`)
    const doSchema = prop.enum || (prop.const !== undefined ? [prop.const] : null)
    const naAjuda = campo.valoresAceitos
    if (JSON.stringify(doSchema || null) !== JSON.stringify(naAjuda || null)) enumTorto.push(`${acao.tipo}.${campo.chave}`)
    for (const nome of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (prop[nome] !== undefined && campo.limites?.[nome] !== prop[nome]) limiteTorto.push(`${acao.tipo}.${campo.chave}.${nome}`)
    }
  }
}
check('obrigatoriedade na ajuda == required do schema', obrigatorioTorto.length === 0, obrigatorioTorto.join(', '))
check('lista fechada na ajuda == enum do schema', enumTorto.length === 0, enumTorto.join(', '))
check('limite na ajuda == mínimo/máximo do schema', limiteTorto.length === 0, limiteTorto.join(', '))

// Os limites são o que separa "aceita texto" de "aceita texto de 1 a 25
// caracteres". Se a derivação parar de trazê-los, este número cai. O piso é o
// que está derivado HOJE: o schema declara mais mínimos/máximos que isto, mas
// parte deles está em definições que não são ação (gatilho, condição, fluxo),
// e essas não entram na ajuda por campo de ação.
const comLimite = ref.acoes.flatMap((a) => a.campos).filter((c) => c.limites).length
check('a ajuda carrega os limites declarados', comLimite >= 30, `${comLimite} campos com mínimo ou máximo`)

const comEnum = ref.acoes.flatMap((a) => a.campos).filter((c) => c.valoresAceitos).length
check('a ajuda carrega as listas fechadas', comEnum >= 20, `${comEnum} campos com lista fechada`)

const comDescricao = ref.acoes.flatMap((a) => a.campos).filter((c) => c.explicacaoTecnica).length
check('a ajuda carrega a explicação escrita no schema', comDescricao >= 100, `${comDescricao} campos`)

// --- sem schema, nada quebra ----------------------------------------------
// A referência é montada fora do painel também (gerar documento, teste da
// linguagem). Ali não há glossário nem schema, e isso não é erro: é a razão de
// os dois entrarem injetados.
const nua = montarReferencia()
check('montarReferencia() sem argumento continua montando', nua.acoes.length === ref.acoes.length)
check('e sem schema o campo sai nulo, nunca inventado',
  nua.acoes.every((a) => a.campos.every((c) => c.tipo === null && c.limites === null && c.obrigatorio === null)))

// --- a divergência que a derivação expôs, registrada e vigiada ------------
// O schema define uma ação que `runtimeCapabilities` NÃO suporta. Ela não é
// executável: o publish recusa automação que declare ação fora da lista. Fica
// nomeada aqui para a próxima pessoa não achar que é descuido — e para uma
// SEGUNDA divergência derrubar o teste em vez de passar calada.
const DIVERGENCIA_CONHECIDA = ['action.http']
const noSchema = Object.values(schema.definitions)
  .map((d) => d?.properties?.type?.const)
  .filter((t) => typeof t === 'string' && t.startsWith('action.'))
const foraDasCapacidades = noSchema.filter((t) => !ACOES_SUPORTADAS.includes(t))
check('nenhuma ação nova do schema fica fora das capacidades sem registro',
  foraDasCapacidades.every((t) => DIVERGENCIA_CONHECIDA.includes(t)),
  foraDasCapacidades.filter((t) => !DIVERGENCIA_CONHECIDA.includes(t)).join(', '))
check('e a divergência registrada continua existindo (senão este bloco sai)',
  DIVERGENCIA_CONHECIDA.every((t) => noSchema.includes(t)))

// --- os três campos que o schema NÃO tem como declarar ------------------
// Os campos 10, 12 e 13 do pedido (de que a ação depende, o que ela devolve, e
// o erro mais comum) não são deriváveis: o schema valida ESTRUTURA, e "o bot
// precisa ser administrador do grupo" é pré-condição OPERACIONAL. Então são
// prosa no glossário — e prosa sem teste é prosa que desaparece na próxima
// edição sem ninguém notar, porque nenhum outro teste a lê.
const CURTO = 40
const semPrumo = ref.acoes.filter((a) =>
  typeof a.dependencias !== 'string' || a.dependencias.trim().length < CURTO ||
  typeof a.resultado !== 'string' || a.resultado.trim().length < CURTO ||
  typeof a.errosComuns !== 'string' || a.errosComuns.trim().length < CURTO)
check(`toda ação explica de que depende, o que devolve e como erra (${ref.acoes.length} ações)`,
  semPrumo.length === 0, semPrumo.map((a) => a.tipo).join(', '))

// E a prosa não pode ser a ressalva copiada: lista duplicada e divergente é
// exatamente o defeito que o pedido proíbe. Ela EXTENDE a ressalva, nunca a
// repete.
const copiada = ref.acoes.filter((a) => {
  const r = a.ressalva?.text
  if (!r) return false
  return [a.dependencias, a.resultado, a.errosComuns].some((p) => p && (p === r || r.includes(p)))
})
check('e nenhuma delas é a ressalva copiada',
  copiada.length === 0, copiada.map((a) => a.tipo).join(', '))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nA AJUDA DA LINGUAGEM BATE COM O SCHEMA')
process.exit(falhas ? 1 : 0)
