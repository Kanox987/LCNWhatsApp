# Baixo consumo de hardware

Ajustes no painel (`lcn` > Configurações > Hardware) ou no `config.json`:

- **maxMidiaMB** — descarta mídias grandes demais (evita picos de RAM/disco).
- **downloadConcorrencia** — quantos downloads simultâneos (1–2 é leve).
- **logLevel** — `silent` em produção.
- **markOnline** — deixe `false`: além de privacidade, evita tráfego extra.
- **debug** — deixe `false` em produção (loga cada mensagem). Ligue só pra
  diagnosticar; ver [SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md).

No **container**, limite recursos de verdade:
- compose: `deploy.resources.limits.memory` / `cpus`.
- `run.sh`: flags `--memory` e `--cpus`.

No **seco** com PM2: `max_memory_restart` no `ecosystem.config.cjs` reinicia o
processo se passar do limite de RAM.

A maior economia vem do descarte pré-crypto — ver PERFORMANCE.md.
