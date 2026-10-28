// A urna: contar os votos que já chegavam e eram jogados fora.
//
// Medido numa captura de 40 minutos da produção em 27/10: 17 pacotes
// `pollUpdateMessage`, todos registrados como "mensagem desconhecida" e
// descartados. Mesma situação dos eventos de grupo antes do porteiro.
//
// O que torna isto possível sem importar nada de dentro da biblioteca: o voto
// traz o SHA-256 do nome da opção, e o bot conhece os nomes porque foi ele que
// abriu a enquete. O resolvedor da biblioteca existe mas NÃO é exportado da
// raiz do pacote — usá-lo seria acoplar a caminho interno.
import crypto from 'crypto'
import {
  registrarEnquete, registrarVotoPorHash, apurar, ultimaDaConversa, limparTudo, quantasGuardadas
} from '../src/engine/urnaDeEnquetes.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const hash = (nome) => crypto.createHash('sha256').update(nome, 'utf8').digest()

const GRUPO = '120363000000000033@g.us'

limparTudo()

// =========================================================================
// 1. O CAMINHO NORMAL
// =========================================================================
registrarEnquete({ pollId: 'P1', chatId: GRUPO, opcoes: ['Segunda', 'Terça', 'Quarta'] })
registrarVotoPorHash({ pollId: 'P1', quem: 'a@s', hashes: [hash('Segunda')] })
registrarVotoPorHash({ pollId: 'P1', quem: 'b@s', hashes: [hash('Terça')] })
registrarVotoPorHash({ pollId: 'P1', quem: 'c@s', hashes: [hash('Terça')] })

{
  const r = apurar('P1')
  check('conta os votos por opção', JSON.stringify(r.opcoes) === JSON.stringify([{ opcao: 'Terça', votos: 2 }, { opcao: 'Segunda', votos: 1 }]), JSON.stringify(r.opcoes))
  check('e conta quantas pessoas votaram', r.votantes === 3, String(r.votantes))
}

// =========================================================================
// 2. TROCAR DE VOTO SUBSTITUI, não soma
// =========================================================================
// O WhatsApp deixa trocar, e trocar manda outro pacote. Somar contaria a mesma
// pessoa duas vezes e o total passaria do número de gente no grupo.
registrarVotoPorHash({ pollId: 'P1', quem: 'a@s', hashes: [hash('Terça')] })
{
  const r = apurar('P1')
  check('quem trocou não conta duas vezes', r.votantes === 3, String(r.votantes))
  check('o voto novo é o que vale', r.opcoes[0].opcao === 'Terça' && r.opcoes[0].votos === 3, JSON.stringify(r.opcoes))
  check('e a opção antiga some quando ninguém mais a escolhe', r.opcoes.length === 1, JSON.stringify(r.opcoes))
}

// =========================================================================
// 3. DESMARCAR É VOTO VÁLIDO
// =========================================================================
registrarVotoPorHash({ pollId: 'P1', quem: 'a@s', hashes: [] })
check('desmarcar baixa a contagem', apurar('P1').opcoes[0].votos === 2, JSON.stringify(apurar('P1').opcoes))

// =========================================================================
// 4. VOTO EM OPÇÃO DESCONHECIDA É DESCARTADO, não vira hash na tela
// =========================================================================
registrarVotoPorHash({ pollId: 'P1', quem: 'z@s', hashes: [hash('Domingo')] })
{
  const r = apurar('P1')
  check('opção que não é desta enquete não entra',
    r.opcoes.every((o) => ['Segunda', 'Terça', 'Quarta'].includes(o.opcao)), JSON.stringify(r.opcoes))
}

// =========================================================================
// 5. ENQUETE QUE O BOT NÃO ABRIU NÃO É CONTADA
// =========================================================================
// Sem os nomes das opções não há como traduzir o hash, e mostrar hash para
// alguém seria pior que não responder.
check('voto em enquete desconhecida é recusado',
  registrarVotoPorHash({ pollId: 'NAO-EXISTE', quem: 'a@s', hashes: [hash('Segunda')] }) === false)
check('e ela não aparece na apuração', apurar('NAO-EXISTE') === null)

// =========================================================================
// 6. A ÚLTIMA DA CONVERSA — para o comando não exigir id de mensagem
// =========================================================================
registrarEnquete({ pollId: 'P2', chatId: GRUPO, opcoes: ['Sim', 'Não'], emMs: Date.now() + 1000 })
registrarVotoPorHash({ pollId: 'P2', quem: 'a@s', hashes: [hash('Sim')], emMs: Date.now() + 2000 })
check('a última da conversa é a que recebeu voto por último', ultimaDaConversa(GRUPO) === 'P2', ultimaDaConversa(GRUPO))
check('conversa sem enquete nenhuma devolve nada', ultimaDaConversa('outro@g.us') === null)

// =========================================================================
// 7. A URNA NÃO CRESCE SEM FIM
// =========================================================================
// Uma instância esquecida no ar por meses não pode virar um vazamento.
limparTudo()
for (let i = 0; i < 260; i++) {
  registrarEnquete({ pollId: `X${i}`, chatId: GRUPO, opcoes: ['a', 'b'], emMs: 1000 + i })
}
check('a urna tem teto', quantasGuardadas() <= 200, String(quantasGuardadas()))
check('e o que sai é o mais antigo', apurar('X0') === null && apurar('X259') !== null)

limparTudo()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DA URNA DE ENQUETES PASSARAM')
process.exit(falhas ? 1 : 0)
