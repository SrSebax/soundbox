"""Escritura de metadatos ID3 en los MP3."""
from __future__ import annotations

from pathlib import Path

from mutagen.id3 import APIC, ID3, TALB, TCMP, TDRC, TIT2, TPE1, TRCK


def write_tags(
    path: Path,
    *,
    title: str,
    artist: str,
    album: str | None = None,
    track_number: int | None = None,
    year: str | None = None,
    cover: bytes | None = None,
    compilation: bool = False,
) -> None:
    # Se parte de una etiqueta vacía para no arrastrar metadatos del origen.
    tags = ID3()
    tags.add(TIT2(encoding=3, text=title))
    tags.add(TPE1(encoding=3, text=artist))
    if album:
        tags.add(TALB(encoding=3, text=album))
    if track_number:
        tags.add(TRCK(encoding=3, text=str(track_number)))
    if year:
        tags.add(TDRC(encoding=3, text=year))
    if compilation:
        tags.add(TCMP(encoding=3, text="1"))
    if cover:
        tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover))
    # ID3v2.3 es el más compatible (Explorador de Windows, coches, etc.).
    tags.save(str(path), v2_version=3)
