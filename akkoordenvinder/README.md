# Akkoordenvinder

Een web-app (PWA) die de akkoorden uit een liedje haalt en ze meeleest terwijl het speelt. Alles draait in de browser; er is geen server en er wordt niets geüpload.

## Wat kan hij

- **Bestand**: mp3, wav, m4a, ogg of flac kiezen (of slepen). Akkoorden, toonsoort, stemming, tijdlijn, akkoordenschema.
- **YouTube**: link plakken, video afspelen en de app laat meeluisteren via de microfoon. Op een computer (Chrome/Edge) kan ook het tabblad-geluid direct worden geanalyseerd, dat is nauwkeuriger.
- **Luisteren**: live via de microfoon (zelf spelen, of muziek in de buurt).
- **Instrumenten**: piano (toetsen), gitaar, ukelele en bas (grepen). Transponeren en capo.
- **Songtekst**: wordt automatisch opgezocht via lrclib.net op basis van de bestandsnaam ("Artiest - Titel.mp3"); met tijden per regel staan de herkende akkoorden meteen boven de juiste woorden en licht de regel op die klinkt. Anders: artiest/titel invullen, of zelf een akkoordenblad (bijv. van Ultimate Guitar) of tekst plakken en per regel synchroniseren met **Nu**. Werkbalk met letter, akkoorden aan/uit, autoscroll en transponeren. Wordt per liedje op het apparaat bewaard. Noem je bestanden dus bij voorkeur `Artiest - Titel.mp3`.
- **Opgeslagen liedjes**: tik op **Opslaan** om een liedje (audio + akkoorden + tekst) op je apparaat te bewaren; het opent daarna meteen, zonder opnieuw analyseren. In Instellingen kun je "Automatisch opslaan" aanzetten.
- Installeerbaar op je telefoon ("Toevoegen aan beginscherm"), werkt daarna ook offline.

## Eigen liedjes (bijv. Suno)

Eigen nummers staan niet in de songtekst-database. Drie manieren om de tekst erbij te krijgen:

1. **Plakken**: kopieer de tekst van de Suno-pagina → Songtekst → **Tekst bewerken** → plakken → **Synchroniseren** → **Tijden schatten** (ruwe verdeling, akkoorden staan meteen erboven) en tik regels die niet kloppen bij tijdens het afspelen.
2. **Tekstbestand**: sommige Suno-extensies exporteren de tekst als `.txt` of `.lrc` (met tijden). Laad dat via **Tekstbestand (.lrc / .txt)**. Een `.lrc` geeft meteen de juiste plek per regel.
3. **In de mp3**: zit de tekst als ID3-tag in de mp3 (USLT/SYLT, sommige exporters doen dat), dan leest de app hem automatisch, net als titel en artiest.

## Online zetten met GitHub Pages (5 minuten)

1. Ga naar https://github.com/new en maak een nieuwe repository, bijvoorbeeld `akkoordenvinder`. Zet hem op **Public** (nodig voor gratis Pages) en klik **Create repository**.
2. Klik op de pagina van de nieuwe repository op **uploading an existing file** (of **Add file → Upload files**).
3. Sleep de **inhoud** van deze map erin: `index.html`, `style.css`, `sw.js`, `manifest.webmanifest`, de map `js` en de map `icons`. (Niet de map zelf, maar wat erin zit; `README.md` mag mee.) Klik **Commit changes**.
4. Ga naar **Settings → Pages**. Kies bij *Build and deployment → Source* **Deploy from a branch**, branch **main**, map **/ (root)**. Klik **Save**.
5. Na een minuut staat de app op `https://<jouw-gebruikersnaam>.github.io/akkoordenvinder/`. Die link staat ook bovenaan de Pages-pagina.

Later iets aanpassen? Upload het gewijzigde bestand opnieuw via **Add file → Upload files** (overschrijft het oude) en verhoog in `sw.js` het nummer in `VERSION` (bijv. `v2`), anders houden geïnstalleerde apps de oude versie vast.

## Op je telefoon zetten

- **Android (Chrome)**: open de link, tik op het menu (⋮) → **App installeren** of **Toevoegen aan startscherm**.
- **iPhone (Safari)**: open de link, tik op het deel-icoon (vierkant met pijl) → **Zet op beginscherm**.

De microfoon werkt alleen via https (GitHub Pages is dat) en vraagt de eerste keer om toestemming.

## Bestanden

| Bestand | Wat |
| --- | --- |
| `index.html` | De pagina |
| `style.css` | Stijl |
| `js/dsp.js` | Herkenning: FFT, chroma, toonsoort, Viterbi, live-detector |
| `js/instruments.js` | Grepen en toetsen per instrument |
| `js/lyrics.js` | Songtekst synchroniseren en akkoorden boven de woorden zetten |
| `js/app.js` | Speler, weergave, instellingen, bestanden |
| `js/live.js` | Microfoon, YouTube, tabblad-audio |
| `js/lyricsui.js` | Bediening van het songtekst-tabblad |
| `js/library.js` | Opgeslagen liedjes (IndexedDB op het apparaat) |
| `sw.js` | Service worker (offline) |
| `manifest.webmanifest`, `icons/` | App-installatie |

## Goed om te weten

- Bij "Songtekst automatisch zoeken" worden alleen artiest en titel naar lrclib.net gestuurd (en bij YouTube de videolink naar noembed.com om de titel op te halen). Het geluid blijft op het apparaat. Uitzetten kan in Instellingen.
- YouTube geeft geen toegang tot zijn audio; daarom wordt er meegeluisterd. Zet het geluid hard en houd de telefoon bij de speaker, of gebruik op een computer "Analyseer tabblad-geluid".
- De herkenning werkt het best bij duidelijke gitaar- of pianobegeleiding. Bij drukke producties of jazzakkoorden kan hij ernaast zitten: zet "Wisselsnelheid" rustiger of gebruik het als startpunt.
