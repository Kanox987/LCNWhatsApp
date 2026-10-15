// Ligar e desligar o PROCESSO de um número do modo simples, pelo painel.
//
// O QUE ISTO CONSERTA. Um segundo número é uma pasta mais um processo rodando
// com `LCN_INSTANCIA=<nome>`. O painel listava esse número e oferecia os
// botões — e mandava a ação para `systemctl --user ${containerName}.service`,
// que instância descoberta NÃO TEM. Virava `undefined.service`, e a pessoa
// lia um erro sobre uma unidade que nunca existiu.
//
// Botão que não pode funcionar é pior que botão ausente: quem tenta e recebe
// um erro sem sentido deixa de confiar no resto da tela.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { iniciar, parar, reiniciar } from '../src/agent/processoDaInstancia.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-proc-'))
const arqPid = path.join(tmp, 'bot.pid')
// `iniciar` confere que o index.js existe antes de gastar um spawn — a raiz
// falsa precisa ter um.
fs.writeFileSync(path.join(tmp, 'index.js'), '// nada')

function spawnFalso () {
  const chamadas = []
  const fn = (execPath, args, opcoes) => {
    chamadas.push({ execPath, args, opcoes })
    return { pid: 4242, unref () {} }
  }
  return { fn, chamadas }
}

// --- ligar ---------------------------------------------------------------
{
  const s = spawnFalso()
  const r = iniciar('pessoal', arqPid, { spawnFn: s.fn, raiz: tmp })
  check('ligar devolve ok', r.ok === true, r.out)
  check('e diz o pid, para quem for procurar o processo', /4242/.test(r.out), r.out)

  const chamada = s.chamadas[0]
  check('roda o index.js do projeto', chamada.args[0] === path.join(tmp, 'index.js'), chamada.args[0])
  // É esta variável que dá a ele a própria sessão, o próprio estado e a
  // própria pasta de mídia (src/paths.js). Sem ela, o segundo número abriria
  // a sessão do primeiro.
  check('com LCN_INSTANCIA dizendo de quem é a vez', chamada.opcoes.env.LCN_INSTANCIA === 'pessoal',
    chamada.opcoes.env.LCN_INSTANCIA)
  // Destacado: o número não pode morrer junto com o painel.
  check('destacado do painel', chamada.opcoes.detached === true)
  check('e sem herdar a saída do painel', chamada.opcoes.stdio === 'ignore')
}

// --- já rodando não liga duas vezes -------------------------------------
//
// Dois processos na mesma sessão é o que o invariante 8 existe para impedir.
// A trava de sistema operacional pegaria, mas deixar chegar lá significaria
// subir um processo para ele morrer — e a pessoa lendo "iniciado" na tela.
{
  fs.writeFileSync(arqPid, String(process.pid))
  const s = spawnFalso()
  const r = iniciar('pessoal', arqPid, { spawnFn: s.fn, raiz: tmp })
  check('com o processo vivo, não liga de novo', r.ok === false, r.out)
  check('e nada foi executado', s.chamadas.length === 0, String(s.chamadas.length))
  check('a mensagem nomeia o número e o pid', /pessoal/.test(r.out) && /\d+/.test(r.out), r.out)
}

// --- pid-file velho não bloqueia ----------------------------------------
//
// Processo que morreu de queda deixa o arquivo para trás. Tratar isso como
// "já está rodando" deixaria o número impossível de ligar pela tela, sem
// explicação nenhuma.
{
  fs.writeFileSync(arqPid, '999999')
  const s = spawnFalso()
  const r = iniciar('pessoal', arqPid, { spawnFn: s.fn, raiz: tmp })
  check('pid-file de processo morto não impede ligar', r.ok === true, r.out)
  check('e o processo novo sobe', s.chamadas.length === 1)
}

// --- desligar ------------------------------------------------------------
{
  fs.writeFileSync(arqPid, '999999')
  const r = parar('pessoal', arqPid)
  check('parar um que já não rodava diz isso, em vez de "parado"', r.ok === false, r.out)
  check('e limpa o pid-file velho no caminho', !fs.existsSync(arqPid))
}
{
  const r = parar('pessoal', arqPid)
  check('sem pid-file nenhum, a mensagem explica', r.ok === false && /pid-file/.test(r.out), r.out)
}

// --- reiniciar -----------------------------------------------------------
{
  const s = spawnFalso()
  const r = reiniciar('pessoal', arqPid, { spawnFn: s.fn, raiz: tmp })
  check('reiniciar liga mesmo quando não havia nada rodando', r.ok === true, r.out)
  check('e sobe um processo só', s.chamadas.length === 1, String(s.chamadas.length))
}

// --- sem index.js, não gasta spawn --------------------------------------
{
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-vazio-'))
  const s = spawnFalso()
  const r = iniciar('x', path.join(vazio, 'bot.pid'), { spawnFn: s.fn, raiz: vazio })
  check('sem index.js, recusa com motivo', r.ok === false && /index\.js/.test(r.out), r.out)
  check('e não tenta executar nada', s.chamadas.length === 0)
  fs.rmSync(vazio, { recursive: true, force: true })
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE PROCESSO DE INSTÂNCIA PASSARAM')
process.exit(falhas ? 1 : 0)
