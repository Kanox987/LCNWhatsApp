#!/usr/bin/env sh
# Fluxo reutilizável (sourced, não executado) pra configurar o perfil de
# recursos do container e a transcrição local — usado por install.sh e
# update.sh, sempre no modo docker. Preenche PERFIL_MEMORY/PERFIL_CPUS
# ("" = sem limites) e PERFIL_INSTALADA/PERFIL_MODELO, e grava tudo em
# runtime.json + docker-compose.override.yml via `node src/runtime.js`.

# Decide (em uma única chamada awk, sem reformatar float como string — isso
# formata decimal com vírgula em locale pt-BR e quebra comparação depois) se
# o perfil de recursos é fraco pra rodar o modelo "small" (< 2 GB ou < 2
# CPUs). "" (sem limites) sempre conta como grande o bastante.
_lcn_aviso_small() {
  mem="$1" cpu="$2"
  awk -v mem="$mem" -v cpu="$cpu" '
    BEGIN {
      if (mem == "") { mem_mb = 999999 } else {
        m = mem; unit = ""
        if (match(m, /[A-Za-z]+$/)) { unit = substr(m, RSTART, RLENGTH); m = substr(m, 1, RSTART - 1) }
        n = m + 0
        if (unit ~ /^[gG]/) mem_mb = n * 1024
        else if (unit ~ /^[kK]/) mem_mb = n / 1024
        else mem_mb = n
      }
      cpu_n = (cpu == "") ? 999 : cpu + 0
      print (mem_mb < 2048 || cpu_n < 2) ? "fraco" : "ok"
    }
  '
}

perguntar_perfil_recursos() {
  echo ""
  echo "Perfil do container:"
  echo "  1 Econômico   — 512 MB / 1 CPU"
  echo "  2 Leve        — 1 GB / 1 CPU"
  echo "  3 Recomendado — 2 GB / 2 CPUs"
  echo "  4 Personalizado"
  echo "  5 Sem limites"
  printf "Escolha [1-5, padrão 1]: "
  read op
  case "$op" in
    2) PERFIL_MEMORY=1g; PERFIL_CPUS=1.0 ;;
    3) PERFIL_MEMORY=2g; PERFIL_CPUS=2.0 ;;
    4)
      printf "RAM no formato Docker (ex: 768m, 2g): "
      read PERFIL_MEMORY
      printf "CPUs (ex: 1.5, 2.0): "
      read PERFIL_CPUS
      ;;
    5) PERFIL_MEMORY=""; PERFIL_CPUS="" ;;
    *) PERFIL_MEMORY=512m; PERFIL_CPUS=1.0 ;;
  esac
}

perguntar_transcricao_local() {
  echo ""
  echo "Instalar transcrição local?"
  echo "  1 Não instalar"
  echo "  2 tiny  — mínima RAM, menor qualidade"
  echo "  3 base  — equilíbrio recomendado"
  echo "  4 small — melhor qualidade, requer 2 GB RAM / 2 CPUs"
  printf "Escolha [1-4, padrão 1]: "
  read op
  case "$op" in
    2) PERFIL_INSTALADA=true; PERFIL_MODELO=tiny ;;
    3) PERFIL_INSTALADA=true; PERFIL_MODELO=base ;;
    4)
      PERFIL_INSTALADA=true
      PERFIL_MODELO=small
      if [ "$(_lcn_aviso_small "$PERFIL_MEMORY" "$PERFIL_CPUS")" = "fraco" ]; then
        echo ""
        echo "⚠ 'small' com menos de 2 GB de RAM ou menos de 2 CPUs pode ficar lento"
        echo "  ou até travar num VPS fraco. Recomendado: escolha o perfil 'Recomendado'"
        echo "  (2 GB/2 CPUs) na pergunta de recursos."
        printf "Continuar com 'small' mesmo assim? [s/N] "
        read conf
        case "$conf" in
          s|S) : ;;
          *) PERFIL_MODELO=base ;;
        esac
      fi
      ;;
    *) PERFIL_INSTALADA=false; PERFIL_MODELO=base ;;
  esac
}

# Ponto de entrada: em install.sh sempre pergunta; em update.sh (passe
# UPDATE=1 antes de chamar) mostra o perfil atual e só pergunta de novo se
# o usuário não quiser mantê-lo.
configurar_perfil_container() {
  if [ "$UPDATE" = "1" ]; then
    ATUAL=$(node src/runtime.js show 2>/dev/null)
    if [ -n "$ATUAL" ]; then
      MEM_ATUAL=$(printf '%s' "$ATUAL" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const r=JSON.parse(s);console.log(r.container.memory===null?'sem limites':r.container.memory)}catch(e){console.log('?')}})" 2>/dev/null)
      CPU_ATUAL=$(printf '%s' "$ATUAL" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const r=JSON.parse(s);console.log(r.container.cpus===null?'sem limites':r.container.cpus)}catch(e){console.log('?')}})" 2>/dev/null)
      TRANSCR_ATUAL=$(printf '%s' "$ATUAL" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const r=JSON.parse(s);console.log(r.transcricaoLocal.instalada?('ligada, modelo '+r.transcricaoLocal.modelo):'desligada')}catch(e){console.log('?')}})" 2>/dev/null)
      echo ""
      echo "Perfil atual: $MEM_ATUAL RAM / $CPU_ATUAL CPUs — transcrição local: $TRANSCR_ATUAL"
      printf "Manter recursos e modelo atuais? [S/n] "
      read manter
      case "$manter" in
        n|N|nao|não|Nao|Não)
          perguntar_perfil_recursos
          perguntar_transcricao_local
          ;;
        *)
          return 0 ;;
      esac
    else
      perguntar_perfil_recursos
      perguntar_transcricao_local
    fi
  else
    perguntar_perfil_recursos
    perguntar_transcricao_local
  fi

  node src/runtime.js save \
    --mode docker --engine "$ENGINE" \
    --memory "$PERFIL_MEMORY" --cpus "$PERFIL_CPUS" \
    --instalada "$PERFIL_INSTALADA" --modelo "$PERFIL_MODELO"
  node src/runtime.js compose-override > docker-compose.override.yml
}
