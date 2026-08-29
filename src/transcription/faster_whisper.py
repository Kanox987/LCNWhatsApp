#!/usr/bin/env python3
"""Sidecar de transcrição com faster-whisper.

Uso: python3 faster_whisper.py <arquivo_audio> [modelo] [idioma]
Imprime só o texto transcrito no stdout. Modelo padrão: base (leve).

Instale no venv com:  pip install faster-whisper
"""
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: faster_whisper.py <arquivo> [modelo] [idioma]", file=sys.stderr)
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
    model = WhisperModel(modelo, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(arquivo, language=idioma)
    print(" ".join(seg.text.strip() for seg in segments).strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
