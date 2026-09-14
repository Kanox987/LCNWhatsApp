import http from 'http'
import { EventEmitter } from 'events'
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { criarClienteEngine } from '../src/engine/client.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })

async function capturarErro (method, pathname, body) {
  try {
    await api.resolver(method, pathname, contexto(body))
    return null
  } catch (erro) {
    return erro
  }
}

try {
  const base = '/entities/contact/5511999%40s.whatsapp.net/attributes'
  const vazio = await api.resolver('GET', base, contexto())
  check('GET começa vazio antes de qualquer atributo', Array.isArray(vazio) && vazio.length === 0)
  const indices = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name))
  check('migration cria o índice de busca por escopo', indices.has('idx_entity_attributes_scope'))

  const criado = await api.resolver('PUT', `${base}/vip`, contexto({ value: true }))
  check('PUT grava um atributo novo', criado.key === 'vip' && criado.value === true)

  const depoisDeCriar = await api.resolver('GET', base, contexto())
  check('GET reflete o atributo gravado', depoisDeCriar.length === 1 && depoisDeCriar[0].key === 'vip' && depoisDeCriar[0].value === true)

  const atualizado = await api.resolver('PUT', `${base}/vip`, contexto({ value: { nivel: 2 } }))
  check('segundo PUT atualiza o valor existente', atualizado.value?.nivel === 2)
  const depoisDeAtualizar = await api.resolver('GET', base, contexto())
  check('GET reflete o valor atualizado', depoisDeAtualizar[0]?.value?.nivel === 2)

  const nulo = await api.resolver('PUT', `${base}/opcional`, contexto({ value: null }))
  check('null explícito é aceito como valor', nulo.value === null)

  const baseGrupo = '/entities/group/120363000%40g.us/attributes'
  await api.resolver('PUT', `${baseGrupo}/categoria`, contexto({ value: 'equipe' }))
  const atributosGrupo = await api.resolver('GET', baseGrupo, contexto())
  check('CRUD também mantém atributos isolados por grupo', atributosGrupo[0]?.value === 'equipe' && atributosGrupo.length === 1)

  const removido = await api.resolver('DELETE', `${base}/vip`, contexto())
  check('DELETE remove o atributo', removido.removed === true && removido.key === 'vip')
  const depoisDeRemover = await api.resolver('GET', base, contexto())
  check('GET não traz o atributo removido', !depoisDeRemover.some((item) => item.key === 'vip'))

  const erroRemover = await capturarErro('DELETE', `${base}/inexistente`)
  check('DELETE de chave inexistente retorna 404', erroRemover?.status === 404)
  const erroKind = await capturarErro('GET', '/entities/channel/abc/attributes')
  check('kind inválido retorna 400', erroKind?.status === 400)
  const erroAusente = await capturarErro('PUT', `${base}/sem-valor`, {})
  check('PUT sem a propriedade value retorna 400', erroAusente?.status === 400)

  const variaveis = await api.resolver('GET', '/meta/variables', contexto())
  const exemplos = variaveis.builtIn.map((v) => v.example)
  check('meta documenta as variáveis do evento e o caso reservado',
    exemplos.includes('{{message.text}}') && exemplos.includes('{{sender.id}}') && exemplos.includes('{{chat.id}}') &&
    variaveis.reserved[0]?.placeholder === '{{latencyMs}}')
  check('meta documenta o alvo do comando (@mencionado ou respondido)', exemplos.includes('{{target.id}}'))
  check('meta documenta os escopos de variável, inclusive o do alvo no grupo',
    exemplos.includes('{{var.member.avisos}}') && exemplos.includes('{{var.targetMember.avisos}}') &&
    exemplos.includes('{{var.global.total}}') && exemplos.some((e) => e.startsWith('{{var.category.')))
  // Variável de usuário aparece com um endereço só. Documentar um apelido
  // sem escopo no nome ensinaria a forma que esconde de quem é o valor.
  check('não documenta apelido de variável sem escopo', variaveis.builtIn.every((v) => v.namespace !== 'custom'))

  const requisicoes = []
  const requestOriginal = http.request
  http.request = (options, callback) => {
    const req = new EventEmitter()
    req.end = (conteudo) => {
      requisicoes.push({ options, conteudo: conteudo?.toString('utf8') })
      const res = new EventEmitter()
      res.statusCode = 200
      callback(res)
      queueMicrotask(() => {
        res.emit('data', Buffer.from('{}'))
        res.emit('end')
      })
    }
    return req
  }
  try {
    const cliente = criarClienteEngine({ socketPath: '/tmp/socket-nao-utilizado.sock' })
    await cliente.entidades.listar('contact', '55/1')
    await cliente.entidades.definir('group', 'grupo@id', 'categoria vip', { nivel: 3 })
    await cliente.entidades.remover('group', 'grupo@id', 'categoria vip')
    await cliente.meta.obterVariaveis()
  } finally {
    http.request = requestOriginal
  }
  check('cliente monta a rota de listagem com parâmetros codificados', requisicoes[0]?.options?.path === '/entities/contact/55%2F1/attributes')
  check('cliente envia PUT de atributo com value no corpo', requisicoes[1]?.options?.method === 'PUT' && requisicoes[1]?.options?.path === '/entities/group/grupo%40id/attributes/categoria%20vip' && requisicoes[1]?.conteudo === '{"value":{"nivel":3}}')
  check('cliente envia DELETE de atributo', requisicoes[2]?.options?.method === 'DELETE' && requisicoes[2]?.options?.path === '/entities/group/grupo%40id/attributes/categoria%20vip')
  check('cliente consulta a documentação de variáveis', requisicoes[3]?.options?.path === '/meta/variables')
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado nos testes de atributos:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ATRIBUTOS PASSARAM')
process.exit(falhas ? 1 : 0)
