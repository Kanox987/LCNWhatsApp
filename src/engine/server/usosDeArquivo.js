// QUE COMANDOS USAM ESTE ARQUIVO.
//
// Este vínculo nunca existiu em camada nenhuma. Ele mora solto dentro do
// documento da automação, como configuração do nó que envia arquivo, em três
// campos alternativos — `fileId`, `path` e `folder` — e ninguém o indexava.
//
// O preço disso estava escrito na própria tela: o botão de apagar avisa
// "Comandos que usam este arquivo deixam de encontrá-lo" SEM PODER DIZER
// QUAIS. Quem apaga decide no escuro, e a consequência aparece dias depois,
// quando alguém usa o comando e ele responde o texto de "arquivo não
// encontrado" — que existe no schema justamente porque isto não dava para
// saber.
//
// A HONESTIDADE DESTE MÓDULO está na separação entre dois tipos de resposta:
//
//   certos   — o comando aponta para este arquivo, e dá para provar: o id
//              bate, ou o caminho escrito é exatamente o dele.
//   talvez   — o comando monta o caminho com marcador ({{message.args}}), e
//              QUALQUER arquivo pode cair ali. Não dá para decidir sem rodar.
//
// Misturar os dois seria mentir nas duas direções: afirmar uso que não há, ou
// esconder que existe um comando capaz de pegar aquele arquivo.

const CAMPOS_DE_ARQUIVO = ['fileId', 'path', 'folder']

const ehDinamico = (valor) => typeof valor === 'string' && valor.includes('{{')

// A pasta de um caminho lógico: "produtos/fotos/capa.jpg" -> "produtos/fotos".
function pastaDoCaminho (caminho) {
  const partes = String(caminho || '').split('/')
  partes.pop()
  return partes.join('/')
}

// Um comando que envia a pasta "produtos" alcança "produtos/fotos/capa.jpg"?
// Alcança se a pasta do arquivo for a declarada ou estiver dentro dela.
function pastaAlcanca (pastaDeclarada, pastaDoArquivo) {
  if (!pastaDeclarada) return false
  if (pastaDeclarada === pastaDoArquivo) return true
  return String(pastaDoArquivo || '').startsWith(`${pastaDeclarada}/`)
}

function nosQueEnviamArquivo (documento) {
  const nos = documento?.flow?.nodes
  if (!Array.isArray(nos)) return []
  return nos.filter((no) => no?.type === 'action.whatsapp.sendFile')
}

/**
 * Cruza um arquivo do acervo com as automações publicadas.
 *
 * @param {object} arquivo `{ id, path, folder }`, como o acervo o expõe.
 * @param {Array} automacoes `[{ id, nome, documento }]` — já lidas, porque
 *   quem sabe ler documento publicado é quem chamou.
 * @returns {{certos: Array, talvez: Array}}
 */
export function usosDoArquivo (arquivo, automacoes) {
  const certos = []
  const talvez = []
  const pastaDele = arquivo?.folder || pastaDoCaminho(arquivo?.path)

  for (const automacao of automacoes || []) {
    for (const no of nosQueEnviamArquivo(automacao.documento)) {
      const config = no.config || {}
      const dinamico = CAMPOS_DE_ARQUIVO.some((campo) => ehDinamico(config[campo]))

      const porId = config.fileId && config.fileId === arquivo?.id
      const porCaminho = config.path && !ehDinamico(config.path) && config.path === arquivo?.path
      const porPasta = config.folder && !ehDinamico(config.folder) && pastaAlcanca(config.folder, pastaDele)

      const como = porId ? 'pelo identificador' : porCaminho ? 'pelo caminho' : porPasta ? 'pela pasta' : null
      if (como) {
        certos.push({ automationId: automacao.id, nome: automacao.nome || automacao.id, como })
        break
      }
      // Caminho montado na hora: pode ser este arquivo, pode ser outro. Dizer
      // "não usa" seria tão errado quanto dizer "usa".
      if (dinamico) {
        talvez.push({
          automationId: automacao.id,
          nome: automacao.nome || automacao.id,
          como: 'monta o caminho na hora, com o que a pessoa escrever'
        })
        break
      }
    }
  }
  return { certos, talvez }
}
