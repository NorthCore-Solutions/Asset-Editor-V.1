# Snap-Performance

- Geometrie-Topologien werden anhand von Typ, Geometriedaten, Skalierung und Rasterweite zwischengespeichert.
- Entfernte Objekte werden vor dem Punktvergleich über Welt-Bounding-Boxes ausgeschlossen.
- Zielpunkte werden während des Vergleichs räumlich gehasht.
- Pro Geometrie gilt eine feste Obergrenze für erzeugte Snap-Punkte.
