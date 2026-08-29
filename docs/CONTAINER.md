# Container e modo seco

## Container (recomendado)
Isola Node, ffmpeg, Python e o binário nativo da Baileys — não mexe nas
dependências da sua máquina. Roda em segundo plano pelo **restart policy**
(`unless-stopped`), sem PM2.

### Subir
Com compose:
```bash
docker compose up -d --build      # ou: podman compose up -d --build
```
Sem compose (Podman costuma não ter o compose):
```bash
sh run.sh                 # base
sh run.sh Dockerfile.whisper   # com transcrição local
```

### Login
```bash
docker logs -f LCNWhatsApp
```
Recomendado o **código de pareamento**: troque o `CMD` do Dockerfile por
`["node","index.js","--code"]`, ou rode uma vez `docker exec -it LCNWhatsApp node index.js --code`.

### Painel e dados
- Painel: `lcn` (executa dentro do container automaticamente).
- Persistência por bind mounts: `sessao/`, `midia/`, `data/`, `config.json`.

### Limites de recurso
No `docker-compose.yml` (`memory`, `cpus`) ou nas flags do `run.sh`
(`--memory`, `--cpus`).

### Provedor "codex" da transcrição
O `docker-compose.yml` já vem com os dois bind mounts (read-only) que
reaproveitam o Codex CLI **do host** dentro do container — nada é instalado
na imagem:
```yaml
- ${CODEX_NPM_DIR:-/usr/local/lib/node_modules/@openai/codex}:/usr/local/lib/node_modules/@openai/codex:ro
- ${CODEX_HOME:-~/.codex}/auth.json:/root/.codex/auth.json:ro
```
Funciona porque o binário nativo do Codex CLI é estático (musl, sem libs
dinâmicas) — roda em qualquer container Linux da mesma arquitetura (x86_64/
arm64) sem precisar instalar nada extra na imagem, só montar o pacote.

Requisitos:
- Ter feito `codex login` **no host** antes de subir o container (o
  `auth.json` precisa existir). **Se você subir o container antes de logar,
  o Docker cria um diretório vazio no lugar de `~/.codex/auth.json`** — isso
  quebra um `codex login` futuro no host até você apagar esse diretório
  (`rm -rf ~/.codex/auth.json` só se virar diretório, não se for o arquivo
  de verdade).
- Se o Codex estiver instalado em outro caminho (ex: outro usuário, outra
  distro), sobrescreva via variáveis de ambiente antes do `docker compose up`:
  `CODEX_NPM_DIR=/caminho/pro/@openai/codex CODEX_HOME=/caminho/pro/.codex docker compose up -d --build`.
- Não usa esse provedor? **Remova as duas linhas de volume do
  `docker-compose.yml`** — diferente do `run.sh`/`run.ps1` (que só montam se
  acharem o Codex de verdade no host), o compose não checa antes: se o Codex
  não estiver instalado, ele cria diretórios vazios nos dois caminhos do host
  (`.../node_modules/@openai/codex` e `~/.codex/auth.json`) em vez de avisar.
  Quem sobe via `run.sh`/`run.ps1`/`update.sh` não precisa se preocupar com
  isso — a checagem já é automática.

⚠️ **Isso compartilha sua sessão do ChatGPT/Codex com o container** — trate
`auth.json` com o mesmo cuidado que uma API key. Só o `auth.json` é montado
(não o `~/.codex` inteiro), então histórico, sessões e memórias do Codex no
host não vazam pro container.

## Modo seco (nativo)
```bash
npm install
npm start        # QR
npm run code     # código de pareamento
```
Para segundo plano com auto-restart, use PM2:
```bash
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

> Nota: neste ambiente o `docker` é o **Podman** emulando a CLI. Por isso
> entregamos `run.sh`/`run.ps1` além do compose — funcionam com os dois.
