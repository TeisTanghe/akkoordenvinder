# Akkoordenvinder

Een web-app (PWA) die de akkoorden uit een liedje haalt en ze meeleest terwijl het speelt. Alles draait in de browser; er is geen server en er wordt niets geüpload.

## Wat kan hij

- **Bestand**: mp3, wav, m4a, ogg of flac kiezen (of slepen). Akkoorden, toonsoort, stemming, tijdlijn, akkoordenschema.
- **YouTube**: link plakken, video afspelen en de app laat meeluisteren via de microfoon. Op een computer (Chrome/Edge) kan ook het tabblad-geluid direct worden geanalyseerd, dat is nauwkeuriger.
- **Luisteren**: live via de microfoon (zelf spelen, of muziek in de buurt).
- **Instrumenten**: piano (toetsen), gitaar, ukelele en bas (grepen). Transponeren en capo.
- **Songtekst**: tekst plakken, per regel synchroniseren met de knop **Nu** (of spatiebalk), daarna staan de akkoorden boven de woorden en licht de regel op die nu klinkt. Wordt per liedje op het apparaat bewaard.
- Installeerbaar op je telefoon ("Toevoegen aan beginscherm"), werkt daarna ook offline.

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
| `sw.js` | Service worker (offline) |
| `manifest.webmanifest`, `icons/` | App-installatie |

## Goed om te weten

- YouTube geeft geen toegang tot zijn audio; daarom wordt er meegeluisterd. Zet het geluid hard en houd de telefoon bij de speaker, of gebruik op een computer "Analyseer tabblad-geluid".
- De herkenning werkt het best bij duidelijke gitaar- of pianobegeleiding. Bij drukke producties of jazzakkoorden kan hij ernaast zitten: zet "Wisselsnelheid" rustiger of gebruik het als startpunt.
