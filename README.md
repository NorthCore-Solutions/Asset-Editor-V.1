# NorthCore Asset Editor

Lokaler, browserbasierter 3D-Editor für einfache Low-Poly-Game-Assets. Objekte werden aus geometrischen Grundformen zusammengesetzt, lokal als versionierte JSON-Projekte gespeichert und als GLB für Godot oder Blender exportiert.

## Funktionsumfang 0.1

- Desktop-Oberfläche mit Formenbibliothek, 3D-Viewport, Eigenschaften und Objektliste
- Grundformen: Würfel, Quader, Kugel, Halbkugel, Zylinder, Kegel, Pyramide, Torus, Ebene, Keil und Prisma
- Gebäudeteile: Wand, Bodenplatte, Flachdach, Satteldach, Pultdach, Tür, Fenster, Säule, Schornstein und Treppe
- Auswahl per Mausklick und sichtbare Hervorhebung
- Verschieben, Drehen und Skalieren mit TransformControls oder Zahlenfeldern
- Perspektiv- und orthogonale Blickrichtungen sowie Fokus auf Auswahl
- Raster, Achsen, Beleuchtung und Schatten
- Sichtbarkeit, Sperren, Umbenennen, Duplizieren und Löschen
- Farbe, HEX-Wert, Rauheit, Metallwert, Transparenz sowie Flat/Smooth Shading
- NorthCore-, Low-Poly- und Materialvorlagen
- Positions-, Winkel- und Skalierungs-Snapping
- Undo/Redo mit zusammengefassten Transformationsaktionen
- Download und Upload des Projektformats `.ncae.json`
- verzögertes Browser-Autosave mit Wiederherstellungsdialog
- GLB-Export der sichtbaren Szene oder der aktuellen Auswahl
- Exportprüfung für leere Szenen, Polygonzahl, Bodenunterschreitung und vollständige Transparenz
- Screenshot des Viewports als PNG
- Statusleiste für Objektzahl, Auswahl, Dreiecke, Werkzeug, Snapping und Speicherstatus

## Voraussetzungen

- Node.js 22.12 oder neuer
- npm 10 oder neuer
- moderner Browser mit WebGL 2

## Installation

```bash
npm install
```

## Entwicklung starten

```bash
npm run dev
```

Danach im Browser öffnen:

```text
http://127.0.0.1:5173
```

## Tests

```bash
npm run test
```

## Lint

```bash
npm run lint
```

## Produktions-Build

```bash
npm run build
```

Die Build-Ausgabe liegt anschließend unter `dist/`.

## Bedienung

1. Links eine Grundform oder ein Gebäudeteil anklicken.
2. Das Objekt im Viewport oder in der Objektliste auswählen.
3. Werkzeug in der oberen Leiste wählen oder Tastenkürzel verwenden.
4. Transformation und Material im rechten Panel präzisieren.
5. Mehrere Objekte zu einem Asset zusammensetzen.
6. Projekt über **Speichern** als `.ncae.json` sichern.
7. Über **GLB-Export** die sichtbare Szene oder nur die Auswahl exportieren.

## Tastenkürzel

| Aktion | Kürzel |
|---|---|
| Verschieben | `W` oder `G` |
| Drehen | `E` oder `R` |
| Skalieren | `S` |
| Löschen | `Entf` |
| Duplizieren | `Strg + D` |
| Rückgängig | `Strg + Z` |
| Wiederholen | `Strg + Y` oder `Strg + Umschalt + Z` |
| Auswahl fokussieren | `F` |
| Auswahl aufheben | `Escape` |

Tastenkürzel werden in Eingabefeldern nicht ausgelöst.

### Maussteuerung

- Linke Maustaste: Kamera verschieben
- Rechte Maustaste: Kamera drehen
- Mittlere Maustaste: Kamera verschieben
- Mausrad: zoomen

## Projektformat

Das Format ist reines JSON und führt keinen Code aus.

```json
{
  "format": "northcore-asset-editor",
  "version": 1,
  "project": {
    "name": "Testhaus",
    "createdAt": "2026-08-02T00:00:00.000Z",
    "updatedAt": "2026-08-02T00:00:00.000Z"
  },
  "scene": {
    "background": "#11161A",
    "gridVisible": true,
    "axesVisible": true,
    "gridSize": 1
  },
  "objects": []
}
```

Unbekannte optionale Felder werden ignoriert. Pflichtfelder, Formatkennung, Version, Transformationen, Materialien und eindeutige Objekt-IDs werden validiert.

## GLB-Export

Der Export basiert auf `THREE.GLTFExporter`. Exportiert werden ausschließlich sichtbare Meshes inklusive Transformationen und Standardmaterialeigenschaften. Raster, Achsen, Kamera, Licht, TransformControls und interne Editor-Helfer werden nicht in die Datei aufgenommen.

Die erzeugte Binärdatei kann in Blender über **Datei → Importieren → glTF 2.0** und in Godot direkt als `.glb` importiert werden.

## Aktuelle Einschränkungen

- keine Gruppenbearbeitung oder Parent-Child-Hierarchie in der Oberfläche
- keine Texturen oder UV-Bearbeitung
- keine booleschen Operationen
- keine Vertex-, Edge- oder Face-Bearbeitung
- keine Animation, Rigging oder Sculpting
- keine direkte Godot-, Blender- oder TripoSR-Anbindung
- Autosave ist browser- und profilgebunden
- Screenshot-Export verwendet den aktuellen Hintergrund; transparenter PNG-Hintergrund ist noch nicht umgesetzt

## Geplante Erweiterungen

- Gruppen und Parent-Child-Hierarchien
- weitere Architekturteile und parametrische Formen
- Objekt-Pivot und präzisere lokale/globalen Transformationsmodi
- optionaler transparenter Screenshot
- Asset-Bibliothek und wiederverwendbare lokale Vorlagen
- spätere, getrennte Godot-/Blender-Pipeline

## Open-Source-Bibliotheken

- React – MIT
- Vite – MIT
- TypeScript – Apache-2.0
- Three.js – MIT
- React Three Fiber – MIT
- Drei – MIT
- Zustand – MIT
- Vitest – MIT
- ESLint – MIT

Es werden keine externen Backends, Cloud-Dienste, Konten, Cookies, Telemetrie oder kostenpflichtigen APIs verwendet.
