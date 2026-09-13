import fs from 'fs'
import { ErroHttp } from '../transport.js'
import { obterCapacidadesRuntime } from '../runtimeCapabilities.js'

const arquivoSchema = new URL('../schema/automation.v1.schema.json', import.meta.url)
const documentSchema = JSON.parse(fs.readFileSync(arquivoSchema, 'utf8'))

export function registrarRotasMeta (roteador) {
  roteador.get('/meta/automation-editor', ({ query }) => {
    const schemaVersion = query?.get('schemaVersion')
    if (schemaVersion !== undefined && schemaVersion !== null && schemaVersion !== '1') {
      throw new ErroHttp(400, 'Somente schemaVersion 1 é aceito nesta etapa.')
    }

    return {
      schemaVersion: 1,
      documentSchema: structuredClone(documentSchema),
      runtime: obterCapacidadesRuntime()
    }
  })

  roteador.get('/meta/variables', () => ({
    builtIn: [
      { namespace: 'message', field: 'text', example: '{{message.text}}', description: 'Texto da mensagem recebida, quando o tipo for texto.' },
      { namespace: 'message', field: 'args', example: '{{message.args}}', description: 'O que a pessoa escreveu DEPOIS do comando. Em "/avisar chega de spam", vale "chega de spam".' },
      { namespace: 'message', field: 'kind', example: '{{message.kind}}', description: 'Tipo da mensagem recebida (text, image, audio, ...).' },
      { namespace: 'sender', field: 'id', example: '{{sender.id}}', description: 'Número de quem enviou a mensagem.' },
      { namespace: 'sender', field: 'isOwner', example: '{{sender.isOwner}}', description: 'Diz se quem enviou é dono do bot (true) ou não (false). Serve para dar respostas diferentes ao dono, ou restringir um comando.', warning: { level: 'info', text: 'Enquanto nenhum dono estiver cadastrado, comandos restritos respondem SOMENTE a mensagens do próprio número do bot — é assim que se cadastra o primeiro dono pelo WhatsApp, sem deixar o comando aberto a estranhos nesse meio-tempo.' } },
      { namespace: 'target', field: 'id', example: '{{target.id}}', description: 'Número de quem o comando está mirando: o primeiro @mencionado ou, se não houver menção, o autor da mensagem respondida. É o que faz "/adv @fulano" agir sobre o fulano e não sobre quem digitou.', warning: { level: 'info', text: 'O WhatsApp às vezes entrega a menção como um identificador interno em vez do telefone. O sistema traduz isso sozinho, aprendendo o par de cada pessoa que já escreveu naquela conversa. Se a pessoa mencionada nunca falou ali, a tradução ainda não existe — nesse caso, responder a mensagem dela funciona sempre.' } },
      { namespace: 'chat', field: 'id', example: '{{chat.id}}', description: 'Identificador do contato ou grupo onde a automação executou.' },
      { namespace: 'chat', field: 'kind', example: '{{chat.kind}}', description: "'direct' para conversa privada, 'group' para grupo." },
      { namespace: 'var', field: 'chat.<chave>', example: '{{var.chat.apelido}}', description: 'Variável desta conversa — no privado é do contato, no grupo é do grupo inteiro.' },
      { namespace: 'var', field: 'sender.<chave>', example: '{{var.sender.nivel}}', description: 'Variável de quem enviou, valendo em qualquer conversa onde essa pessoa apareça.' },
      { namespace: 'var', field: 'member.<chave>', example: '{{var.member.avisos}}', description: 'Variável de quem enviou DENTRO deste grupo. É a que serve para punição: 3 avisos no grupo A não somam com os do grupo B.' },
      { namespace: 'var', field: 'target.<chave>', example: '{{var.target.nivel}}', description: 'Variável de quem o comando está mirando (o mencionado ou respondido).' },
      { namespace: 'var', field: 'targetMember.<chave>', example: '{{var.targetMember.avisos}}', description: 'Variável do alvo DENTRO deste grupo — a combinação usada por "/adv @fulano".' },
      { namespace: 'var', field: 'category.<categoria>.<chave>', example: '{{var.category.vip.usos}}', description: 'Contador compartilhado por uma categoria de pessoas. Quem pertence à categoria você marca na aba Dados (ex: vip = true num contato).' },
      { namespace: 'var', field: 'global.<chave>', example: '{{var.global.total}}', description: 'Variável do sistema inteiro, não pertence a ninguém. Serve para totais gerais.' },
      { namespace: 'custom', field: '<qualquer chave>', example: '{{custom.vip}}', description: 'Atalho antigo para a variável desta conversa — o mesmo que {{var.chat.<chave>}}. Continua funcionando; prefira a forma nova em automações novas.' }
    ],
    reserved: [
      { placeholder: '{{latencyMs}}', description: 'Tempo de resposta real em milissegundos, resolvido no instante exato do envio. Funciona sem namespace ou ponto.' }
    ]
  }))
}
