// Gera src/engine/templates/pacotes/pacotes.lock.json a partir do catálogo de
// templates e dos manifestos de pacote. O arquivo NÃO é escrito à mão de
// propósito: ele carrega a composição RESOLVIDA (dependências transitivas
// incluídas), as conexões derivadas do fluxo compilado e um hash de conteúdo
// por template — três coisas que ninguém mantém à mão sem errar.
//
// O papel dele é ser a composição REVISADA: `npm run pacotes:trava` reescreve,
// a pessoa lê o diff e decide. `tests/pacotes-manifesto.test.mjs` falha se o
// arquivo no repositório não for igual ao que este gerador produz — então
// template editado sem subir `templateVersion`, ou dependência nova entrando
// de carona, aparece como mudança que alguém precisa aprovar.
import fs from 'fs'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { carregarPacotes, montarTrava, ARQUIVO_TRAVA } from '../src/engine/templates/pacotes.js'

const trava = montarTrava(carregarCatalogo(), carregarPacotes())
fs.writeFileSync(ARQUIVO_TRAVA, JSON.stringify(trava, null, 2) + '\n')

for (const [packageId, pacote] of Object.entries(trava.pacotes)) {
  const pedidos = pacote.membros.filter((m) => m.origem === 'pedido').length
  const dependencias = pacote.membros.length - pedidos
  console.log(`${packageId} v${pacote.packageVersion}: ${pedidos} pedidos + ${dependencias} dependência(s)` +
    `${pacote.conexoesExigidas.length ? `, conexões: ${pacote.conexoesExigidas.join(', ')}` : ', sem serviço externo'}`)
}
console.log(`\n${ARQUIVO_TRAVA}`)
