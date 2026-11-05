// Leitura de um arquivo de configuração que o OPERADOR aponta (perfil e
// política de provisionamento). O caminho vem de variável de ambiente ou de
// opção da linha de comando, então a leitura confere o que está sendo lido:
// seguir um link até um dispositivo ou um arquivo enorme não pode custar
// memória nem travar o boot.
import fs from 'fs'

export function lerArquivoRegular (caminho, limiteBytes) {
  if (typeof caminho !== 'string' || !caminho) throw new Error('Caminho de arquivo vazio.')
  let real
  try { real = fs.realpathSync(caminho) } catch (erro) {
    throw new Error(`Não consegui abrir ${caminho}: ${erro.code === 'ENOENT' ? 'o arquivo não existe' : erro.message}.`)
  }
  const info = fs.statSync(real)
  if (!info.isFile()) throw new Error(`${caminho} não é um arquivo regular.`)
  if (info.size > limiteBytes) throw new Error(`${caminho} passa de ${limiteBytes} bytes.`)
  return fs.readFileSync(real, 'utf8')
}
