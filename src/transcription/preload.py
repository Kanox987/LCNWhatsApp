#!/usr/bin/env python3
"""Pré-baixa/valida um modelo faster-whisper no diretório persistente.

Uso: python3 preload.py <modelo>   (tiny | base | small)

Roda uma vez, fora do fluxo de captura, pra garantir que o modelo já esteja
em LCN_WHISPER_MODELS_DIR antes do bot subir de verdade — assim o primeiro
áudio real não fica lento, e um rebuild/update reaproveita o que já foi
baixado (não baixa de novo). Imprime uma linha de status e sai com código
diferente de zero se não conseguir baixar/carregar o modelo.
"""
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: preload.py <modelo>", file=sys.stderr)
        return 2

    modelo = sys.argv[1]
    destino = os.environ.get("LCN_WHISPER_MODELS_DIR")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(f"falha: faster-whisper não instalado (pip install faster-whisper)", file=sys.stderr)
        return 3

    try:
        WhisperModel(modelo, device="cpu", compute_type="int8", download_root=destino or None)
    except Exception as e:
        print(f"falha ao baixar/carregar modelo '{modelo}': {e}", file=sys.stderr)
        return 4

    print(f"sucesso: modelo '{modelo}' pronto em {destino or '(cache padrão)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
