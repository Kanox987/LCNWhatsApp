// A FILA DE EXECUÇÃO DE COMANDO.
//
// O relato do dono: "quando foi solicitado várias requisições o bot ficou
// extremamente lento e não processou corretamente, teve até msg fora do
// carrossel como resposta do buscar".
//
// O log do número dele mostra a causa, e ela não é o motor:
//
//   query node timeout { id: '56314.47116-46', timeoutMs: 15000 }
//   [engine] Falha ao executar o comando ... (connection.call):
//            Error: query timeout (56314.47116-46) after 15000ms
//
// É o SOCKET DO WHATSAPP engasgado. Cada mensagem que chega abre a sua própria
// cadeia de promessas e executa os comandos dela na hora, sem ninguém contando
// quantas estão em curso. Cinco `/buscar` ao mesmo tempo são vinte e cinco
// capas baixadas e vinte e cinco enviadas ao servidor de mídia — tudo pela
// mesma conexão, ao mesmo tempo. O que sobra é timeout: o carrossel não sai, a
// queda manda a lista em texto (foi a "msg fora do carrossel"), e o que estava
// atrás espera.
//
// O recurso disputado é a CONEXÃO, que é uma só. Então existe uma fila, e ela
// tem três propriedades que importam:
//
//   - LIMITE, não serialização. Serializar tudo faria um "/ping" esperar dois
//     minutos atrás de uma melhoria de foto em 4K. O limite deixa os rápidos
//     passarem e impede a enxurrada.
//   - ORDEM. Quem chegou primeiro sai primeiro: sem isso, numa rajada, o
//     último pedido podia ser atendido antes do primeiro, sem explicação
//     nenhuma para quem esperava.
//   - FALHA ISOLADA. Um comando que estoura não pode derrubar a fila nem
//     segurar a vaga: a vaga é devolvida no `finally`, sempre.
//
// O número do limite é configurável e o padrão é dois. Padrão sensato sim,
// teto no código não — quem rodar numa máquina folgada sobe, quem estiver em
// 3,8 GB de RAM com IA do lado desce.
export const LIMITE_PADRAO = 2

export function criarFila ({ limite = LIMITE_PADRAO, aoMudar = null } = {}) {
  const teto = Number.isFinite(limite) && limite >= 1 ? Math.floor(limite) : LIMITE_PADRAO
  const esperando = []
  let emCurso = 0

  const avisar = () => { if (aoMudar) aoMudar({ emCurso, esperando: esperando.length, limite: teto }) }

  function seguir () {
    if (emCurso >= teto || !esperando.length) return
    const { tarefa, resolver, rejeitar } = esperando.shift()
    emCurso++
    avisar()
    Promise.resolve()
      .then(tarefa)
      .then(resolver, rejeitar)
      .finally(() => {
        emCurso--
        avisar()
        seguir()
      })
  }

  return {
    // Devolve a MESMA promessa que a tarefa devolveria — quem chamou continua
    // podendo esperar o fim e tratar o erro como se não houvesse fila.
    executar (tarefa) {
      return new Promise((resolver, rejeitar) => {
        esperando.push({ tarefa, resolver, rejeitar })
        // Avisa DEPOIS de tentar seguir: quando há vaga, a tarefa sai da fila
        // na mesma volta e ninguém esperou nada. Avisar antes faria o caminho
        // feliz anunciar uma espera que não existiu.
        seguir()
        avisar()
      })
    },
    get estado () {
      return { emCurso, esperando: esperando.length, limite: teto }
    }
  }
}
