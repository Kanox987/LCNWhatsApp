# syntax=docker/dockerfile:1
# Imagem base do LCNWhatsApp — enxuta.
# O bot só baixa e reenvia mídia (não transcodifica), então NÃO precisa de ffmpeg.
# zapo-js e sharp vêm com binários pré-compilados (prebuild-install baixa o
# .node certo pra plataforma). better-sqlite3 (store de sessão) também busca
# um binário pré-compilado por padrão — build-essential/python3 ficam só como
# rede de segurança pro fallback de compilação (node-gyp), caso não haja
# prebuild pra essa combinação de plataforma/ABI do Node.
# Para transcrição local (faster-whisper), use o Dockerfile.whisper.
# node:22 (não 20): zapo-js precisa de WebSocket global do runtime, estável só
# a partir do Node 22 (no 20 exigiria a flag --experimental-websocket).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ util-linux \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências primeiro (aproveita cache de camada). O --mount=type=cache
# persiste o cache do npm ENTRE builds separados — mesmo quando qualquer edição
# em package.json (ex.: mexer só no script de teste) invalida a camada e força
# reinstalar do zero, o npm reaproveita o que já baixou/compilou antes em vez de
# ir na rede de novo.
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm install --omit=dev --no-audit --no-fund

# Copia o código.
COPY . .

# Volumes de dados persistentes (montados pelo compose/run).
VOLUME ["/app/sessao", "/app/midia", "/app/data"]

ENV NODE_ENV=production
# Login por código de pareamento é mais amigável no container; troque pra
# CMD ["node","index.js"] se preferir QR nos logs.
CMD ["/app/bin/lock-and-run.sh", "/app/data/instance.lock", "node", "index.js"]
