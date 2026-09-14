import fs from 'fs'
import { ErroHttp } from '../transport.js'
import { obterCapacidadesRuntime } from '../runtimeCapabilities.js'
import { listarDeclaradas } from '../declaredVariables.js'

const arquivoSchema = new URL('../schema/automation.v1.schema.json', import.meta.url)
const documentSchema = JSON.parse(fs.readFileSync(arquivoSchema, 'utf8'))

export function registrarRotasMeta (roteador, db) {
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
      { namespace: 'sender', field: 'name', example: '{{sender.name}}', description: 'O nome que a pessoa escolheu exibir no WhatsApp. Serve para cumprimentar pelo nome em vez de pelo número.', warning: { level: 'compatibility', text: 'Nem toda mensagem traz o nome. Quando não vier, o texto {{sender.name}} aparece do jeito que está na resposta — então evite usá-lo sozinho numa saudação, ou deixe uma alternativa no texto.' } },
      { namespace: 'sender', field: 'isOwner', example: '{{sender.isOwner}}', description: 'Diz se quem enviou é dono do bot (true) ou não (false). Serve para dar respostas diferentes ao dono, ou restringir um comando.', warning: { level: 'info', text: 'Enquanto nenhum dono estiver cadastrado, comandos restritos respondem SOMENTE a mensagens do próprio número do bot — é assim que se cadastra o primeiro dono pelo WhatsApp, sem deixar o comando aberto a estranhos nesse meio-tempo.' } },
      { namespace: 'target', field: 'id', example: '{{target.id}}', description: 'Número de quem o comando está mirando: o primeiro @mencionado ou, se não houver menção, o autor da mensagem respondida. É o que faz "/adv @fulano" agir sobre o fulano e não sobre quem digitou. Também funciona respondendo a mensagem da pessoa.' },
      { namespace: 'quoted', field: 'sender', example: '{{quoted.sender}}', description: 'Número de quem escreveu a mensagem RESPONDIDA. Diferente de {{target.id}}, que prefere a menção quando existem as duas: aqui é sempre o autor da citação.' },
      { namespace: 'chat', field: 'id', example: '{{chat.id}}', description: 'Identificador do contato ou grupo onde a automação executou.' },
      { namespace: 'chat', field: 'kind', example: '{{chat.kind}}', description: "'direct' para conversa privada, 'group' para grupo." },
      { namespace: 'bot', field: 'id', example: '{{bot.id}}', description: 'O número que está executando a automação. Serve para o bot se apresentar sem você digitar o próprio número dentro da resposta.' },
      // Calculadas na hora, a partir do relógio da máquina. Existem prontas
      // porque a interpolação não tem função nem conta: um
      // "{{formatar(data,'dd/MM')}}" exigiria um interpretador de expressão.
      { namespace: 'now', field: 'greeting', example: '{{now.greeting}}', description: 'Bom dia, Boa tarde ou Boa noite, conforme a hora em que a resposta sai. É o "bom dia" automático, sem precisar de três comandos diferentes.' },
      { namespace: 'now', field: 'date', example: '{{now.date}}', description: 'Data de hoje no formato 31/12/2026.' },
      { namespace: 'now', field: 'time', example: '{{now.time}}', description: 'Hora agora no formato 14:35, em 24 horas.' },
      { namespace: 'now', field: 'weekday', example: '{{now.weekday}}', description: 'Dia da semana por extenso: segunda-feira, terça-feira…' },
      { namespace: 'now', field: 'day', example: '{{now.day}}', description: 'Só o dia do mês, com dois dígitos (05, 31).' },
      { namespace: 'now', field: 'month', example: '{{now.month}}', description: 'Só o mês, com dois dígitos (01 a 12).' },
      { namespace: 'now', field: 'year', example: '{{now.year}}', description: 'Só o ano, com quatro dígitos.' },
      { namespace: 'now', field: 'hour', example: '{{now.hour}}', description: 'Só a hora, de 00 a 23. Útil para comparar na condição, por exemplo para saber se a loja está aberta.' },
      { namespace: 'now', field: 'minute', example: '{{now.minute}}', description: 'Só os minutos, de 00 a 59.' },
      { namespace: 'var', field: 'chat.<chave>', example: '{{var.chat.apelido}}', description: 'Variável desta conversa — no privado é do contato, no grupo é do grupo inteiro.' },
      { namespace: 'var', field: 'sender.<chave>', example: '{{var.sender.nivel}}', description: 'Variável de quem enviou, valendo em qualquer conversa onde essa pessoa apareça.' },
      { namespace: 'var', field: 'member.<chave>', example: '{{var.member.avisos}}', description: 'Variável de quem enviou DENTRO deste grupo. É a que serve para punição: 3 avisos no grupo A não somam com os do grupo B.' },
      { namespace: 'var', field: 'target.<chave>', example: '{{var.target.nivel}}', description: 'Variável de quem o comando está mirando (o mencionado ou respondido).' },
      { namespace: 'var', field: 'targetMember.<chave>', example: '{{var.targetMember.avisos}}', description: 'Variável do alvo DENTRO deste grupo — a combinação usada por "/adv @fulano".' },
      { namespace: 'var', field: 'category.<categoria>.<chave>', example: '{{var.category.vip.usos}}', description: 'Contador compartilhado por uma categoria de pessoas. Quem pertence à categoria você marca na aba Dados (ex: vip = true num contato).' },
      { namespace: 'var', field: 'global.<chave>', example: '{{var.global.total}}', description: 'Variável do sistema inteiro, não pertence a ninguém. Serve para totais gerais.' }
    ],
    // Variáveis que os comandos instalados declararam usar. Aparecem assim
    // que o comando é instalado, sem esperar alguma delas receber valor.
    declared: db ? listarDeclaradas(db) : [],
    reserved: [
      { placeholder: '{{latencyMs}}', description: 'Tempo de resposta real em milissegundos, resolvido no instante exato do envio. Funciona sem namespace ou ponto.' }
    ]
  }))
}
