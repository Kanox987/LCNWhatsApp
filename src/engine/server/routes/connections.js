import fs from 'fs'
import os from 'os'
import { ErroHttp, resposta } from '../transport.js'
import { ARQ_CONFIG } from '../../../paths.js'
import { ErroDeDeclaracao, validarConfiguracao } from '../conexoes/declaracao.js'
import { CONEXOES_PRONTAS } from '../conexoes/prontas.js'
import { ID_GLOBAL } from '../attributeScopes.js'

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

// O SEGREDO NUNCA SAI POR AQUI.
//
// O dono reverteu, com motivo, a regra antiga de o token viver só num arquivo:
// "vai ter que colar pelo painel, os clientes não vão ter acesso ao terminal se
// eu ou outra pessoa alugar o sistema". Isso torna o segredo GRAVÁVEL pelo
// painel — e não muda nada sobre ele ser LEGÍVEL, que continua não sendo.
//
// A tela precisa de duas informações para ser útil: se existe segredo, e quais
// credenciais a conexão guarda. Os NOMES dos campos servem a isso e não são o
// segredo; os valores nunca atravessam esta função.
// A credencial RESOLVE? — sem nunca ler o valor.
//
// Existem duas origens, e as duas precisam de resposta honesta. A chave colada
// está no banco; a de arquivo está no disco, e dizer "falta a chave" só porque
// o banco está vazio seria mentir — foi exatamente o que a tela fez: apontou
// falta numa chave que existia e funcionava.
//
// Só o FATO sai daqui (existe, está vazio, não achei o arquivo). O conteúdo
// nunca é devolvido em nenhuma das duas origens.
function estadoDaCredencial (config, segredo) {
  const auth = config?.autenticacao || { tipo: 'nenhuma' }
  if (auth.tipo === 'nenhuma') return { necessaria: false, resolvida: true, origem: 'nenhuma' }

  if (auth.origem === 'arquivo') {
    const caminho = String(auth.arquivo || '').replace(/^~/, os.homedir())
    try {
      const conteudo = fs.readFileSync(caminho, 'utf8').trim()
      return conteudo
        ? { necessaria: true, resolvida: true, origem: 'arquivo', arquivo: auth.arquivo }
        : { necessaria: true, resolvida: false, origem: 'arquivo', arquivo: auth.arquivo, motivo: 'o arquivo está vazio' }
    } catch {
      return { necessaria: true, resolvida: false, origem: 'arquivo', arquivo: auth.arquivo, motivo: 'não consegui ler o arquivo' }
    }
  }

  const campos = segredo && typeof segredo === 'object' && !Array.isArray(segredo) ? Object.keys(segredo) : []
  return campos.length
    ? { necessaria: true, resolvida: true, origem: 'colada' }
    : { necessaria: true, resolvida: false, origem: 'colada', motivo: 'nenhuma chave foi colada ainda' }
}

function expor (row) {
  if (!row) return null
  const segredo = jsonOuNull(row.secret_json)
  const campos = segredo && typeof segredo === 'object' && !Array.isArray(segredo) ? Object.keys(segredo) : []
  const config = jsonOuNull(row.config_json)
  return {
    id: row.id,
    kind: row.kind,
    config,
    segredoDefinido: campos.length > 0,
    camposDeSegredo: campos,
    credencial: estadoDaCredencial(config, segredo),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function exigirTexto (body, campo) {
  const valor = body?.[campo]
  if (typeof valor !== 'string' || !valor.trim()) throw new ErroHttp(400, `Campo obrigatório: ${campo}.`)
  return valor.trim()
}

// Conexão com endereço ou funções é conexão declarada, e passa pela validação
// inteira. Guardar a forma NORMALIZADA (e não o que veio no corpo) é o que faz
// quem lê depois ver exatamente o que vai ser executado.
function configuracaoValidada (kind, config) {
  const declarada = kind === 'http' || (config && (config.endereco || config.funcoes))
  if (!declarada) return config ?? null
  try {
    return validarConfiguracao(config)
  } catch (erro) {
    if (erro instanceof ErroDeDeclaracao) throw new ErroHttp(400, erro.message)
    throw erro
  }
}

function segredoValidado (secret) {
  if (secret === null || secret === undefined) return null
  if (typeof secret !== 'object' || Array.isArray(secret)) {
    throw new ErroHttp(400, 'O segredo é um objeto de campos, por exemplo { "token": "..." }.')
  }
  for (const [chave, valor] of Object.entries(secret)) {
    if (typeof valor !== 'string') {
      throw new ErroHttp(400, `O segredo "${chave}" precisa ser texto.`)
    }
  }
  return Object.keys(secret).length ? secret : null
}

// As prontas entram uma vez, e apagar tem que COLAR.
//
// Sem esta marca, quem apagasse a conexão do download a veria voltar no próximo
// arranque — o sistema desfazendo a decisão da pessoa em silêncio, que é
// exatamente o tipo de coisa que faz ninguém confiar na tela. Mesmo mecanismo
// do primeiro dono (`__owners_initialized__`).
const CHAVE_PRONTAS = '__conexoes_prontas__'

// A semente aponta para a chave QUE JÁ EXISTE.
//
// Sem isto, a conexão de download nascia sem credencial e o cartão dizia "falta
// a chave" enquanto a chave existia, funcionando, no arquivo apontado por
// `download.tokenArquivo`. Painel que diz que falta algo que não falta é da
// mesma família do "Conectado" para um bot que não está rodando: quem lê deixa
// de acreditar na tela.
//
// Ler o config.json do gateway daqui é uma curvatura da fronteira motor/gateway,
// e ela é deliberada e LIMITADA: acontece uma vez, na semente, para não nascer
// mentindo. Nada em tempo de execução passa a depender disso — se o arquivo não
// existir (motor rodando separado do gateway), a conexão simplesmente nasce sem
// credencial, que é o comportamento anterior.
function credencialDoGateway () {
  try {
    if (!fs.existsSync(ARQ_CONFIG)) return null
    const cfg = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'))
    const d = cfg?.download || {}
    const arquivo = typeof d.tokenArquivo === 'string' && d.tokenArquivo.trim() ? d.tokenArquivo.trim() : null
    const endereco = typeof d.api === 'string' && d.api.trim() ? d.api.trim().replace(/\/+$/, '') : null
    return { arquivo, endereco }
  } catch {
    return null
  }
}

function semearProntas (db) {
  const jaFeito = db.prepare(
    "SELECT value_json FROM entity_attributes WHERE scope_kind = 'global' AND scope_id = ? AND key = ?"
  ).get(ID_GLOBAL, CHAVE_PRONTAS)
  if (jaFeito) return

  const agora = new Date().toISOString()
  const doGateway = credencialDoGateway()
  const inserir = db.prepare(`INSERT OR IGNORE INTO connections
    (id, kind, config_json, secret_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
  db.transaction(() => {
    for (const pronta of CONEXOES_PRONTAS) {
      const config = { ...pronta.config }
      // A chave nunca é COPIADA para o banco: a conexão aponta para o mesmo
      // arquivo que o gateway já usa. Copiar criaria uma segunda cópia do
      // segredo, que é o oposto do que se quer.
      if (pronta.id === 'midia' && doGateway?.arquivo) {
        config.autenticacao = { ...config.autenticacao, origem: 'arquivo', arquivo: doGateway.arquivo }
      }
      if (pronta.id === 'midia' && doGateway?.endereco) config.endereco = doGateway.endereco
      // O valor do segredo continua fora do banco — a conexão só sabe ONDE ele está.
      inserir.run(pronta.id, pronta.kind, JSON.stringify(validarConfiguracao(config)), null, agora, agora)
    }
    db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
      VALUES ('global', ?, ?, 'true', ?)`).run(ID_GLOBAL, CHAVE_PRONTAS, agora)
  })()
}

export function registrarRotasConnections (roteador, db) {
  semearProntas(db)

  const obter = db.prepare('SELECT * FROM connections WHERE id = ?')

  roteador.get('/connections', () => db.prepare('SELECT * FROM connections ORDER BY id').all().map(expor))

  // O catálogo de declarações prontas, para a tela oferecer "criar a partir
  // de". Elas são o exemplo de como se declara uma conexão — quem quiser ligar
  // uma IA abre a do download, vê a forma, e escreve a sua.
  roteador.get('/connections-prontas', () => CONEXOES_PRONTAS.map((c) => ({
    id: c.id,
    kind: c.kind,
    titulo: c.titulo,
    descricao: c.descricao,
    config: c.config,
    jaCadastrada: Boolean(obter.get(c.id))
  })))

  roteador.post('/connections', ({ body }) => {
    const id = exigirTexto(body, 'id')
    const kind = exigirTexto(body, 'kind')
    const config = configuracaoValidada(kind, body.config)
    const secret = segredoValidado(body.secret)
    const agora = new Date().toISOString()
    try {
      db.prepare(`INSERT INTO connections (id, kind, config_json, secret_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, kind, JSON.stringify(config), secret ? JSON.stringify(secret) : null, agora, agora)
    } catch (erro) {
      if (erro.code?.startsWith('SQLITE_CONSTRAINT')) throw new ErroHttp(409, `Conexão já cadastrada: ${id}.`)
      throw erro
    }
    return resposta(201, expor(obter.get(id)))
  })

  roteador.get('/connections/:id', ({ params }) => {
    const row = obter.get(params.id)
    if (!row) throw new ErroHttp(404, `Conexão não encontrada: ${params.id}.`)
    return expor(row)
  })

  roteador.put('/connections/:id', ({ params, body }) => {
    const row = obter.get(params.id)
    if (!row) throw new ErroHttp(404, `Conexão não encontrada: ${params.id}.`)
    const kind = body?.kind ?? row.kind
    if (typeof kind !== 'string' || !kind.trim()) throw new ErroHttp(400, 'Campo inválido: kind.')

    const config = Object.hasOwn(body || {}, 'config')
      ? configuracaoValidada(kind.trim(), body.config)
      : jsonOuNull(row.config_json)

    // Três intenções distintas, e confundi-las apaga credencial por engano:
    //   - campo ausente  -> mantém o segredo que já existe (o caso comum: quem
    //                       edita as funções não quer mexer na credencial, e
    //                       nem teria como reenviá-la, já que não a lê);
    //   - secret: null   -> apaga, de propósito;
    //   - secret: {...}  -> substitui.
    const secretJson = Object.hasOwn(body || {}, 'secret')
      ? (() => { const s = segredoValidado(body.secret); return s ? JSON.stringify(s) : null })()
      : row.secret_json

    db.prepare('UPDATE connections SET kind = ?, config_json = ?, secret_json = ?, updated_at = ? WHERE id = ?')
      .run(kind.trim(), JSON.stringify(config), secretJson, new Date().toISOString(), params.id)
    return expor(obter.get(params.id))
  })

  roteador.delete('/connections/:id', ({ params }) => {
    const resultado = db.prepare('DELETE FROM connections WHERE id = ?').run(params.id)
    if (!resultado.changes) throw new ErroHttp(404, `Conexão não encontrada: ${params.id}.`)
    return { removed: true, id: params.id }
  })
}
