// Utilidades pequenas e compartilhadas entre capture.js, connection.js,
// directory.js e dashboard.js.

// Extrai só os dígitos de um número, aceitando tanto um JID completo
// ("5511999999999:19@s.whatsapp.net") quanto um número já solto.
export const soDigitos = (v) => String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '')
