// Perfil de provisionamento — a camada PURA: forma, catálogo, hash, tradução
// em escolhas e política. Nada aqui abre banco.
//
// O que estes casos impedem:
//  · perfil que passa porque a validação é frouxa (propriedade desconhecida,
//    versão não inteira, id com barra);
//  · hash que muda por ordem de chave ou por padrão escrito por extenso —
//    o estado "já apliquei este perfil" ficaria inconsistente;
//  · "escopo vazio" virando "todos" em silêncio;
//  · política que corta o perfil pela metade em vez de recusá-lo inteiro.
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { carregarPacotes } from '../src/engine/templates/pacotes.js'
import {
  lerPerfil, validarContraCatalogo, escolhasDoPerfil, perfilEhVazio,
  lerPolitica, aplicarPolitica, LIMITE_DO_ARQUIVO
} from '../src/engine/server/perfilDeProvisionamento.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const recusa = (nome, fn, pedaco) => {
  try { fn(); check(nome, false, 'não lançou') } catch (erro) {
    check(nome, erro.message.includes(pedaco), erro.message)
  }
}

const catalogo = carregarCatalogo()
const pacotes = carregarPacotes()
const contexto = { catalogo, pacotes }

const base = { schemaVersion: 1, profileId: 'teste', profileVersion: 1 }
const incluirGrupos = { include: [{ kind: 'all_groups' }], exclude: [] }

// ---------------------------------------------------------------- forma

{
  const { perfil } = lerPerfil(base)
  check('perfil mínimo é válido e vazio', perfilEhVazio(perfil))
  check('padrões preenchidos: modo live, escopo vazio, listas vazias',
    perfil.deploymentMode === 'live' && perfil.scope.include.length === 0 &&
    perfil.packageIds.length === 0 && perfil.pools.length === 0)
}
recusa('JSON quebrado é recusado', () => lerPerfil('{ nao e json'), 'não é JSON válido')
recusa('array não é um perfil', () => lerPerfil([]), 'precisa ser um objeto')
recusa('schemaVersion desconhecida é recusada', () => lerPerfil({ ...base, schemaVersion: 2 }), 'Perfil inválido')
recusa('propriedade desconhecida é recusada', () => lerPerfil({ ...base, extra: 1 }), 'Perfil inválido')
recusa('profileId vazio é recusado', () => lerPerfil({ ...base, profileId: '' }), 'Perfil inválido')
recusa('profileId com barra é recusado', () => lerPerfil({ ...base, profileId: '../x' }), 'Perfil inválido')
recusa('profileVersion fracionária é recusada', () => lerPerfil({ ...base, profileVersion: 1.5 }), 'Perfil inválido')
recusa('profileVersion zero é recusada', () => lerPerfil({ ...base, profileVersion: 0 }), 'Perfil inválido')
recusa('deploymentMode inválido é recusado', () => lerPerfil({ ...base, deploymentMode: 'turbo' }), 'Perfil inválido')
recusa('id de template com ".." é recusado', () => lerPerfil({ ...base, templateIds: ['../x'] }), 'Perfil inválido')
recusa('template repetido é recusado', () => lerPerfil({ ...base, templateIds: ['ping', 'ping'] }), 'Perfil inválido')
recusa('destino de escopo desconhecido é recusado', () => lerPerfil({ ...base, scope: { include: [{ kind: 'planeta' }] } }), 'Perfil inválido')
recusa('parâmetro que não é escalar é recusado', () => lerPerfil({ ...base, parametrosComuns: { poolId: { a: 1 } } }), 'Perfil inválido')
recusa('arquivo acima do limite é recusado', () => lerPerfil(' '.repeat(LIMITE_DO_ARQUIVO + 1)), 'passa de')
{
  const erro = (() => { try { lerPerfil({ ...base, extra: 1, profileVersion: 0 }) } catch (e) { return e } })()
  check('o erro de forma lista todos os problemas de uma vez', erro?.detalhes?.erros?.length >= 2, String(erro?.detalhes?.erros?.length))
  check('o erro de perfil é 400', erro?.status === 400, String(erro?.status))
}

// ---------------------------------------------------------------- hash

{
  const a = lerPerfil({ ...base, templateIds: ['ping'], scope: incluirGrupos, parametrosComuns: { poolId: 'p', b: 1 } })
  const b = lerPerfil({ parametrosComuns: { b: 1, poolId: 'p' }, scope: incluirGrupos, templateIds: ['ping'], profileVersion: 1, profileId: 'teste', schemaVersion: 1 })
  check('o hash não depende da ordem das propriedades', a.hash === b.hash)
  const c = lerPerfil({ ...base, templateIds: ['ping'], scope: { include: incluirGrupos.include }, parametrosComuns: { poolId: 'p', b: 1 }, deploymentMode: 'live', packageIds: [], pools: [], parameters: {} })
  check('escrever um padrão por extenso não muda o hash', a.hash === c.hash)
  const d = lerPerfil({ ...base, templateIds: ['ping'], scope: incluirGrupos, parametrosComuns: { poolId: 'outro', b: 1 } })
  check('mudar um parâmetro muda o hash', a.hash !== d.hash)
  check('o hash tem 64 hexadecimais', /^[0-9a-f]{64}$/.test(a.hash))
}

// ---------------------------------------------------------------- catálogo

const ok = (corpo) => lerPerfil({ ...base, scope: incluirGrupos, ...corpo }).perfil
validarContraCatalogo(ok({}), contexto)
check('perfil vazio passa no catálogo, mesmo sem escopo', (() => { validarContraCatalogo(lerPerfil(base).perfil, contexto); return true })())
validarContraCatalogo(ok({ packageIds: ['basico'] }), contexto)
check('pacote real passa', true)
validarContraCatalogo(ok({ templateIds: ['x9', 'apagar'] }), contexto)
check('templates reais passam', true)
recusa('pacote inexistente é recusado', () => validarContraCatalogo(ok({ packageIds: ['nao-existe'] }), contexto), 'Pacote não encontrado: nao-existe')
recusa('template inexistente é recusado', () => validarContraCatalogo(ok({ templateIds: ['nao-existe'] }), contexto), 'Template não encontrado no catálogo: nao-existe')
recusa('template que já está no pacote não pode ir também em templateIds',
  () => validarContraCatalogo(ok({ packageIds: ['basico'], templateIds: ['ping'] }), contexto), 'já faz parte do pacote "basico"')
recusa('instalar algo com scope.include vazio é recusado',
  () => validarContraCatalogo(lerPerfil({ ...base, templateIds: ['ping'] }).perfil, contexto), 'scope.include não pode ser vazio')
recusa('pool repetido é recusado',
  () => validarContraCatalogo(ok({ pools: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }), contexto), 'Pool repetido')
recusa('parameters para template que o perfil não instala é recusado',
  () => validarContraCatalogo(ok({ templateIds: ['ping'], parameters: { x9: { command: '/x' } } }), contexto), 'não instala')
{
  const erro = (() => { try { validarContraCatalogo(ok({ packageIds: ['nao-existe'], templateIds: ['tambem-nao'] }), contexto) } catch (e) { return e } })()
  check('o diagnóstico do catálogo junta todos os erros', erro?.detalhes?.erros?.length === 2, String(erro?.detalhes?.erros?.length))
}

// ---------------------------------------------------------------- escolhas

{
  const vazias = escolhasDoPerfil(lerPerfil(base).perfil)
  check('perfil vazio vira a escolha "vazia"', vazias.length === 1 && vazias[0].kind === 'vazia')
  const mista = escolhasDoPerfil(ok({ packageIds: ['basico', 'protecao'], templateIds: ['x9'], deploymentMode: 'shadow', parametrosComuns: { poolId: 'p' } }))
  check('um pacote por escolha, mais uma escolha para os avulsos',
    mista.map((e) => e.kind).join() === 'pacote,pacote,especificas', mista.map((e) => e.kind).join())
  check('a ordem pedida é preservada', mista[0].packageId === 'basico' && mista[1].packageId === 'protecao')
  check('escopo, modo e parâmetros valem para todas as escolhas',
    mista.every((e) => e.deploymentMode === 'shadow' && e.parametrosComuns.poolId === 'p' && e.scope.include.length === 1))
  check('os avulsos vão como templateIds', mista[2].templateIds.join() === 'x9')
  check('sem avulsos não nasce escolha "especificas"', escolhasDoPerfil(ok({ packageIds: ['basico'] })).length === 1)
}

// ---------------------------------------------------------------- política

{
  const politica = lerPolitica({ schemaVersion: 1, allowedPackageIds: ['basico'], allowedTemplateIds: ['x9'] })
  aplicarPolitica(ok({ packageIds: ['basico'], templateIds: ['x9'] }), politica)
  check('o que a política permite passa', true)
  aplicarPolitica(ok({ packageIds: ['basico'], templateIds: ['x9'] }), null)
  check('política ausente permite tudo', true)
  aplicarPolitica(ok({ packageIds: ['administracao'] }), lerPolitica({ schemaVersion: 1 }))
  check('política sem listas não limita nada', true)
  recusa('pacote fora da política recusa o perfil', () => aplicarPolitica(ok({ packageIds: ['protecao'] }), politica), 'não permite o pacote "protecao"')
  recusa('template fora da política recusa o perfil', () => aplicarPolitica(ok({ templateIds: ['apagar'] }), politica), 'não permite o template "apagar"')
  const erro = (() => { try { aplicarPolitica(ok({ packageIds: ['protecao'], templateIds: ['apagar'] }), politica) } catch (e) { return e } })()
  check('a política recusa o perfil INTEIRO e lista tudo que excede', erro?.detalhes?.erros?.length === 2 && erro.status === 409)
  recusa('política com propriedade desconhecida é recusada', () => lerPolitica({ schemaVersion: 1, teto: 3 }), 'Política inválida')
  recusa('política com JSON quebrado é recusada', () => lerPolitica('{'), 'não é JSON válido')
}

console.log(falhas === 0
  ? '\nO PERFIL SÓ ENTRA SE A FORMA, O CATÁLOGO E A POLÍTICA FECHAREM\n'
  : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
