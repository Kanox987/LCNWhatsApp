// "Quem pode usar" no formulário: ida e volta entre o texto do motor e as duas peças da tela.
import { acessoDoFormulario, acessoParaFormulario, ehParametroDeAcesso, MODOS_DE_ACESSO } from '../src/web/public/logic/acesso.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const volta = (texto) => acessoDoFormulario(acessoParaFormulario(texto))

for (const texto of ['todos', 'dono', 'admins', 'lista vip']) check(`ida e volta "${texto}"`, volta(texto) === texto, volta(texto))
check('vazio e lixo abrem como "todos"', volta('') === 'todos' && volta(undefined) === 'todos' && volta('qualquer coisa') === 'todos')
check('"lista" sem nome não vira "todos" (o motor recusa)', acessoDoFormulario({ modo: 'lista', lista: '  ' }) === 'lista')
check('o nome da lista é aparado', acessoDoFormulario({ modo: 'lista', lista: ' Vip ' }) === 'lista Vip')
check('modo desconhecido vale "todos", nunca restringe', acessoDoFormulario({ modo: 'xyz' }) === 'todos' && acessoDoFormulario() === 'todos')
check('só o parâmetro "acesso" ganha o controle', ehParametroDeAcesso({ key: 'acesso' }) && !ehParametroDeAcesso({ key: 'allowFrom' }) && !ehParametroDeAcesso(null))
check('as quatro escolhas', MODOS_DE_ACESSO.map((m) => m.id).join() === 'todos,dono,admins,lista')

process.exit(falhas ? 1 : 0)
