// Gera docs/engineering/lcn-v2/INSTANCE_LIMITS.md a partir de
// src/agent/concessoes.js. O documento NÃO é escrito à mão de propósito: o
// pedido exige uma tabela por parâmetro (tipo, padrão, intervalo, fonte do
// limite, quem altera, herança, atualização, validação, enforcement e o que
// acontece ao reduzir), e manter isso à mão ao lado da tabela do código é
// exatamente a divergência de camadas que este projeto já pagou caro.
//
// `npm run docs:limites` reescreve o arquivo. `tests/concessoes-de-instancia`
// NÃO confere o documento; quem confere é tests/docs-limites.test.mjs, que
// falha se o arquivo no repositório não for igual ao que esta função gera.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PARAMETROS, CAMPOS } from '../src/agent/concessoes.js'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DESTINO = path.join(RAIZ, 'docs/engineering/lcn-v2/INSTANCE_LIMITS.md')

// Cada regra responde as mesmas perguntas de forma diferente. É por isso que
// não é Math.min() em tudo: a coluna "ao reduzir" e a coluna "validação"
// mudam de regra para regra.
const REGRAS = {
  'teto onde zero é ilimitado': {
    intervalo: (s) => `inteiro ≥ ${s.minimo ?? 0}; 0 significa SEM LIMITE`,
    validacao: 'Recusa valor acima do teto. **Zero não passa por comparação de grandeza**: como zero quer dizer "sem limite", `Math.min(0, teto)` devolveria 0 e ELEVARIA o limite a infinito passando por uma checagem que parece correta. Pedir zero contra um teto concedido é tratado como tentativa de elevação e vira o teto.',
    reduzir: 'O valor configurado é preservado; o efetivo é cortado na leitura. Se o cliente tinha 0 (sem limite), passa a valer o teto concedido.'
  },
  'teto com piso': {
    intervalo: (s) => `inteiro entre ${s.minimo} e o teto concedido (sem concessão, sem teto)`,
    validacao: 'Recusa valor acima do teto concedido. O mínimo obrigatório vence tanto a preferência do cliente quanto a concessão: conceder abaixo do mínimo é recusado na origem, porque a instância não conseguiria obedecer.',
    reduzir: 'O valor configurado é preservado; o efetivo é cortado na leitura, nunca abaixo do mínimo obrigatório.'
  },
  travável: {
    intervalo: () => '`true` ou `false`',
    validacao: 'Não há "menor que" em booleano. Enquanto o administrador não fixa, a preferência do cliente vale inteira; fixado, a preferência é ignorada.',
    reduzir: 'Fixar passa a valer na leitura seguinte. A preferência do cliente fica guardada e volta a valer quando o administrador soltar.'
  },
  lista: {
    intervalo: (s) => (s.opcoes || []).map((o) => `\`${o}\``).join(', '),
    validacao: 'Campo não numérico: não existe "menor que". O valor está na lista concedida ou é recusado. Conceder opção que não existe na lista fechada do código é recusado.',
    reduzir: 'Se a opção em uso sai da lista concedida, o efetivo passa a ser a primeira opção concedida, e a tela diz qual valor foi pedido e quais estão disponíveis.'
  }
}

export function gerar () {
  const L = []
  L.push('# Limites e concessões por instância')
  L.push('')
  L.push('Gerado por `npm run docs:limites` a partir de `src/agent/concessoes.js`.')
  L.push('Não editar à mão: `tests/docs-limites.test.mjs` falha se este arquivo')
  L.push('divergir da tabela do código.')
  L.push('')
  L.push('## A hierarquia')
  L.push('')
  L.push('Quatro camadas, da mais forte para a mais fraca, e a verdade fica sempre')
  L.push('no backend — nunca só na tela:')
  L.push('')
  L.push('| # | camada | onde mora | quem escreve |')
  L.push('|---|---|---|---|')
  L.push('| 1 | padrão do código | `src/config.js` (`PADRAO`) | ninguém em runtime |')
  L.push('| 2 | concessão do administrador | `registry.json`, mapa `grants` no TOPO | administração |')
  L.push('| 3 | preferência do cliente | `config.json` DENTRO da pasta da instância | o cliente |')
  L.push('| 4 | limite efetivo | calculado a cada leitura | o runtime obedece |')
  L.push('')
  L.push('**Por que a concessão mora no registro, e não na instância.**')
  L.push('`registry.json` fica FORA da pasta da instância; `config.json` fica DENTRO.')
  L.push('Quem controla a instância reescreve o próprio `config.json`. Guardar o teto')
  L.push('no mesmo arquivo que o valor seria guardar a chave dentro do cofre.')
  L.push('O mapa fica no topo do registro, e não em `instances[id]`, por dois motivos:')
  L.push('a instância do modo simples (`bare`) não tem entrada no registro e também')
  L.push('precisa de teto; e `validar()` descarta chave que não conhece, então uma')
  L.push('concessão escondida dentro da instância se perderia na primeira gravação.')
  L.push('')
  L.push('**Herança.** Não há herança entre instâncias: cada uma lê só a própria')
  L.push('entrada de `grants`. Sem concessão, a preferência do cliente vale inteira')
  L.push('(padrão sensato sim, teto no código não).')
  L.push('')
  L.push('**Atualização.** A concessão é lida do registro a cada resolução, então')
  L.push('mudança administrativa passa a valer na leitura seguinte, sem reiniciar.')
  L.push('')
  L.push('**Validação na gravação E na leitura.** Gravação validada protege de quem')
  L.push('usa a tela. Validar na leitura protege também de quem editou o JSON à mão,')
  L.push('importou configuração, trocou o arquivo ou chamou a rota direto. Defesa em')
  L.push('profundidade: as duas, não uma. A recusa na gravação devolve')
  L.push('`LCN_ACIMA_DA_CONCESSAO` com o campo e o permitido — gravar um número e')
  L.push('devolver outro calado é o que faz a pessoa achar que a tela está quebrada.')
  L.push('')
  L.push('**Ao reduzir uma quota**, o `config.json` do cliente NÃO é reescrito: o')
  L.push('valor configurado fica guardado e o efetivo é cortado na leitura. Assim,')
  L.push('quando a administração devolve a quota, o cliente recupera a escolha dele')
  L.push('sem reconfigurar nada. Em troca, a tela TEM de mostrar os dois números — é')
  L.push('o que `explicar()` serve, e o que a seção "O que a tela mostra" exige.')
  L.push('')
  L.push('## Não é `Math.min()` em tudo')
  L.push('')
  L.push('O pedido proíbe expressamente resolver todos os campos com `Math.min()`.')
  L.push('São quatro regras distintas, e em dois casos `Math.min` dá a resposta errada:')
  L.push('')
  L.push('| regra | por que `Math.min` não serve |')
  L.push('|---|---|')
  L.push('| `teto onde zero é ilimitado` | **perigoso**: 0 quer dizer "sem limite", então `Math.min(0, teto)` = 0 e o cliente ELEVA o limite a infinito pedindo zero |')
  L.push('| `teto com piso` | há mínimo obrigatório; zero trancaria a fila inteira |')
  L.push('| `lista` | valor não numérico: não existe "menor que" |')
  L.push('| `travável` | booleano: ou a administração fixa, ou a preferência vale |')
  L.push('')
  L.push('## Os parâmetros')
  L.push('')
  for (const chave of CAMPOS) {
    const s = PARAMETROS[chave]
    const r = REGRAS[s.regra]
    if (!r) throw new Error(`regra sem texto no gerador: ${s.regra} (${chave})`)
    L.push(`### \`${chave}\``)
    L.push('')
    L.push(`**${s.rotulo}** — ${s.significado}`)
    L.push('')
    L.push('| | |')
    L.push('|---|---|')
    L.push(`| tipo | ${s.tipo} |`)
    L.push(`| padrão | \`${JSON.stringify(s.padrao)}\` (de \`src/config.js\`) |`)
    L.push(`| intervalo válido | ${r.intervalo(s)} |`)
    L.push(`| regra de resolução | \`${s.regra}\` |`)
    L.push(`| fonte do limite | ${s.limiteDoProvedor || chave === 'hardware.maxMidiaMB' || chave === 'download.limiteMB' ? 'o WhatsApp/provedor impõe um máximo próprio; a concessão só pode ser mais apertada' : 'a administração desta instalação'} |`)
    L.push('| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |')
    L.push('| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |')
    L.push('| herança | nenhuma; só a entrada de `grants` desta instância |')
    L.push(`| validação no backend | ${r.validacao} |`)
    L.push(`| enforcement no runtime | ${s.enforcement.onde}${s.enforcement.concessaoChega ? '' : ' — **a concessão ainda NÃO chega a este consumidor**, ver "O que falta" abaixo'} |`)
    L.push(`| ao reduzir a quota | ${r.reduzir} |`)
    L.push(`| efeito prático | ${s.efeito} |`)
    L.push('')
  }
  // Limite por instância que a frente E manda declarar e que NÃO passa pela
  // tabela de concessões. Fica escrito à mão AQUI, dentro do gerador, e não no
  // markdown: o documento é gerado, então editar o .md diretamente divergiria
  // na primeira execução de `npm run docs:limites`.
  L.push('## Um limite por instância que NÃO é concessão')
  L.push('')
  L.push('### `hardware.pareamentoIntervaloSegundos`')
  L.push('')
  L.push('**Intervalo entre pedidos de código** — Quanto tempo esperar antes de')
  L.push('pedir outro código de pareamento para a mesma instância.')
  L.push('')
  L.push('**Este parâmetro é diferente dos de cima, e a diferença importa: ele NÃO')
  L.push('tem concessão.** Não há entrada em `src/agent/concessoes.js`, não passa por')
  L.push('`valorEfetivo`, não viaja em `LCN_CONCESSOES` e não tem teto do')
  L.push('administrador. `pedirCodigo` lê direto o `config.json` da instância. Está')
  L.push('documentado aqui porque é um limite por instância que a frente **E** manda')
  L.push('declarar — não porque entre na hierarquia acima.')
  L.push('')
  L.push('| | |')
  L.push('|---|---|')
  L.push('| tipo | inteiro, segundos |')
  L.push('| padrão | `180` (de `src/config.js`) — é o `PAIRING_CODE_MAX_AGE_SECONDS` da zapo-js, a validade real do código |')
  L.push('| intervalo válido | qualquer inteiro; `0` ou negativo **desliga** a guarda |')
  L.push('| regra de resolução | nenhuma — valor único, sem teto e sem piso |')
  L.push('| fonte do limite | a própria instância |')
  L.push('| quem altera a concessão | **ninguém; não existe concessão para este campo** |')
  L.push('| quem altera o valor | quem edita o `config.json` da instância |')
  L.push('| herança | nenhuma |')
  L.push('| validação no backend | Valor não finito cai no padrão; `0` ou negativo desliga; `config.json` ilegível cai no padrão, em vez de trancar o pareamento. |')
  L.push('| enforcement no runtime | `esperaDePareamento`, terceira guarda de `pedirCodigo` (`src/agent/instanceService.js`) |')
  L.push('| ao reduzir o valor | Vale no pedido seguinte; não há estado a migrar — a conta é sobre `codigoPareamentoEm`, que já existe no estado. |')
  L.push('| efeito prático | Impede que um segundo clique **invalide** o código que a pessoa ainda está digitando: a biblioteca troca a chave efêmera e descarta a tentativa anterior. Detalhado em `PAIRING.md` e `SECURITY_REVIEW.md` §5. |')
  L.push('')
  L.push('**Ainda não tem tela.** O campo não aparece em')
  L.push('`src/web/public/logic/optimization.js`, então hoje só se altera editando o')
  L.push('`config.json`. Isso contraria a regra de interface do projeto (todo ajuste')
  L.push('montável pelo painel) e fica registrado como pendência, não como entrega.')
  L.push('')
  L.push('## O que a tela mostra')
  L.push('')
  L.push('`explicar()` devolve, por parâmetro, tudo o que o pedido exige da interface:')
  L.push('o valor configurado, o limite permitido, o que está em vigor, de onde vem o')
  L.push('limite, o significado, o efeito, a razão de um valor estar indisponível, e')
  L.push('se o limite é do provedor em vez de nosso. `obterOtimizacao` entrega isso')
  L.push('no campo `limites`.')
  L.push('')
  L.push('## O que falta, dito de forma honesta')
  L.push('')
  const semLeitor = CAMPOS.filter((c) => !PARAMETROS[c].enforcement.concessaoChega)
  if (semLeitor.length) {
    L.push(`**1. ${semLeitor.length} concessão(ões) ainda não chega(m) ao consumidor em runtime.**`)
    L.push('A hierarquia resolve o valor efetivo e a gravação é recusada acima do teto,')
    L.push('mas estes campos são lidos do `config.json` cru por quem os consome:')
    L.push('')
    for (const c of semLeitor) L.push(`- \`${c}\` — ${PARAMETROS[c].enforcement.onde}`)
    L.push('')
    L.push('Enquanto isso não for ligado, o teto destes campos vale na tela e na')
    L.push('gravação, e não no consumidor. Está escrito aqui em vez de omitido porque')
    L.push('limite que o runtime não obedece é limite que não existe.')
    L.push('')
  } else {
    L.push('**1. O teto chega ao runtime pelo AMBIENTE, e isso tem uma consequência.**')
    L.push('Os nove campos são obedecidos na leitura pelo consumidor real — não falta')
    L.push('nenhum. Mas o caminho tem um custo que precisa estar dito: `registry.json`')
    L.push('NÃO é montado no container (`src/instances/quadlet.js`), de propósito, para')
    L.push('a instância não poder ler nem reescrever o próprio teto. Então a concessão')
    L.push('viaja em `LCN_CONCESSOES`, escrito pelo lado do administrador na unit do')
    L.push('quadlet (e no ambiente do processo, no modo bare).')
    L.push('')
    L.push('Consequência honesta: **mudar a concessão de uma instância gerenciada em pé')
    L.push('não vale até ela reiniciar.** `PUT /api/v1/instances/:id/grants` grava no')
    L.push('registro, reescreve a unit e devolve `precisaReiniciar`. Ele NÃO reinicia')
    L.push('sozinho: derrubar o serviço de um cliente sem ninguém pedir seria pior que')
    L.push('o atraso. Na tela isso tem de aparecer, senão o administrador reduz uma')
    L.push('cota, vê o número novo no painel e acha que já está valendo.')
    L.push('')
  }
  L.push('**2. A metade de segurança da frente E depende de autenticação, que não existe.**')
  L.push('O pedido exige que o cliente não consiga elevar o próprio limite por')
  L.push('requisição HTTP direta nem por endpoint administrativo sem autorização. Hoje')
  L.push('o painel não tem autenticação nem papéis: `src/web/server.js:15` só aceita')
  L.push('`127.0.0.1`/`localhost`/`::1`, e a linha 53 registra a regra fixa de NUNCA')
  L.push('expor em `0.0.0.0` sem autenticação — as linhas 56-57 lançam se tentarem.')
  L.push('Então **quem alcança a porta JÁ é o administrador**, e as duas rotas de')
  L.push('concessão são a camada de concessão, não um controle de acesso.')
  L.push('')
  L.push('O que está entregue dentro dessa realidade: o limite resiste a config')
  L.push('editado à mão, a configuração importada, a arquivo trocado e a gravação pela')
  L.push('rota — porque a leitura também valida. O que NÃO está, e não é implementável')
  L.push('como especificado sem uma camada de identidade: distinguir "o cliente" de "o')
  L.push('administrador" na mesma porta. Isso é da frente **J**, e é pré-requisito real')
  L.push('para alugar o sistema a terceiros.')
  L.push('')
  return L.join('\n') + '\n'
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(DESTINO), { recursive: true })
  fs.writeFileSync(DESTINO, gerar())
  console.log(`escrito: ${path.relative(RAIZ, DESTINO)}`)
}
