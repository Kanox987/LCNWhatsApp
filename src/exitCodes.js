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
