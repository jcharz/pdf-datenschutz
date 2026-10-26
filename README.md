# PDF Datenschutz

Web-App für iPhone, iPad und Computer: Sie findet in PDF-Dokumenten **automatisch** Daten, die kritisch sein könnten,
bewertet sie und zeigt sie in einer Liste. Pro Fund entscheidest du: **schwärzen**, **ersetzen** (Pseudonym) oder
**behalten**. Alles läuft **lokal auf dem Gerät**. Es gibt keinen Server, keinen Upload und keine Installation über den App Store.

**Adresse:** https://jcharz.github.io/pdf-datenschutz/ (in Safari öffnen → Teilen → *Zum Home-Bildschirm*)

## Ablauf

1. **PDF öffnen.** Die App liest den Text aller Seiten und sucht nach kritischen Daten.
2. **Liste prüfen.** Jeder Fund zeigt den *echten Wert*, der geändert würde (z. B. `12 150380 M 123`, nicht nur
   „Versicherungsnummer“), dazu die Bewertung, die Seite und wie oft er vorkommt.
   Ein Tipp auf den Wert springt zur Stelle im Dokument.
3. **Pro Fund wählen:** *Schwärzen* · *Ersetzen* · *Behalten*. Unter jedem Fund steht immer, **womit er ersetzt
   würde** („Ersatz wäre …“ bzw. „wird zu …“, 🎲 = anderen Ersatz erzeugen). Tippst du auf einen Fund, zeigt das
   Dokument den Ersatz als kleines Schild an der Stelle. Nach dem Anwenden listet der Prüfbericht alle Ersetzungen auf.
4. **Hinweise geben** (tippen oder über das 🎤 der iPhone-Tastatur diktieren):
   „auch Projekt Alpha“, „den Namen Erika Muster“, „alle Datumsangaben“, „behalte die Beträge“.
5. **Anwenden.** Das Ergebnis erscheint sofort. Mit **Vorher | Nachher** vergleichst du an genau derselben Stelle.
6. **Speichern.** Standardmäßig unter demselben Namen, ein anderer Name lässt sich im Speichern-Dialog eingeben.
7. **Optional: „📋 Als Schablone merken“.** Beim nächsten Dokument derselben Art (z. B. die nächste Abrechnung der
   Krankenkasse) erkennt die App das Formular wieder und fragt, ob sie die Bearbeitung als Ganzes übernehmen soll.

## Bearbeitungsschablonen

Eine Schablone merkt sich, **wie** ein Formular bearbeitet wurde:

- je Feld die Entscheidung (Versichertennummer → ersetzen, Adressblock → ersetzen, Ansprechpartner → schwärzen …),
  auch bei Tabellen in der richtigen Reihenfolge („erste Datumszeile schwärzen“),
- von Hand markierte Bereiche (relative Position auf der Seite),
- deine Hinweise („auch Physiotherapie“).

Wiedererkannt wird ein Formular an seinen **festen Texten** (Beschriftungen, Überschriften), nicht an den
eingetragenen Werten. Ab etwa 60 % Übereinstimmung erscheint oben in der Liste: *„Bekanntes Formular: … Schablone
anwenden?“*. Neue, unbekannte Felder behalten ihren normalen Vorschlag.

**Datenschutz:** Schablonen enthalten keine Inhalte des Dokuments, nur gesalzene Fingerabdrücke der festen
Formulartexte, die Entscheidungen und die Hinweise ebenfalls als Fingerabdruck. Verwalten, löschen sowie sichern und
wiederherstellen (zusammen mit der Pseudonym-Tabelle) geht unter ⚙︎.

## Deine Daten und Absenderdaten

Die Liste ist zweigeteilt:

- **Deine Daten**: alles, was dich (oder andere Privatpersonen) betrifft, also Name, Anschrift, Versicherten- und
  Kundennummern, Bankverbindung, Gesundheitsangaben … Hohe und mittlere Risiken sind vorausgewählt.
- **Absender & Organisationen**: Briefkopf, Absenderzeile im Adressfenster, Fußzeile (Sitz, Handelsregister,
  Bankverbindung der Firma), Ansprechpartner/Sachbearbeiter mit Durchwahl, Service-E-Mail, Webadresse, Unterschrift
  unter dem Brief einer Organisation. Diese Funde bleiben standardmäßig **stehen** (in ⚙︎ umstellbar).

„Absender“ wird nur bei klaren Belegen vergeben (z. B. „GmbH“, „Krankenkasse“, „info@“, „www.“, Fußzeile,
„Ansprechpartner:“). Im Zweifel zählt ein Fund zu deinen Daten. Bei jedem Fund kannst du die Zuordnung mit
**„↺ Gehört zum Absender / zu meinen Daten“** umstellen.

### Gleicher Wert = überall gleich behandelt

Ist ein Wert einmal als eigene Daten erkannt (z. B. die Kundennummer auf Seite 1), gilt das für **jede** Stelle im
Dokument, auch wenn er auf Seite 2 in einer Kopf- oder Fußzeile des Absenders steht. In einer behaltenen Fußzeile wird
dann nur deine Nummer bzw. dein Name ersetzt, der Rest der Fußzeile bleibt.

Zusätzlich gibt es beim Anwenden eine **Sicherheitsrunde**: Jeder Wert, der entfernt wird, wird im ganzen Dokument
gesucht, und jede noch nicht bearbeitete Stelle wird mit entfernt. Meldet der Prüfbericht trotzdem einen Rest, steht
dort, auf welcher Seite er ist, und der Knopf **„Rest entfernen“** beseitigt ihn sofort.

## Adressen als Block

Zusammengehörige Angaben werden als **ein Fund** behandelt, nicht einzeln nach Straße, PLZ und Ort:

- **Adressblock** (Empfänger im Adressfenster, „Herrn/Frau …“ bis „PLZ Ort“)
- **Absenderzeile** (`Firma · Postfach … · PLZ Ort`), **Briefkopf**, **Fußzeile** (alle Zeilen mit Funden)
- einzeilige Adressen im Text („wohnhaft Am Rosengarten 5, 79098 Freiburg“)

Beim Ersetzen wird der Block zeilenweise und stimmig ersetzt: „Herrn“ bleibt, Name, Straße und PLZ/Ort bekommen
passende Ersatzwerte, die zu den übrigen Stellen im Brief passen („Sehr geehrter Herr …“).

## Was erkannt wird

| Risiko | Beispiele |
| --- | --- |
| **hoch** (vorausgewählt) | IBAN (mit Prüfziffer), Kreditkarte (Luhn), Sozialversicherungsnr., Steuer-ID, Geburtsdatum, Gesundheits- und Religionsangaben („Diagnose: …“), Nummern hinter Bezeichnungen wie „Versicherungs-/Ausweis-/Patientennummer“, deine Hinweise |
| **mittel** (vorausgewählt) | Namen (Anrede, „Name:“, Grußformel, bekannter Vorname + Nachname, danach überall im Dokument inkl. Genitiv), Adressen, E-Mail, Telefon, BIC, Kunden-/Vertrags-/Rechnungsnummern, Aktenzeichen, Kfz-Kennzeichen, Geburtsort, Arbeitgeber … |
| **niedrig** (angezeigt, nicht vorausgewählt) | Datumsangaben, Beträge, Webadressen, sonstige lange Nummern, Bilder (mögliche Unterschrift/Foto/Stempel) |

Die Erkennung ist bewusst großzügig: Lieber ein Fund zu viel in der Liste als einer zu wenig. Eingescannte Seiten
(nur Bild, kein Text) werden gemeldet; dort markierst du Bereiche mit **▭** von Hand.

## Ersetzen (Pseudonymisieren) und die Pseudonym-Tabelle

- Ersatzwerte haben **dieselbe Struktur** wie das Original: Eine IBAN bekommt eine andere, aber gültige IBAN
  (gleiches Land, gleiche Länge, korrekte Prüfziffer). Ebenso Sozialversicherungsnummer und Steuer-ID mit Prüfziffer,
  Kreditkarte (Luhn) und Kundennummern mit gleichem Muster (`KV-4711/0815` → `MS-7267/9725`). Datumswerte bleiben im
  selben Format, Namen werden pro Bestandteil ersetzt („Max Mustermann“ → „Jonas Becker“, „Mustermanns“ → „Beckers“,
  `max.mustermann@…` → `jonas.becker@…`).
- Beim Anwenden merkt sich die App die Ersatzwerte in einer **Tabelle auf dem Gerät**. Taucht derselbe Originalwert
  in einem späteren Dokument wieder auf, wird automatisch **derselbe Ersatzwert** vorgeschlagen (Markierung „bekannt“).
- **Die Tabelle enthält keine Originalwerte.** Gespeichert werden nur ein nicht umkehrbarer Fingerabdruck
  (SHA-256 mit geräteeigenem Zufallswert), der Ersatzwert und ein gekürzter Hinweis wie `DE…00`.
- Unter ⚙︎ kannst du die Tabelle ansehen, einzelne Einträge löschen, sie als Datei **sichern** und **wiederherstellen**.

## Gescannte Dokumente (Texterkennung)

Besteht eine Seite nur aus einem Bild (Scan, Foto), liest die App sie per **Texterkennung (OCR)**, und zwar ebenfalls
komplett auf dem Gerät mit [Tesseract.js](https://github.com/naptha/tesseract.js) und dem deutschen Sprachmodell.
Danach funktioniert alles wie bei normalen PDFs: Erkennung, Adressblöcke, Absender/eigene Daten, Schwärzen,
Ersetzen (der Ersatz wird passend in Größe und Farbe ins Bild gesetzt), Schablonen.

- Die Bausteine (ca. 5 MB) liefert die App selbst aus (`vendor/tesseract`). Es wird nichts von fremden Servern
  geladen. Nach dem ersten Mal liegen sie im Gerätespeicher. Übernommen aus dem Projekt *PKV Belege*: Tesseract.js 7,
  Modell `deu` (best_int), `workerBlobURL: false` für die Content-Security-Policy, Seiten in ca. 2000 px Breite.
- Neu gegenüber *PKV Belege*: Die App nutzt die **Lage jedes erkannten Worts** (Grundlinie, Höhe der Großbuchstaben,
  Schräglage), damit Balken und Ersatztext genau sitzen. Bei Scans sind die Balken etwas großzügiger.
- **Prüfung des Bildes:** Bei Scans liest die App das Ergebnis noch einmal per Texterkennung. Ist ein entfernter Wert
  im Bild noch (teilweise) lesbar, meldet der Prüfbericht das mit Seite, und **„Rest entfernen“** schwärzt genau diese
  Stelle nach. Zufällige Ähnlichkeiten (z. B. eine Telefonnummer mit denselben Ziffern) und Ersatzwerte werden
  dabei nicht als Rest gezählt.
- In der Liste steht bei jeder gescannten Seite ein Hinweis mit der Erkennungssicherheit. Bei schlechten Scans
  bitte die Funde kurz prüfen und Fehlendes mit ▭ markieren.
- Abschaltbar unter ⚙︎ („Gescannte Seiten per Texterkennung lesen“).

## Bereiche von Hand markieren

**▭** schaltet den Markiermodus ein. Unten links erscheint eine Leiste:

- **Auf freier Fläche ziehen** legt einen neuen Bereich an. Er ist sofort ausgewählt (4 Griffe an den Ecken).
- **Antippen** wählt einen Bereich aus, **innen ziehen** verschiebt ihn, eine **Ecke ziehen** ändert die Größe.
- **🗑** löscht den ausgewählten Bereich, **↶** macht die letzten Schritte rückgängig (auch mehrfach).
- **‹ ›** blättert (Wischen ist im Markiermodus aus), **Fertig** beendet den Modus.
- Am Computer: Entf löscht, Strg/⌘+Z macht rückgängig.

## Bedienung auf dem iPhone

- Unten sitzt eine **schmale Leiste**: links der Hauptknopf (*Anwenden* → *Speichern*), daneben die Zusammenfassung.
  Antippen oder **nach oben wischen** öffnet die Liste, antippen, **nach unten wischen** oder auf das Dokument tippen
  schließt sie. Die Leiste verdeckt die Seite und die Werkzeugleiste nicht.
- **✕** oben links schließt das Dokument (mit Rückfrage, falls das Ergebnis noch nicht gespeichert ist), **＋ PDF**
  öffnet ein anderes.

## Viewer: Seiten und Lupe

- Immer eine Seite. **Wischen ← →** blättert.
- **🔍 Lupe** zeigt die Seite doppelt so groß in vier Vierteln: oben links → oben rechts → unten links → unten rechts → nächste Seite.
  Wischen ← → geht in dieser Reihenfolge, ↑ ↓ wechselt zwischen oben und unten. Das Lupen-Symbol zeigt, welches Viertel gerade zu sehen ist.
- **Doppeltippen** vergrößert genau die getippte Stelle.
- Die Bedienelemente sitzen links unten, damit man die App gut mit dem linken Daumen bedienen kann.

## Warum die Daten wirklich weg sind

- **Seiten mit Änderungen werden komplett neu als Bild aufgebaut.** Schwärzungen und Ersatzwerte werden direkt in die
  Pixel gemalt, der ursprüngliche Text dieser Seite existiert danach nicht mehr. Der übrige Text und die Ersatzwerte
  werden als unsichtbare Textebene wieder darübergelegt, damit das PDF durchsuchbar bleibt.
- **Das Ergebnis ist ein komplett neues PDF** ohne Metadaten (Titel, Autor, XMP), Kommentare, Formulare, Lesezeichen,
  Dateianhänge, JavaScript und Seitenaktionen.
- **Versteckter Text** (weiße oder winzige Schrift, Formularwerte, Kommentare) wird mit durchsucht. Unsichtbarer Text
  wird unsichtbar entfernt, damit kein verräterischer Balken entsteht.
- **Automatische Prüfung:** Das Ergebnis wird erneut eingelesen und vollständig nach den Originalwerten durchsucht:
  Text, Metadaten, Lesezeichen, Anhänge und alle entpackten Datenströme.

## Datenschutz

- Statische Webseite ohne Server-Logik. PDFs bleiben im Arbeitsspeicher des Browsers.
- Eine Content-Security-Policy verbietet der Seite **jede Verbindung nach außen**. Der Browser-Test prüft das zusätzlich.
- Keine Spracherkennung in der App. Zum Diktieren dient die Tastatur des iPhones (Siri-Diktat). Auf neueren iPhones
  läuft das Diktat für Deutsch laut Apple auf dem Gerät. Wer ganz sichergehen will, tippt den Hinweis.
- Bibliotheken liegen im Ordner `vendor/`, es wird kein fremdes CDN verwendet. Nach dem ersten Aufruf funktioniert die App offline.

## Veröffentlichung

Jeder Push auf `main` veröffentlicht die App über GitHub Pages (`.github/workflows/pages.yml`, inklusive Tests).

**Speichern auf dem iPhone:** iOS erlaubt Webseiten nicht, eine Datei direkt zu überschreiben. „Speichern“ öffnet
deshalb das Teilen-Menü. Dort *„In Dateien sichern“* wählen und für denselben Namen den Ordner des Originals nehmen
und „Ersetzen“ bestätigen. Am Computer (Chrome/Edge) wird die geöffnete Datei direkt überschrieben.

## Entwicklung

```sh
npm start              # lokaler Server auf http://localhost:8080
npm test               # Erkennung, Ersatzwerte, Tabelle (Node, keine Abhängigkeiten)
npm run test:e2e       # kompletter Ablauf im Browser (Playwright + Chromium)
npm run test:samples   # Auswertung an 16 Beispieldokumenten (inkl. 4 Scans) und Abläufen
```

`tests/samples.cjs` erzeugt erfundene, aber realistische Dokumente: Krankenkassen-Abrechnung (zweimal, für den
Schablonen-Test), Handwerkerrechnung, Arztbrief, Formular mit Beschriftung über dem Wert, Kontoauszug,
Finanzamt-Bescheid, Privatbrief, Arbeitsvertrag, zweiseitiger Kanzleibrief und einen aus HTML gedruckten Brief.
`tests/evaluate.cjs` prüft je Dokument, ob alles erkannt und richtig zugeordnet wird (eigene Daten oder Absender,
Blöcke, vollständige Werte, keine Fehltreffer). Danach ersetzt es alle eigenen Daten und prüft, dass davon nichts
mehr im Ergebnis-PDF steht.

| Datei | Aufgabe |
| --- | --- |
| `js/app.js` | Oberfläche und Ablauf |
| `js/detect.js` | Automatische Erkennung im Text, Bewertung, Hinweise verstehen |
| `js/structure.js` | Seitenlayout: Blöcke, Werte unter/neben Beschriftungen, eigene Daten oder Absender |
| `js/templates.js` | Bearbeitungsschablonen (Wiedererkennung, Regeln) |
| `js/data.js` | Vornamen, Nachnamen, Straßen, Orte (Erkennung und Ersatzwerte) |
| `js/pseudo.js` | Ersatzwerte mit Prüfziffern, Pseudonym-Tabelle |
| `js/pdfmodel.js` | Text, Zeichenpositionen und Bilder einer Seite |
| `js/redact.js` | Schwärzen/Ersetzen und Prüfung des Ergebnisses |
| `js/viewer.js` | Seitenansicht mit Wischen, Lupe und Bearbeiten markierter Bereiche |
| `js/ocr.js` | Texterkennung für gescannte Seiten (Tesseract, lokal) |
| `sw.js` | Offline-Fähigkeit |

## Grenzen

- Die Erkennung arbeitet mit Regeln, Mustern, Prüfziffern, Namenslisten und dem Seitenlayout, nicht mit einer KI. Seltene Namen ohne
  Anrede oder Bezeichnung können durchrutschen. In dem Fall hilft ein Hinweis („den Namen …“).
- Texterkennung ist nicht perfekt: Handschrift, sehr schlechte Scans oder ungewöhnliche Schriften können Werte
  verfälschen oder übersehen. Darum bei Scans die Liste prüfen und notfalls mit ▭ ergänzen.
- Text in Logos oder Fotos *innerhalb* eines Text-PDFs wird nicht gelesen (nur ganze Scan-Seiten).
- Ersatztext wird in einer Standardschrift eingesetzt. Er passt sich Größe, Farbe und Breite an, sieht aber nicht immer exakt aus wie die Originalschrift.
- Geänderte Seiten sind danach Bilder mit unsichtbarer Textebene. Die Datei wird etwas größer.

Bibliotheken: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) und
[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0). Die Lizenzen liegen in `vendor/`.
