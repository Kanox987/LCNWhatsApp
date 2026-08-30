# config.json

Editável pelo painel (`lcn` > Configurações) ou à mão. O bot recarrega a quente
(`fs.watch`) e aplica na próxima mensagem — sem reconectar. Só
`hardware.logLevel`/`hardware.markOnline` (usados na criação do socket) disparam
uma reconexão leve quando mudam.

```jsonc
{
  "destino": { "tipo": "self|numero|grupo", "jid": "" },
  "captura": {
    "contatos": "todos",            // ou ["5511999...", ...] (allowlist)
    "blocklist": [],                 // números sempre ignorados
    "grupos": { "ativo": false, "allowlist": [] },  // captar em grupos?
    "destinoProprioContatos": [],    // números que recebem a mídia de volta na própria conversa
    "downloadAutomatico": {          // ver docs/DOWNLOAD-AUTOMATICO.md
      "conversas": [],               // números ou JIDs de grupo marcados
      "autoDelete": false            // apaga a mensagem encaminhada após capturar (nunca a mídia revelada)
    }
  },
  "hardware": {
    "markOnline": false,             // não aparecer "online" p/ quem envia
    "logLevel": "silent",
    "maxMidiaMB": 60,                // ignora mídia acima disso
    "downloadConcorrencia": 2,       // downloads simultâneos
    "modoEconomia": true,
    "debug": false                   // loga cada mensagem recebida (diagnóstico)
  },
  "transcricao": {
    "provedor": "off",               // off | faster-whisper | openai | custom
    "modelo": "base", "idioma": "pt",
    "pythonBin": "",                 // faster-whisper: caminho do python do venv (gravado pelo instalador); vazio = usa LCN_PYTHON ou "python3" do PATH
    "openaiApiKey": "", "openaiModelo": "whisper-1",
    "comando": "",                   // custom: usa {file} como caminho do áudio
    "comandoTerceiros": false,       // padrão geral: só o dono pode usar /transcrever
    "conversas": [                   // overrides por conversa (número ou ID de grupo)
      { "id": "5511999999999", "auto": true, "comandoTerceiros": null }
    ]
  },
  "atualizacao": { "autoUpdateBaileys": false, "falhasParaUpdate": 5 },
  "outputApi": { "enabled": false, "host": "127.0.0.1", "porta": 8787, "token": "" }
}
```

- **destino.tipo `self`**: manda pra sua própria conversa. `numero`: `jid` = número
  com DDI. `grupo`: `jid` = `...@g.us`.
- **captura.contatos**: `"todos"` ou lista. A lista também alimenta o filtro
  pré-crypto (`shouldIgnoreJid`).
- **captura.destinoProprioContatos**: números nessa lista furam `destino` — a mídia
  capturada (via `/recover` ou captura normal) volta na própria conversa com o
  contato, em vez de ir pro destino global. Editável em `lcn` > Configurações >
  Destino próprio por contato.
- **grupos.ativo**: por padrão desligado (performance). Ver PERFORMANCE.md.
- **captura.downloadAutomatico**: conversas marcadas têm a visu única (que chega com
  conteúdo) encaminhada e revelada sozinha, sem `/recover` manual. Ver
  [DOWNLOAD-AUTOMATICO.md](DOWNLOAD-AUTOMATICO.md). Editável em `lcn` > Configurações
  > Download automático.
- **hardware.debug**: liga logs detalhados de cada mensagem recebida — útil pra
  diagnosticar "mandei e não capturou". Ver [SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md).
- **hardware.logLevel**: nível de log da Baileys (`silent` em produção; `warn`/`error`
  ajuda a ver falhas de descriptografia). Mudança exige reconexão.
- **transcricao.conversas**: lista de overrides por conversa. `auto: true` liga
  transcrição automática de todo áudio normal ali (responde na própria conversa).
  `comandoTerceiros: true/false` sobrepõe o padrão geral só pra essa conversa;
  `null`/ausente usa `transcricao.comandoTerceiros`. Editável em `lcn` >
  Configurações > Transcrição por conversa.
