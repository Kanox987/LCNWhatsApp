// Geração de arquivos .wastickers e empacotamento de figurinhas.
//
// O QUE É O FORMATO .wastickers:
// É um arquivo ZIP padrão utilizado por aplicativos de figurinhas de terceiros
// (como o Sticker Maker Studio da Viko & Co) para empacotar e importar conjuntos
// de figurinhas no WhatsApp no celular.
//
// ESTRUTURA DO ARQUIVO:
//   - title.txt: texto UTF-8 puro com o nome do pacote
//   - author.txt: texto UTF-8 puro com o autor do pacote
//   - figurinhas em formato WebP (ou PNG), até 30 por pacote
//   - tray_icon.png ou cover: miniatura de exibição na bandeja
//
// SEM DEPENDÊNCIAS EXTERNAS:
// O formato ZIP com armazenamento sem compressão (método STORE 0) é montado
// diretamente via manipulação de Buffer/DataView em JavaScript puro no Node.js,
// garantindo compatibilidade sem acrescentar pacotes ao package.json.

const SIGNATURE_LOCAL_FILE = 0x04034b50
const SIGNATURE_CENTRAL_DIR = 0x02014b50
const SIGNATURE_EOCD = 0x06054b50
const COMPRESSION_STORED = 0
const VERSION_NEEDED = 20
const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

// Tabela estática de CRC32 para cálculo de integridade do ZIP
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
})()

export function calcularCrc32 (bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function buildLocalHeader (nameBytes, crc, dataLength) {
  const out = Buffer.alloc(LOCAL_HEADER_SIZE + nameBytes.length)
  out.writeUInt32LE(SIGNATURE_LOCAL_FILE, 0)
  out.writeUInt16LE(VERSION_NEEDED, 4)
  out.writeUInt16LE(0, 6) // flags
  out.writeUInt16LE(COMPRESSION_STORED, 8)
  out.writeUInt16LE(0, 10) // mod time
  out.writeUInt16LE(0, 12) // mod date
  out.writeUInt32LE(crc, 14)
  out.writeUInt32LE(dataLength, 18) // comp size
  out.writeUInt32LE(dataLength, 22) // uncomp size
  out.writeUInt16LE(nameBytes.length, 26)
  out.writeUInt16LE(0, 28) // extra len
  nameBytes.copy(out, LOCAL_HEADER_SIZE)
  return out
}

function buildCentralDirectory (entries) {
  let totalSize = 0
  for (const e of entries) totalSize += CENTRAL_HEADER_SIZE + e.nameBytes.length
  const out = Buffer.alloc(totalSize)
  let offset = 0
  for (const e of entries) {
    out.writeUInt32LE(SIGNATURE_CENTRAL_DIR, offset)
    out.writeUInt16LE(VERSION_NEEDED, offset + 4)
    out.writeUInt16LE(VERSION_NEEDED, offset + 6)
    out.writeUInt16LE(0, offset + 8) // flags
    out.writeUInt16LE(COMPRESSION_STORED, offset + 10)
    out.writeUInt16LE(0, offset + 12) // mod time
    out.writeUInt16LE(0, offset + 14) // mod date
    out.writeUInt32LE(e.crc, offset + 16)
    out.writeUInt32LE(e.dataLength, offset + 20)
    out.writeUInt32LE(e.dataLength, offset + 24)
    out.writeUInt16LE(e.nameBytes.length, offset + 28)
    out.writeUInt16LE(0, offset + 30) // extra len
    out.writeUInt16LE(0, offset + 32) // comment len
    out.writeUInt16LE(0, offset + 34) // disk start
    out.writeUInt16LE(0, offset + 36) // int attrs
    out.writeUInt32LE(0, offset + 38) // ext attrs
    out.writeUInt32LE(e.localOffset, offset + 42)
    e.nameBytes.copy(out, offset + CENTRAL_HEADER_SIZE)
    offset += CENTRAL_HEADER_SIZE + e.nameBytes.length
  }
  return out
}

function buildEocd (entryCount, centralDirSize, centralDirOffset) {
  const out = Buffer.alloc(EOCD_SIZE)
  out.writeUInt32LE(SIGNATURE_EOCD, 0)
  out.writeUInt16LE(0, 4) // disk number
  out.writeUInt16LE(0, 6) // start disk
  out.writeUInt16LE(entryCount, 8)
  out.writeUInt16LE(entryCount, 10)
  out.writeUInt32LE(centralDirSize, 12)
  out.writeUInt32LE(centralDirOffset, 16)
  out.writeUInt16LE(0, 20) // comment len
  return out
}

/**
 * Monta o arquivo ZIP binário do .wastickers contendo os metadados (title.txt,
 * author.txt) e os arquivos das figurinhas.
 *
 * @param {Object} opcoes
 * @param {string} opcoes.titulo Nome do pacote
 * @param {string} opcoes.autor Nome do autor/criador
 * @param {Array<{ nome: string, buffer: Buffer }>} opcoes.figurinhas Lista de figurinhas
 * @param {Buffer} [opcoes.cover] Miniatura opcional para a capa
 * @returns {Buffer} Buffer do arquivo ZIP (.wastickers)
 */
export function montarWastickersZip ({ titulo = 'Pacote', autor = 'LCN', figurinhas = [], cover = null }) {
  const itens = []

  // 1. title.txt e author.txt no topo
  itens.push({ nome: 'title.txt', buffer: Buffer.from(String(titulo || 'Pacote').trim(), 'utf8') })
  itens.push({ nome: 'author.txt', buffer: Buffer.from(String(autor || 'LCN').trim(), 'utf8') })

  // 2. Capa se fornecida
  if (cover && Buffer.isBuffer(cover)) {
    itens.push({ nome: 'tray_icon.png', buffer: cover })
  }

  // 3. Figurinhas (até 30)
  const limiteFigurinhas = figurinhas.slice(0, 30)
  for (let i = 0; i < limiteFigurinhas.length; i++) {
    const fig = limiteFigurinhas[i]
    let nomeArquivo = fig.nome || `sticker_${i + 1}.webp`
    if (!nomeArquivo.endsWith('.webp') && !nomeArquivo.endsWith('.png')) {
      nomeArquivo += '.webp'
    }
    itens.push({ nome: nomeArquivo, buffer: fig.buffer })
  }

  const partes = []
  const central = []
  let offset = 0

  for (const item of itens) {
    const nameBytes = Buffer.from(item.nome, 'utf8')
    const data = item.buffer
    const crc = calcularCrc32(data)
    const header = buildLocalHeader(nameBytes, crc, data.length)

    partes.push(header)
    partes.push(data)

    central.push({
      nameBytes,
      crc,
      dataLength: data.length,
      localOffset: offset
    })

    offset += header.length + data.length
  }

  const centralDir = buildCentralDirectory(central)
  const eocd = buildEocd(central.length, centralDir.length, offset)

  partes.push(centralDir)
  partes.push(eocd)

  return Buffer.concat(partes)
}
