// Testes do ciclo de vida completo do acervo pela linguagem .lcn:
// apagar arquivo, criar arquivo de texto e sobrescrever preservando o id.
//
// Cobre o contrato nas quatro camadas:
//   1. Vocabulário (.lcn): compilar e descompilar preservando as 3 ações.
//   2. Capacidades e Schema: validação no schema e catalogação em acoes.js.
//   3. Motor (evaluator): geração dos comandos com interpolação e aviso consultivo.
//   4. Gateway (gatewayExecutor):
//      - criação de texto no acervo com orçamento de memória e envio como mensagem.
//      - sobrescrita de arquivo preservando o id estável e respeitando a cota.
//      - remoção de arquivo e tratamento de arquivo inexistente com erro claro.
//   5. Catálogo de templates: compilação dos templates criar-nota, atualizar-nota e apagar-arquivo.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { ACOES } from '../src/lcn/vocabulario.js'
import { ACOES_SUPORTADAS } from '../src/engine/server/runtimeCapabilities.js'
import { ACOES as ACOES_TELA, acharDefinicao } from '../src/web/public/logic/acoes.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'

let falhas = 0
const check = (nome, ok, extra) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`)
}

const canon = (v) => Array.isArray(v)
  ? v.map(canon)
  : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v
const mesmo = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

const CHAT = '5511999990000@s.whatsapp.net'
const POOL = 'pool-teste'

// --- 1. Vocabulário e Capacidades --------------------------------------------
check('ACOES_SUPORTADAS inclui action.acervo.delete', ACOES_SUPORTADAS.includes('action.acervo.delete'))
check('ACOES_SUPORTADAS inclui action.acervo.createText', ACOES_SUPORTADAS.includes('action.acervo.createText'))
check('ACOES_SUPORTADAS inclui action.acervo.rewrite', ACOES_SUPORTADAS.includes('action.acervo.rewrite'))

const defDelete = ACOES.find((a) => a.tipo === 'action.acervo.delete')
check('vocabulario define "apaga do acervo"', defDelete?.palavra === 'apaga do acervo')

const defCreate = ACOES.find((a) => a.tipo === 'action.acervo.createText')
check('vocabulario define "cria texto no acervo"', defCreate?.palavra === 'cria texto no acervo')

const defRewrite = ACOES.find((a) => a.tipo === 'action.acervo.rewrite')
check('vocabulario define "sobrescreve no acervo"', defRewrite?.palavra === 'sobrescreve no acervo')

// --- 2. Schema e Tela (acoes.js) ---------------------------------------------
const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))

const defSchemaDelete = acharDefinicao(schema, 'action.acervo.delete')
check('schema define actionAcervoDelete', !!defSchemaDelete)

const defSchemaCreate = acharDefinicao(schema, 'action.acervo.createText')
check('schema define actionAcervoCreateText', !!defSchemaCreate)

const defSchemaRewrite = acharDefinicao(schema, 'action.acervo.rewrite')
check('schema define actionAcervoRewrite', !!defSchemaRewrite)

const telaDelete = ACOES_TELA.find((a) => a.tipo === 'action.acervo.delete')
check('acoes.js cataloga action.acervo.delete', telaDelete?.rotulo === 'Apagar do acervo' && telaDelete?.familia === 'midia')

const telaCreate = ACOES_TELA.find((a) => a.tipo === 'action.acervo.createText')
check('acoes.js cataloga action.acervo.createText', telaCreate?.rotulo === 'Criar texto no acervo' && telaCreate?.familia === 'midia')

const telaRewrite = ACOES_TELA.find((a) => a.tipo === 'action.acervo.rewrite')
check('acoes.js cataloga action.acervo.rewrite', telaRewrite?.rotulo === 'Sobrescrever no acervo' && telaRewrite?.familia === 'midia')

// --- 3. Compilação e Descompilação (ida e volta) -----------------------------
{
  const lcnCria = [
    'automação',
    '  tipo: comando',
    '  dispara com: /recibo',
    '  onde: em qualquer lugar',
    '  pool: p1',
    '  acessa: texto',
    '  casa: exato',
    '  quem: só externos',
    '',
    '  cria texto no acervo "notas/recibo.txt"',
    '    conteúdo: "Total: R$ 150,00"',
    '    descrição: "Recibo de compra"',
    '    confirma: "Recibo criado em {{caminho}}"',
    '    erro: "Erro ao criar: {{erro}}"',
    ''
  ].join('\n')

  const compilado = compilar(lcnCria)
  check('compilar cria texto no acervo gera nó com type action.acervo.createText', compilado.flow.nodes[1]?.type === 'action.acervo.createText')
  check('campo path capturado da linha inline', compilado.flow.nodes[1]?.config?.path === 'notas/recibo.txt')
  check('campo text capturado de conteúdo', compilado.flow.nodes[1]?.config?.text === 'Total: R$ 150,00')

  const reescrito = descompilar(compilado)
  const recompilado = compilar(reescrito)
  check('ida e volta preserva cria texto no acervo', mesmo(compilado, recompilado))
}

{
  const lcnSobrescreve = [
    'automação',
    '  tipo: comando',
    '  dispara com: /atualizar',
    '  onde: em qualquer lugar',
    '  pool: p1',
    '  acessa: texto',
    '  casa: exato',
    '  quem: só externos',
    '',
    '  sobrescreve no acervo "cardapio.txt"',
    '    conteúdo: "Novo cardápio"',
    '    confirma: "Atualizado!"',
    '    sem arquivo: "Cardápio não encontrado."',
    '    erro: "Erro: {{erro}}"',
    ''
  ].join('\n')

  const compilado = compilar(lcnSobrescreve)
  check('compilar sobrescreve no acervo gera nó com type action.acervo.rewrite', compilado.flow.nodes[1]?.type === 'action.acervo.rewrite')
  check('campo path preservado', compilado.flow.nodes[1]?.config?.path === 'cardapio.txt')
  check('campo text preservado', compilado.flow.nodes[1]?.config?.text === 'Novo cardápio')

  const reescrito = descompilar(compilado)
  const recompilado = compilar(reescrito)
  check('ida e volta preserva sobrescreve no acervo', mesmo(compilado, recompilado))
}

{
  const lcnApaga = [
    'automação',
    '  tipo: comando',
    '  dispara com: /apagar',
    '  onde: em qualquer lugar',
    '  pool: p1',
    '  acessa: texto',
    '  casa: exato',
    '  quem: só externos',
    '',
    '  apaga do acervo "antigo.txt"',
    '    confirma: "Arquivo removido."',
    '    sem arquivo: "Arquivo não existe."',
    '    erro: "Falha: {{erro}}"',
    ''
  ].join('\n')

  const compilado = compilar(lcnApaga)
  check('compilar apaga do acervo gera nó com type action.acervo.delete', compilado.flow.nodes[1]?.type === 'action.acervo.delete')
  check('campo path capturado', compilado.flow.nodes[1]?.config?.path === 'antigo.txt')

  const reescrito = descompilar(compilado)
  const recompilado = compilar(reescrito)
  check('ida e volta preserva apaga do acervo', mesmo(compilado, recompilado))
}

// --- 4. Motor (evaluator) ----------------------------------------------------
{
  const db = abrirBanco(':memory:')
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool 1', agora, agora)

  function publicarComando (id, node) {
    const doc = {
      schemaVersion: 1, id, revision: 1, name: id, enabled: true,
      scope: { include: [{ kind: 'contact', id: CHAT }], exclude: [] },
      inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
      responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
      flow: {
        nodes: [
          { id: 'g', type: 'trigger.command', config: { command: `/${id}`, match: 'exact_or_args', allowFrom: 'external' } },
          { id: 'act', ...node }
        ],
        edges: [{ from: 'g', to: 'act', on: 'matched' }]
      }
    }
    db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
      .run(id, 'live', agora, agora)
    const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
      .run(id, 'active', JSON.stringify(doc), agora)
    db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
      .run(rev.lastInsertRowid, 'include', 'contact', CHAT)
    db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
  }

  publicarComando('cria', {
    type: 'action.acervo.createText',
    config: {
      path: 'notas/recibo-{{sender.number}}.txt',
      text: 'Recibo para {{sender.name}}: R$ 100',
      okText: 'Salvo em {{caminho}}'
    }
  })

  publicarComando('apaga', {
    type: 'action.acervo.delete',
    config: {
      path: 'notas/antigo.txt',
      okText: 'Apagado: {{caminho}}',
      notFoundText: 'Não achei o arquivo {{caminho}}.'
    }
  })

  publicarComando('sobrescreve', {
    type: 'action.acervo.rewrite',
    config: {
      path: 'notas/relatorio.txt',
      text: 'Dados novos: {{message.args}}',
      okText: 'Atualizado {{caminho}}',
      notFoundText: 'Arquivo {{caminho}} sumiu!'
    }
  })

  const eventoBase = (texto) => ({
    provider: 'zapo', accountId: 'acc-1', eventId: `e-${Date.now()}`,
    occurredAt: agora, replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, name: 'Alice', authoredBySelf: false },
    message: { kind: 'text', text: texto },
    providerRef: { remoteJid: CHAT, id: 'm-1' }
  })

  const resCria = avaliarEvento(db, eventoBase('/cria'))
  const cmdCria = resCria.results.find((r) => r.automationId === 'cria')?.commands?.[0]
  check('evaluator emite commandType acervo.createText', cmdCria?.commandType === 'acervo.createText')
  check('interpola variáveis no caminho e no texto', cmdCria?.payload?.caminho?.includes('recibo-') && cmdCria?.payload?.text?.includes('Alice'))

  const resApaga = avaliarEvento(db, eventoBase('/apaga'))
  const cmdApaga = resApaga.results.find((r) => r.automationId === 'apaga')?.commands?.[0]
  check('evaluator emite commandType acervo.delete', cmdApaga?.commandType === 'acervo.delete')
  check('repassa caminho a ser apagado', cmdApaga?.payload?.caminho === 'notas/antigo.txt' && cmdApaga?.payload?.notFoundText === 'Não achei o arquivo notas/antigo.txt.')

  const resSobrescreve = avaliarEvento(db, eventoBase('/sobrescreve novidades'))
  const cmdSobrescreve = resSobrescreve.results.find((r) => r.automationId === 'sobrescreve')?.commands?.[0]
  check('evaluator emite commandType acervo.rewrite', cmdSobrescreve?.commandType === 'acervo.rewrite')
  check('interpola texto da reescrita com argumentos', cmdSobrescreve?.payload?.text === 'Dados novos: novidades' && cmdSobrescreve?.payload?.notFoundText === 'Arquivo notas/relatorio.txt sumiu!')

  db.close()
}

// --- 5. Gateway (gatewayExecutor) com Acervo Real em Disco Isolado -----------
{
  const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-acervo-acoes-'))
  const acervo = await import('../src/mediaLibrary.js')
  acervo._usarPastaParaTeste(pastaTeste)

  let saldoOrcamento = 0
  const chamadasOrcamento = []
  const orcamentoMock = {
    adquirir (bytes) {
      chamadasOrcamento.push({ op: 'adquirir', bytes })
      saldoOrcamento += bytes
    },
    liberar (bytes) {
      chamadasOrcamento.push({ op: 'liberar', bytes })
      saldoOrcamento -= bytes
    },
    saldo: () => saldoOrcamento
  }

  function clienteFake () {
    const enviados = []
    return {
      enviados,
      getCredentials: () => ({ meJid: '5511999000000:1@s.whatsapp.net' }),
      message: { send: async (jid, conteudo, opcoes) => { enviados.push({ jid, conteudo, opcoes }); return { ok: true } } }
    }
  }

  const confirmacoes = []
  const engineFake = {
    confirmacoes,
    execucoes: {
      confirmar: async (id, dados) => {
        confirmacoes.push({ id, dados })
        return { ok: true }
      }
    }
  }
  const deps = {
    acervo,
    orcamento: orcamentoMock,
    limiteBytes: 10 * 1024 * 1024
  }

  // 5.1: Criação de arquivo de texto
  const c1 = clienteFake()
  const cmdCriar = {
    id: 'cmd-cria-1',
    commandType: 'acervo.createText',
    payload: {
      chatId: CHAT,
      caminho: 'recibos/compra.txt',
      text: 'Recibo #001: R$ 45,00',
      descricao: 'Recibo teste',
      okText: 'Arquivo {{caminho}} criado com id {{id}}'
    }
  }

  await executarComandos(c1, [cmdCriar], engineFake, deps)
  const arqSalvo = acervo.porCaminho('recibos/compra.txt')
  check('arquivo foi gravado no acervo físico', !!arqSalvo)
  check('tipo do arquivo gravado é text (kind text)', arqSalvo?.kind === 'text')
  check('mimetype é text/plain', arqSalvo?.mimetype === 'text/plain')
  check('conteúdo gravado confere no disco', fs.readFileSync(path.join(pastaTeste, 'arquivos', `${arqSalvo.id}.txt`), 'utf8') === 'Recibo #001: R$ 45,00')
  check('enviou mensagem de confirmação com variáveis substituídas', c1.enviados[0]?.conteudo?.text?.includes('recibos/compra.txt') && c1.enviados[0]?.conteudo?.text?.includes(arqSalvo.id))
  check('orçamento de memória adquiriu e liberou os bytes do texto', orcamentoMock.saldo() === 0 && chamadasOrcamento.some((c) => c.op === 'adquirir'))

  // 5.2: Envio do arquivo de texto criado via executarEnvioDeArquivo
  // O teste confere que kind: 'text' sai como MENSAGEM DE TEXTO, não como documento anexo
  const cEnvio = clienteFake()
  const cmdEnviar = {
    id: 'cmd-envia-1',
    commandType: 'whatsapp.sendFile',
    payload: {
      chatId: CHAT,
      caminho: 'recibos/compra.txt'
    }
  }
  await executarComandos(cEnvio, [cmdEnviar], engineFake, deps)
  check('envio de arquivo de texto sai como type "text" (mensagem direta)', cEnvio.enviados[0]?.conteudo?.type === 'text')
  check('texto enviado corresponde ao conteúdo do arquivo', cEnvio.enviados[0]?.conteudo?.text === 'Recibo #001: R$ 45,00')

  // 5.3: Sobrescrita de arquivo mantendo o ID
  const idOriginal = arqSalvo.id
  const c2 = clienteFake()
  const cmdSobrescrever = {
    id: 'cmd-reescreve-1',
    commandType: 'acervo.rewrite',
    payload: {
      chatId: CHAT,
      caminho: 'recibos/compra.txt',
      text: 'Recibo #001 atualizado: R$ 90,00',
      okText: 'Arquivo {{caminho}} atualizado!'
    }
  }

  await executarComandos(c2, [cmdSobrescrever], engineFake, deps)
  const arqAposReescrita = acervo.porCaminho('recibos/compra.txt')
  check('sobrescrever PRESERVA o id original', arqAposReescrita?.id === idOriginal)
  check('conteúdo atualizado foi gravado no disco', fs.readFileSync(path.join(pastaTeste, 'arquivos', `${idOriginal}.txt`), 'utf8') === 'Recibo #001 atualizado: R$ 90,00')
  check('tamanho atualizado no registro', arqAposReescrita?.sizeBytes === Buffer.byteLength('Recibo #001 atualizado: R$ 90,00'))
  check('saldo do orçamento continua equilibrado', orcamentoMock.saldo() === 0)

  // 5.4: Sobrescrita de arquivo inexistente -> avisa e lança erro (erro claro)
  const cErroSobrescrever = clienteFake()
  await executarComandos(cErroSobrescrever, [{
    id: 'cmd-reescreve-inexistente',
    commandType: 'acervo.rewrite',
    payload: {
      chatId: CHAT,
      caminho: 'fantasma.txt',
      text: 'algo',
      notFoundText: 'Arquivo fantasma.txt sumiu!'
    }
  }], engineFake, deps)

  const confirmouFalhaSobrescrita = confirmacoes.some((c) => c.id === 'cmd-reescreve-inexistente' && c.dados?.status === 'failed')
  check('sobrescrever arquivo inexistente lança erro (não cala falha)', confirmouFalhaSobrescrita)
  check('avisa via notFoundText na conversa', cErroSobrescrever.enviados[0]?.conteudo?.text === 'Arquivo fantasma.txt sumiu!')

  // 5.5: Remoção do arquivo (apagar)
  const c3 = clienteFake()
  const cmdApagar = {
    id: 'cmd-apaga-1',
    commandType: 'acervo.delete',
    payload: {
      chatId: CHAT,
      caminho: 'recibos/compra.txt',
      okText: 'Removido com sucesso: {{caminho}}'
    }
  }

  await executarComandos(c3, [cmdApagar], engineFake, deps)
  check('arquivo foi removido do índice do acervo', acervo.porCaminho('recibos/compra.txt') === null)
  check('arquivo físico foi apagado do disco', !fs.existsSync(path.join(pastaTeste, 'arquivos', `${idOriginal}.txt`)))
  check('mensagem de confirmação de remoção enviada', c3.enviados[0]?.conteudo?.text?.includes('recibos/compra.txt'))

  // 5.6: Apagar arquivo que não existe -> avisa e lança erro
  const cErroApagar = clienteFake()
  await executarComandos(cErroApagar, [{
    id: 'cmd-apaga-inexistente',
    commandType: 'acervo.delete',
    payload: {
      chatId: CHAT,
      caminho: 'ja-apagado.txt',
      notFoundText: 'Arquivo não encontrado para remoção.'
    }
  }], engineFake, deps)

  const confirmouFalhaApagar = confirmacoes.some((c) => c.id === 'cmd-apaga-inexistente' && c.dados?.status === 'failed')
  check('apagar arquivo inexistente lança erro', confirmouFalhaApagar)
  check('avisa pelo notFoundText', cErroApagar.enviados[0]?.conteudo?.text === 'Arquivo não encontrado para remoção.')

  fs.rmSync(pastaTeste, { recursive: true, force: true })
}

// --- 6. Catálogo de Templates ------------------------------------------------
{
  const catalogo = carregarCatalogo()
  check('catálogo inclui template criar-nota', catalogo.has('criar-nota'))
  check('catálogo inclui template atualizar-nota', catalogo.has('atualizar-nota'))
  check('catálogo inclui template apagar-arquivo', catalogo.has('apagar-arquivo'))

  const tCria = catalogo.get('criar-nota')
  check('criar-nota pertence à categoria utilitarios', tCria?.category === 'utilitarios')
  check('criar-nota usa action.acervo.createText', tCria?.documentTemplate?.flow?.nodes?.some((n) => n.type === 'action.acervo.createText'))

  const tAtualiza = catalogo.get('atualizar-nota')
  check('atualizar-nota pertence à categoria utilitarios', tAtualiza?.category === 'utilitarios')
  check('atualizar-nota usa action.acervo.rewrite', tAtualiza?.documentTemplate?.flow?.nodes?.some((n) => n.type === 'action.acervo.rewrite'))

  const tApaga = catalogo.get('apagar-arquivo')
  check('apagar-arquivo pertence à categoria utilitarios', tApaga?.category === 'utilitarios')
  check('apagar-arquivo usa action.acervo.delete', tApaga?.documentTemplate?.flow?.nodes?.some((n) => n.type === 'action.acervo.delete'))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE AÇÕES DO ACERVO PASSARAM')
process.exit(falhas ? 1 : 0)
