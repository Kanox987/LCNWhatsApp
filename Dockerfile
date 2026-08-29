# Imagem base do LCNWhatsApp — enxuta.
# O bot só baixa e reenvia mídia (não transcodifica), então NÃO precisa de ffmpeg
# nem build tools: a Baileys usa WASM (whatsapp-rust-bridge) e o sharp vem com
# binários pré-compilados. Só é preciso git pra instalar a Baileys do GitHub.
# Para transcrição local (faster-whisper), use o Dockerfile.whisper.
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências primeiro (aproveita cache de camada).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copia o código.
COPY . .

# Ponto de montagem pro Codex CLI do host (provedor "codex" da transcrição).
# O binário em si não vai na imagem — é montado por bind mount no compose/run;
# aqui só criamos o link que o `codex exec` (spawn) espera achar no PATH.
RUN ln -s ../lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex

# Volumes de dados persistentes (montados pelo compose/run).
VOLUME ["/app/sessao", "/app/midia", "/app/data"]

ENV NODE_ENV=production
# Login por código de pareamento é mais amigável no container; troque pra
# CMD ["node","index.js"] se preferir QR nos logs.
CMD ["node", "index.js"]
