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
