# API de saída de mídia (ponto de extensão — DESLIGADO)

Hoje **não** há servidor nem envio externo. Existe só o gancho pra você levar as
mídias pra fora (ex: um site) no futuro, sem retrabalho.

## O que já existe
`src/api/output.js` expõe um `EventEmitter` (`barramento`) que emite `captura` a
cada mídia salva:
```js
import { barramento } from './src/api/output.js'
barramento.on('captura', (ev) => {
  // ev = { id, tipo, numero, nome, caption, arquivo, timestamp, transcricao, arquivoAbs }
})
```
E `config.json` tem `outputApi` (`enabled`, `host`, `porta`, `token`), hoje
`enabled: false`.

## Como habilitar depois
Implemente em `iniciarSaida(cfg)` (em `output.js`) uma das opções:
- **REST local** (`http` nativo em `127.0.0.1:porta`, header `Authorization: Bearer <token>`):
  - `GET /midias` → lê o índice de `src/archive.js`.
  - `GET /midia/:id` → envia o arquivo de `midia/`.
- **Webhook push**: no evento `captura`, faça `POST` (multipart ou JSON+base64)
  para uma URL do seu site.

Mantenha `127.0.0.1` por padrão e exija token. Para expor na rede/externamente,
faça atrás de um proxy com TLS — não abra a porta direto na internet.
