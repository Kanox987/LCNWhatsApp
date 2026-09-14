// Resposta binária do painel: o único caminho pelo qual bytes de arquivo saem
// do servidor local. Mora num módulo próprio (e não em server.js) porque o
// servidor importa o roteador — o roteador importar o servidor de volta
// fecharia um ciclo.
//
// Os cabeçalhos aqui não são enfeite. O acervo já limita o tipo do arquivo na
// entrada; estes limitam o que o NAVEGADOR faz com ele na saída:
//   - `nosniff` impede o navegador de adivinhar um tipo diferente do que o
//     acervo aceitou e gravou.
//   - `default-src 'none'; sandbox` neutraliza script dentro de conteúdo
//     embutido. Importa para PDF, que em alguns leitores executa JavaScript —
//     e este servidor é a mesma origem do painel.
//   - `inline` só para imagem, áudio e vídeo, que não têm como executar nada.
//     PDF e texto saem como anexo, para não virarem documento navegável na
//     origem do painel.
//   - `no-store` porque um id apagado não pode continuar aparecendo do cache.
const MARCA = '__respostaBinaria'

const TIPOS_INLINE = new Set(['image', 'audio', 'video'])

export function respostaBinaria ({ buffer, mimetype, name, kind }) {
  return { [MARCA]: true, buffer, mimetype, name, kind }
}

export function ehRespostaBinaria (valor) {
  return Boolean(valor && valor[MARCA])
}

// O nome vira só o rótulo do Content-Disposition. Ele já passou pelo
// saneamento do acervo, mas aspas e quebra de linha ainda quebrariam o
// cabeçalho — por isso o filtro final acontece aqui, onde o cabeçalho nasce.
function nomeParaCabecalho (nome) {
  const limpo = String(nome || 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 100)
  return limpo || 'arquivo'
}

export function enviarBinario (res, { buffer, mimetype, name, kind }) {
  const disposicao = TIPOS_INLINE.has(kind) ? 'inline' : 'attachment'
  res.writeHead(200, {
    'content-type': mimetype || 'application/octet-stream',
    'content-length': buffer.length,
    'content-disposition': `${disposicao}; filename="${nomeParaCabecalho(name)}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'no-store'
  })
  res.end(buffer)
}
