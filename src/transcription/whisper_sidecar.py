#!/usr/bin/env python3
"""Sidecar de transcrição com faster-whisper.

Uso: python3 whisper_sidecar.py <arquivo_audio> [modelo] [idioma]
Imprime só o texto transcrito no stdout. Modelo padrão: base (leve).

IMPORTANTE: este arquivo NÃO pode se chamar "faster_whisper.py" — rodar um
script com esse nome coloca o próprio diretório dele em sys.path[0], e
"from faster_whisper import WhisperModel" passaria a resolver pro PRÓPRIO
arquivo (que não define WhisperModel) em vez do pacote pip de verdade,
falhando sempre com "faster-whisper não instalado" mesmo com o pacote
instalado. Testado e confirmado antes desse rename.

Instale no venv com:  pip install faster-whisper

Se LCN_WHISPER_MODELS_DIR estiver definida, o modelo é baixado/lido desse
diretório persistente (montado no container) em vez do cache padrão do
huggingface_hub — assim um rebuild/update não baixa o modelo de novo.
"""
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: whisper_sidecar.py <arquivo> [modelo] [idioma]", file=sys.stderr)
        return 2

    arquivo = sys.argv[1]
    modelo = sys.argv[2] if len(sys.argv) > 2 else "base"
    idioma = sys.argv[3] if len(sys.argv) > 3 else None

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper não instalado (pip install faster-whisper)", file=sys.stderr)
        return 3

    # int8 na CPU: baixo uso de memória, sem exigir GPU.
    model = WhisperModel(
        modelo,
        device="cpu",
        compute_type="int8",
        download_root=os.environ.get("LCN_WHISPER_MODELS_DIR") or None,
    )
    segments, _ = model.transcribe(arquivo, language=idioma)
    print(" ".join(seg.text.strip() for seg in segments).strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
