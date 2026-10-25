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
3. **Pro Fund wählen:** *Schwärzen* · *Ersetzen* · *Behalten*. Bei *Ersetzen* steht der Ersatzwert darunter
   (🎲 = neuen erzeugen).
4. **Hinweise geben** (tippen oder über das 🎤 der iPhone-Tastatur diktieren):
   „auch Projekt Alpha“, „den Namen Erika Muster“, „alle Datumsangaben“, „behalte die Beträge“.
5. **Anwenden.** Das Ergebnis erscheint sofort. Mit **Vorher | Nachher** vergleichst du an genau derselben Stelle.
6. **Speichern.** Standardmäßig unter demselben Namen, ein anderer Name lässt sich im Speichern-Dialog eingeben.

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
```

| Datei | Aufgabe |
| --- | --- |
| `js/app.js` | Oberfläche und Ablauf |
| `js/detect.js` | Automatische Erkennung, Bewertung, Hinweise verstehen |
| `js/data.js` | Vornamen, Nachnamen, Straßen, Orte (Erkennung und Ersatzwerte) |
| `js/pseudo.js` | Ersatzwerte mit Prüfziffern, Pseudonym-Tabelle |
| `js/pdfmodel.js` | Text, Zeichenpositionen und Bilder einer Seite |
| `js/redact.js` | Schwärzen/Ersetzen und Prüfung des Ergebnisses |
| `js/viewer.js` | Seitenansicht mit Wischen und Lupe |
| `sw.js` | Offline-Fähigkeit |

## Grenzen

- Die Erkennung arbeitet mit Regeln, Mustern, Prüfziffern und Namenslisten, nicht mit einer KI. Seltene Namen ohne
  Anrede oder Bezeichnung können durchrutschen. In dem Fall hilft ein Hinweis („den Namen …“).
- Text in Bildern und eingescannten Seiten wird nicht gelesen. Dafür gibt es ▭.
- Ersatztext wird in einer Standardschrift eingesetzt. Er passt sich Größe, Farbe und Breite an, sieht aber nicht immer exakt aus wie die Originalschrift.
- Geänderte Seiten sind danach Bilder mit unsichtbarer Textebene. Die Datei wird etwas größer.

Bibliotheken: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) und [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT). Die Lizenzen liegen in `vendor/`.
