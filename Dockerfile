# syntax=docker/dockerfile:1
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

# Instala dependências primeiro (aproveita cache de camada). O --mount=type=cache
# persiste o cache do npm (inclusive o clone/build da Baileys, que vem do GitHub
# sem tag fixa) ENTRE builds separados — mesmo quando qualquer edição em
# package.json (ex.: mexer só no script de teste) invalida a camada e força
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
CMD ["node", "index.js"]
