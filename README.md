# PDF Schwärzen

Web-App, mit der du Daten **per Sprache** aus PDF-Dokumenten entfernst, und zwar sicher und **komplett lokal** auf
deinem Gerät (iPhone, iPad, Mac, PC). Es gibt keinen Server, keinen Upload und keine Installation über den App Store.

1. **PDF öffnen.** Das Dokument wird angezeigt.
2. **Mikrofon antippen und sprechen**, z. B. *„Entferne alle E-Mail-Adressen und den Namen Max Mustermann“*.
   Die Fundstellen werden gelb markiert und als Liste angezeigt, in der du sie an- oder abwählen kannst.
3. **„Schwärzen“** sagen oder antippen. Das Ergebnis erscheint direkt, und mit *Original | Ergebnis* kannst du vergleichen.
4. **Speichern.** Standardmäßig unter demselben Dateinamen, im Feld darüber kannst du einen anderen Namen eingeben.

## Sprachbefehle (Beispiele)

| Gesagt | Wirkung |
| --- | --- |
| „Entferne alle E-Mail-Adressen und Telefonnummern“ | Kategorien |
| „Lösche die IBAN und die BIC“ / „die Bankverbindung“ | Kontodaten (IBAN mit Prüfziffer) |
| „Schwärze den Namen Erika Musterfrau“ | Name, einzelne Namensteile, Genitiv („Musterfraus“), ähnliche Schreibweisen |
| „Entferne die Kundennummer“ | den **Wert** hinter „Kundennummer:“ bzw. „Kunden-Nr.“ |
| „Entferne die Adressen“, „Geburtsdaten“, „Geldbeträge“, „Datumsangaben“ | Kategorien |
| „Entferne alle Namen“ | Namen nach Anrede („Herr …“), „Name: …“ und Grußformel, danach überall im Dokument |
| „Alle personenbezogenen Daten“ | alle Kategorien für personenbezogene Daten |
| „Entferne das Wort ‚Projekt Alpha‘ auf Seite 2“ | genauer Begriff, optional nur auf bestimmten Seiten |
| „Schwärzen“ / „Anwenden“ · „Rückgängig“ · „Zurücksetzen“ | Steuerung |
| „Speichern“ · „Speichern unter Vertrag anonym“ | Speichern |

Außerdem kannst du Treffer im Dokument antippen, um sie an- oder abzuwählen. Mit **„Bereich markieren“** schwärzt du
Flächen von Hand, etwa Unterschriften, Fotos oder eingescannte Seiten ohne Textebene.

## Warum die Daten wirklich weg sind

Ein schwarzer Balken über dem Text reicht nicht, denn der Text bliebe darunter kopierbar. Die App geht deshalb so vor:

- **Seiten mit Schwärzungen werden komplett neu als Bild aufgebaut.** Die Balken werden direkt in die Pixel gemalt,
  der ursprüngliche Text, die Schriften und die Inhaltsströme dieser Seite gibt es danach nicht mehr. Der restliche,
  *nicht* geschwärzte Text wird als unsichtbare Textebene wieder darübergelegt, damit er durchsuchbar und kopierbar bleibt.
- **Das Ergebnis ist ein komplett neues PDF.** Seiten ohne Treffer werden übernommen, aber ohne Metadaten (Titel,
  Autor, XMP), Kommentare, Formulare, Lesezeichen, Dateianhänge, JavaScript und Seitenaktionen. Seiten mit Formularfeldern
  oder Kommentaren werden flachgerechnet (als Bild).
- **Es wird auch versteckter Text gefunden:** weiße oder winzige Schrift, Formularfeldwerte und Kommentartexte.
- **Automatische Prüfung:** Nach dem Schwärzen wird das Ergebnis erneut eingelesen. Sämtlicher Text, Metadaten,
  Lesezeichen, Anhänge und alle entpackten Datenströme (auch hex-kodierte Strings) werden nach den entfernten Inhalten
  durchsucht. Das Ergebnis siehst du unter dem Dokument („✓ … nicht mehr auffindbar“).
- In den Einstellungen gibt es die Option **„Alle Seiten als Bild neu aufbauen“** für maximale Sicherheit.

## Warum alles lokal bleibt

- Die App ist eine statische Webseite ohne Server-Logik. PDF und Audio bleiben im Arbeitsspeicher des Browsers.
- **Spracherkennung:** [Whisper](https://github.com/openai/whisper) läuft über
  [Transformers.js](https://github.com/huggingface/transformers.js) als WebAssembly direkt im Browser. Die eingebaute
  Spracherkennung des Browsers (Web Speech API) wird bewusst **nicht** verwendet, weil sie das Audio an Apple- bzw.
  Google-Server schickt.
- Das Sprachmodell (ca. 40/80/250 MB, einstellbar) wird **einmalig** von huggingface.co geladen und bleibt im
  Gerätespeicher. Danach funktioniert alles offline (Flugmodus-Test). Wer auch diesen Download vermeiden will, legt die
  Modelldateien unter `models/Xenova/whisper-base/` ab; die App nimmt dann zuerst diese.
- Eine Content-Security-Policy im Browser erlaubt der Seite nur Verbindungen zur eigenen Adresse und zum Modell-Download.
- Alle Bibliotheken liegen im Ordner `vendor/`, es wird kein fremdes CDN verwendet.
- Die **Befehlserkennung** ist regelbasiert und läuft lokal (`js/detect.js`): Schlüsselwörter, Muster für IBAN
  (mit Prüfziffer), Kreditkarten (Luhn), Telefonnummern, Adressen usw. sowie die Kölner Phonetik für ähnlich klingende Namen.

## Auf dem iPhone nutzen

Die App muss über **HTTPS** erreichbar sein, sonst gibt iOS das Mikrofon nicht frei. Am einfachsten geht das mit GitHub Pages:

1. Im Repository unter *Settings → Pages → Build and deployment* als Quelle **„GitHub Actions“** wählen.
2. Nach dem nächsten Push auf `main` baut der Workflow `.github/workflows/pages.yml` die Seite.
3. Die Adresse in Safari öffnen, dann *Teilen → Zum Home-Bildschirm*. Die App startet danach wie eine normale App.
4. Beim ersten Tippen aufs Mikrofon wird das Sprachmodell geladen (am besten im WLAN).

**Speichern auf dem iPhone:** iOS erlaubt Webseiten nicht, eine Datei direkt zu überschreiben. „Speichern“ öffnet
deshalb das Teilen-Menü. Dort *„In Dateien sichern“* wählen, denselben Ordner nehmen und das Ersetzen bestätigen.
Am Desktop (Chrome/Edge) wird die geöffnete Datei direkt überschrieben.

Jeder andere statische Webserver mit HTTPS funktioniert genauso, denn es gibt keinen Build-Schritt.

## Entwicklung

```sh
npm start              # lokaler Server auf http://localhost:8080
npm test               # Tests der Befehlserkennung (Node, keine Abhängigkeiten)
npm run test:e2e       # End-to-End-Test im Browser (benötigt Playwright + Chromium)
```

Der End-to-End-Test erzeugt ein PDF mit Name, E-Mail, Telefonnummer, IBAN, Kundennummer, unsichtbarem Text,
Formularfeld, Metadaten und Dateianhang, schwärzt es über die Oberfläche und prüft das Ergebnis unabhängig.

| Datei | Aufgabe |
| --- | --- |
| `js/app.js` | Oberfläche, Ablauf, Speichern |
| `js/detect.js` | Sprachbefehle verstehen, Treffer finden (lokal, regelbasiert) |
| `js/pdfmodel.js` | Text und Zeichenpositionen einer Seite |
| `js/redact.js` | Sicheres Schwärzen und Prüfung des Ergebnisses |
| `js/viewer.js` | PDF-Anzeige mit Markierungen |
| `js/speech.js`, `js/whisper-worker.js` | Aufnahme und lokale Spracherkennung |
| `sw.js` | Offline-Fähigkeit |

## Grenzen

- **Eingescannte PDFs** (nur Bilder, kein Text) können nicht automatisch durchsucht werden. Dafür gibt es „Bereich markieren“.
- Text, der in Bildern steckt (z. B. ein Logo mit Adresse), wird nicht automatisch erkannt.
- Geschwärzte Seiten sind danach Bilder mit unsichtbarer Textebene. Die Dateigröße steigt etwas, die Optik bleibt gleich.
- Die Erkennung von „allen Namen“ ohne konkrete Vorgabe stützt sich auf Anrede, „Name:“ und Grußformel. Für wichtige
  Dokumente Namen besser konkret nennen und die Trefferliste kontrollieren.
- Benötigt iOS 16.4 oder neuer.

Bibliotheken: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT),
[Transformers.js](https://github.com/huggingface/transformers.js) mit ONNX Runtime Web (Apache-2.0 / MIT). Die Lizenzen liegen in `vendor/`.
