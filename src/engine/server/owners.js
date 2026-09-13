// Donos do bot: contatos autorizados a usar comandos restritos e a mexer na
// configuração das automações pelo próprio WhatsApp.
//
// O caso de uso que motivou isto: um número de empresa rodando o bot, e o
// contato PESSOAL do responsável marcado como dono — assim ele configura tudo
// mandando mensagem para o número da empresa, sem precisar estar com o
// aparelho da empresa na mão.
//
// Guardado em entity_attributes (escopo 'contact', chave reservada) em vez de
// tabela nova: é exatamente a mesma forma de "marca num contato" que a aba
// Dados já edita, ganha de graça o CRUD e a tela que já existem, e a chave
// reservada com prefixo __ deixa claro que não é variável comum de usuário.
import { ID_GLOBAL } from './attributeScopes.js'

export const CHAVE_DONO = '__owner__'

// O primeiro dono é um caso especial: enquanto NINGUÉM foi marcado, exigir
// dono travaria a pessoa para fora da própria configuração. Este registro diz
// se a instalação já passou por essa fase.
const CHAVE_DONO_DEFINIDO = '__owners_initialized__'

function verdadeiro (valorJson) {
  try { return JSON.parse(valorJson) === true } catch { return false }
}

export function ehDono (db, contatoId) {
  if (typeof contatoId !== 'string' || !contatoId) return false
  const linha = db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind = 'contact' AND scope_id = ? AND key = ?")
    .get(contatoId, CHAVE_DONO)
  return linha ? verdadeiro(linha.value_json) : false
}

export function listarDonos (db) {
  return db.prepare("SELECT scope_id, updated_at FROM entity_attributes WHERE scope_kind = 'contact' AND key = ? ORDER BY updated_at")
    .all(CHAVE_DONO)
    .filter((linha) => ehDono(db, linha.scope_id))
    .map((linha) => ({ contactId: linha.scope_id, since: linha.updated_at }))
}

export function existeAlgumDono (db) {
  return listarDonos(db).length > 0
}

// "Ainda não configurou dono nenhum" é diferente de "removeu todos de
// propósito". No primeiro caso, um comando restrito ainda responde a qualquer
// um (senão a instalação nova nasce trancada); no segundo, não responde a
// ninguém, e isso é uma escolha explícita de quem operou.
export function semDonoCadastrado (db) {
  if (existeAlgumDono(db)) return false
  const marca = db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind = 'global' AND scope_id = ? AND key = ?")
    .get(ID_GLOBAL, CHAVE_DONO_DEFINIDO)
  return !marca
}

// Quem pode disparar um comando marcado como restrito.
//
// A regra do caso "ainda não cadastrei ninguém" é a parte delicada: se o
// comando ficasse aberto a todo mundo, qualquer pessoa de um grupo poderia
// usar comando de dono até alguém lembrar de configurar — brecha real. Se
// ficasse fechado a todo mundo, não haveria como cadastrar o primeiro dono
// pelo WhatsApp. A saída é abrir SÓ para o próprio número do bot: quem está
// com a conta na mão manda a mensagem de si para si e cadastra o primeiro
// dono; mais ninguém alcança.
//
// `souEuMesmo` vem de `sender.authoredBySelf` do evento canônico — ou seja, a
// mensagem partiu de um aparelho logado nesta mesma conta do WhatsApp.
export function podeUsarComandoRestrito (db, contatoId, { souEuMesmo = false } = {}) {
  if (souEuMesmo) return true
  if (ehDono(db, contatoId)) return true
  return false
}

export function definirDono (db, contatoId, ehDonoAgora) {
  const agora = new Date().toISOString()
  const gravar = db.transaction(() => {
    if (ehDonoAgora) {
      db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
        VALUES ('contact', ?, ?, 'true', ?)
        ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET value_json = 'true', updated_at = excluded.updated_at`)
        .run(contatoId, CHAVE_DONO, agora)
      // A partir do primeiro dono, a instalação deixa de ser "aberta": remover
      // todos depois passa a significar "ninguém pode", não "todos podem".
      db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
        VALUES ('global', ?, ?, 'true', ?)
        ON CONFLICT(scope_kind, scope_id, key) DO NOTHING`)
        .run(ID_GLOBAL, CHAVE_DONO_DEFINIDO, agora)
    } else {
      db.prepare("DELETE FROM entity_attributes WHERE scope_kind = 'contact' AND scope_id = ? AND key = ?")
        .run(contatoId, CHAVE_DONO)
    }
  })
  gravar()
  return { contactId: contatoId, isOwner: ehDonoAgora === true }
}
