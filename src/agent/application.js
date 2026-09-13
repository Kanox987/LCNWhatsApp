// Módulo 3/4 da Etapa 4.5 — a "application service" recomendada na consulta
// de arquitetura registrada no plano: TODA a lógica de negócio do agente/data plane
// mora aqui, nem em `src/web/server.js` (Módulo 4, vira só transporte HTTP
// local) nem espalhada. O objetivo é este MESMO objeto ser reaproveitado
// depois atrás de um transporte diferente (WSS hospedado) sem reescrever
// nada — só troca quem chama estes métodos.
import { criarInstanceService } from './instanceService.js'
import { criarDirectoryService } from './directoryService.js'
import { criarClienteEngine } from '../engine/client.js'

export function criarAplicacao ({
  instanceService = criarInstanceService(),
  directoryService = criarDirectoryService(),
  engineClient = criarClienteEngine()
} = {}) {
  return {
    instancias: {
      listar: () => instanceService.listar(),
      obter: (id) => instanceService.obter(id),
      iniciar: (id) => instanceService.iniciar(id),
      parar: (id) => instanceService.parar(id),
      reiniciar: (id) => instanceService.reiniciar(id),
      // ATENÇÃO — CREDENCIAL SENSÍVEL: devolve QR/código de pareamento em
      // claro (ver aviso em instanceService.js). Só é seguro sem controle
      // de acesso porque este objeto hoje só é consumido por um transporte
      // 127.0.0.1. Adicionar autorização por workspace/instalação ANTES de
      // reaproveitar este método atrás do WSS hospedado.
      pareamento: (id) => instanceService.pareamento(id),
      obterOtimizacao: (id) => instanceService.obterOtimizacao(id),
      definirOtimizacao: (id, patch) => instanceService.definirOtimizacao(id, patch),
      obterUso: (id) => instanceService.obterUso(id),
      obterLogs: (id, linhas) => instanceService.obterLogs(id, linhas)
    },
    diretorio: {
      listar: (instanciaId, opcoes) => directoryService.listar(instanciaId, opcoes)
    },
    // Repassa pro motor sem esconder a forma da API dele — os Módulos 1/2
    // definem o contrato real de automations/executions; aqui é só o ponto
    // único de acesso pro resto do agente não importar client.js direto em
    // vários lugares.
    motor: engineClient
  }
}
