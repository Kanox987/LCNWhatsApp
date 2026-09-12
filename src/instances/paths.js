// Caminhos do lado do HOST pra múltiplas instâncias (Parte A do plano de
// multi-instância). Diferente de src/paths.js (que é sempre relativo à RAIZ
// de UM checkout/container), isto vive em ~/.local/share/lcnwhatsapp — um
// único git clone/instalação do lcn gerencia N instâncias independentes,
// cada uma com seu próprio diretório de dados. Convenção nova, deliberada
// (o projeto não usava XDG em lugar nenhum antes disso) — ver Parte A do
// plano, seção "Pontos em aberto" da Parte B, item 3.
import os from 'os'
import path from 'path'

export const PASTA_LCN = path.join(os.homedir(), '.local', 'share', 'lcnwhatsapp')
export const PASTA_INSTANCIAS = path.join(PASTA_LCN, 'instances')
export const ARQ_REGISTRO = path.join(PASTA_LCN, 'registry.json')
export const PASTA_MODELOS_COMPARTILHADA = path.join(PASTA_LCN, 'modelos')

// Unit Quadlet fica em ~/.config/containers/systemd — local fixo do Podman
// rootless pra unidades de usuário, não é uma convenção nossa.
export const PASTA_UNITS_QUADLET = path.join(os.homedir(), '.config', 'containers', 'systemd')

export function caminhoInstancia (id) {
  return path.join(PASTA_INSTANCIAS, id)
}

export function caminhoUnit (id) {
  return path.join(PASTA_UNITS_QUADLET, `lcn-${id}.container`)
}

export function nomeContainer (id) {
  return `lcn-${id}`
}
