// Estado do motor central. Este módulo é separado de instances/paths.js:
// ambos compartilham a convenção XDG em ~/.local/share/lcnwhatsapp, mas
// representam subsistemas com ciclos de vida independentes.
import os from 'os'
import path from 'path'

export const PASTA_ENGINE = path.join(os.homedir(), '.local', 'share', 'lcnwhatsapp', 'engine')
export const ARQ_DB = path.join(PASTA_ENGINE, 'engine.sqlite')
export const PASTA_RUN = path.join(PASTA_ENGINE, 'run')
export const SOCKET_PATH = path.join(PASTA_RUN, 'engine.sock')
export const ARQ_PID_ENGINE = path.join(PASTA_RUN, 'engine.pid')
export const ARQ_LOG_ENGINE = path.join(PASTA_ENGINE, 'engine.log')
