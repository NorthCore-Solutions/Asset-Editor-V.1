# Oberflächen-Snap-Vertrag

- Sichtbare Snap-Punkte und funktionale Snap-Punkte stammen aus derselben Geometrie-Topologie.
- Punkte liegen auf den tatsächlichen Dreiecksflächen, nicht auf einer Ersatz-Bounding-Box.
- Grundformen, Gebäudeelemente und importierte Object3D-Hierarchien verwenden dieselbe Berechnung.
- Ein Kontakt ist gültig, wenn zwei Punkte innerhalb der Fangdistanz liegen und ihre Oberflächennormalen gegeneinander zeigen.
- Desktop und Android verwenden dieselbe Viewport- und Snap-Instanz.
- Skalierung verwendet die jeweils aktuell skalierte Geometrie-Topologie.
