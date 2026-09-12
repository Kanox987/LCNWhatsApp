// Resolve um accountId estável pra este gateway — não existe hoje em lugar
// nenhum (nem no zapo-js, nem no resto deste repo: SESSION_ID em
// connection.js é fixo, 'default'). O motor de automação (Parte B) precisa
// de uma identidade estável por instância pra saber "quem" mandou um evento
// canônico, mesmo antes da Parte A (multi-instância) estar rodando de
// verdade — por isso a ordem de resolução cobre os três cenários possíveis:
// já dentro de uma instância Quadlet, configurado manualmente, ou nenhum
// dos dois (single-instance de sempre, gera e persiste um id na primeira vez).
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// env.LCN_INSTANCE_ID > cfg.instancia.id > arquivo persistido > gerado uma vez.
// O arquivo persistido garante que mesmo uma instalação single-instance
// antiga (sem nunca ter passado pela Parte A) tem um accountId ESTÁVEL entre
// reinícios — sem isso, cada restart geraria um id novo e o motor nunca
// reconheceria "é o mesmo bot de antes".
export function resolverAccountId ({ env = process.env, cfg = {}, pastaDados, gerarId = () => crypto.randomUUID() } = {}) {
  if (env.LCN_INSTANCE_ID) return env.LCN_INSTANCE_ID
  if (cfg?.instancia?.id) return cfg.instancia.id

  const arquivo = path.join(pastaDados, 'instance-id.txt')
  try {
    const existente = fs.readFileSync(arquivo, 'utf8').trim()
    if (existente) return existente
  } catch { /* ainda não existe ou ilegível — gera abaixo */ }

  const novo = gerarId()
  try {
    fs.mkdirSync(pastaDados, { recursive: true })
    fs.writeFileSync(arquivo, novo)
  } catch { /* melhor esforço — se não conseguir persistir, ainda retorna um id válido pra esta execução */ }
  return novo
}
