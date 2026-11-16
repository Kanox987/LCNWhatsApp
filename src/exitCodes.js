// Códigos de saída específicos pros estados terminais de conexão — permitem
// ao systemd (Quadlet, Parte A do plano de múltiplas instâncias) diferenciar
// "reinicia sozinho" de "não reinicia, precisa de intervenção humana" via
// RestartPreventExitStatus. Só têm efeito quando LCN_SUPERVISED=systemd (ver
// src/connection.js) — fora disso o processo fica vivo em vez de sair, pra
// não quebrar quem ainda usa docker-compose/PM2 (restart incondicional).
export const EXIT_LOGOUT_REPAIR_NEEDED = 21
export const EXIT_CONFLICT = 22
export const EXIT_FATAL_ACCOUNT = 23
export const EXIT_QUARANTINED = 24

// Saída depois de "trocar número": o processo termina BEM, mas precisa voltar
// para mostrar o QR novo. Sob systemd (Restart=on-failure) um código 0 deixaria
// a unidade parada; 75 (EX_TEMPFAIL) faz o systemd religar e não está em
// RestartPreventExitStatus. Fora do systemd (container, PM2) continua 0: lá o
// reinício é incondicional.
export const EXIT_RESTART_REQUESTED = 75

export function codigoDeSaidaParaReinicio (env = process.env) {
  return env.LCN_SUPERVISED === 'systemd' ? EXIT_RESTART_REQUESTED : 0
}
