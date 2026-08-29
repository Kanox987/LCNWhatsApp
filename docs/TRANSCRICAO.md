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
  `Dockerfile.whisper`. No seco, o instalador (`install.sh`/`install.ps1`)
  pode criar o venv e tenta instalar Python sozinho se faltar — o caminho do
  Python do venv fica gravado em `transcricao.pythonBin`. Se o ambiente não
  for encontrado, o `lcn` avisa no topo do painel (o primeiro uso baixa o
  modelo da Hugging Face, o que pode demorar).
- **openai** — API de transcrição da OpenAI (`whisper-1` / `gpt-4o-transcribe`).
  Precisa de `openaiApiKey`.
- **custom** — um comando shell qualquer; `{file}` vira o caminho do áudio e o
  **stdout** é usado como texto. Ex: `meu-transcritor --in {file}`.
