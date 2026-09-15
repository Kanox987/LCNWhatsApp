# syntax=docker/dockerfile:1
# Imagem base do LCNWhatsApp — enxuta.
# O ffmpeg é OBRIGATÓRIO: a figurinha converte imagem e vídeo para WebP
# animado por ele (src/sticker.js). Sem ffmpeg o /fig responde "o ffmpeg não
# está instalado nesta máquina" — falha clara, mas só na hora do uso, que foi
# como a imagem ficou tempo demais sem ele.
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
    ca-certificates ffmpeg python3 make g++ util-linux \
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

RUN chmod +x /app/bin/lcn-container.sh /app/bin/lock-and-run.sh /app/bin/lcn

# Volumes de dados persistentes (montados pelo compose/run). O banco do motor
# NÃO mora aqui: ele segue a convenção XDG, em
# $HOME/.local/share/lcnwhatsapp — monte esse caminho também, senão as
# automações publicadas somem a cada recriação do container.
VOLUME ["/app/sessao", "/app/midia", "/app/data", "/home/node/.local/share/lcnwhatsapp"]

ENV NODE_ENV=production

# Sobe motor + painel + gateway. Rodar só o `index.js` deixa o gateway sem
# motor: ele recebe mensagem, não decide nada, e fica mudo no WhatsApp sem
# erro visível no app.
CMD ["/app/bin/lcn-container.sh"]
