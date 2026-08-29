# Transcrição de áudio (opcional)

Extra plugável. Nunca derruba a captura: se falhar ou estiver `off`, a mídia é
salva/reenviada sem transcrição. Configure em `lcn` > Configurações > Transcrição.

## Além da visu única

Originalmente a transcrição só rodava em áudio de visualização única capturado.
Agora também dá pra transcrever áudio normal:

- **Transcrição automática por conversa**: em `lcn` > Configurações > Transcrição
  por conversa, marque `auto: sim` pra uma conversa (contato ou grupo) — todo
  áudio normal que chegar ali é transcrito e a resposta volta na própria
  conversa, sem precisar de comando.
- **Comando `/transcrever`**: responda (cite) qualquer áudio com o texto
  `/transcrever` e o bot transcreve e responde na mesma conversa. Quem pode usar
  o comando depende de `transcricao.comandoTerceiros` (padrão: só o dono da
  conta, respondendo de qualquer dispositivo logado na sua conta — mesmo modelo
  do `/recover`) — cada conversa pode sobrepor esse padrão individualmente.

Nos dois casos, o áudio baixado é temporário: existe só durante a transcrição e
é apagado em seguida (não é arquivado como uma "captura").

## Provedores
- **off** (padrão) — sem transcrição.
- **faster-whisper** — local, sem nuvem. Sidecar Python (`src/transcription/faster_whisper.py`)
  num venv. Modelo `tiny`/`base` = leve na CPU (int8). No container, use
  `Dockerfile.whisper`. No seco, o instalador pode criar o venv.
- **openai** — API de transcrição da OpenAI (`whisper-1` / `gpt-4o-transcribe`).
  Precisa de `openaiApiKey`.
- **custom** — um comando shell qualquer; `{file}` vira o caminho do áudio e o
  **stdout** é usado como texto. Ex: `meu-transcritor --in {file}`.
- **codex** — usa o Codex CLI (OpenAI) já instalado e logado na máquina
  (`codex exec`), autenticado pela sessão do `codex login` (ChatGPT) — **sem
  precisar de `openaiApiKey`**. Requer o Codex CLI instalado
  (`npm install -g @openai/codex`) e logado (`codex login`). Modelo opcional
  em `codexModelo` (vazio = padrão do CLI).

## Aviso sobre o provedor `codex`
O Codex CLI **não tem entrada nativa de áudio** — só aceita texto e imagem
(`-i/--image`). Este provedor pede pro próprio Codex produzir a transcrição a
partir do caminho do arquivo, então **teste com um áudio curto de conteúdo
conhecido antes de confiar em produção**: se o ambiente não suportar
transcrição de fato, a resposta pode ser um texto inventado (alucinado) em vez
de um erro. Se o binário `codex` não estiver instalado, a transcrição falha
com um aviso no log (a captura continua normalmente, sem transcrição).

No container, o Codex CLI **não vem na imagem** — o `docker-compose.yml` já
monta o do host por bind mount (veja "Provedor codex da transcrição" em
`docs/CONTAINER.md`).
