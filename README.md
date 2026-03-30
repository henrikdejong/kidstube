# 🎬 KidsTube — Veilig YouTube voor Kinderen

Een beveiligde YouTube-filter app voor kleine kinderen. Ouders loggen in met Google, beheren welke content toegestaan is, en kinderen zien alleen goedgekeurde video's in een kindvriendelijke interface.

## Features

- 🔐 **Google / YouTube login** — ouder logt in met eigen Google-account
- 🔒 **Pincode-beveiliging** — app is vergrendeld, standaard pin: `1234`
- 📺 **Echte YouTube-video's** via YouTube Data API v3 met SafeSearch strict
- 🚫 **Geen reclame** als het Google-account YouTube Premium heeft
- 🛡️ **Fullscreen lockdown** — kind kan niet zomaar weg uit de app
- 📋 **Playlist support** — voeg YouTube playlist-ID's toe als bron
- 📱 **PWA-installeerbaar** — voeg toe aan startscherm als echte app
- 🎨 **Kindvriendelijke UI** — grote knoppen, kleurrijk, eenvoudig

## Setup

### 1. Google Cloud Project aanmaken

1. Ga naar [Google Cloud Console](https://console.cloud.google.com/)
2. Maak een nieuw project aan
3. Activeer **YouTube Data API v3** (via API Library)
4. Ga naar **APIs & Services** → **OAuth consent screen**
   - Kies **External**
   - Vul app-naam in (bv. "KidsTube")
   - Voeg je e-mailadres toe als test user
5. Ga naar **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
   - Type: **Web application**
   - Authorized JavaScript origins:
     - `http://localhost:5173` (voor ontwikkeling)
     - `https://jouw-app.azurestaticapps.net` (je Azure URL)
6. Kopieer de **Client ID**

### 2. Lokaal draaien

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, voer pin `1234` in, ga naar ⚙️, plak je Client ID en klik "Inloggen met Google".

### 3. Azure Static Web App

Koppel je GitHub repo aan Azure Static Web Apps:

| Instelling | Waarde |
|---|---|
| App location | `/` |
| API location | *(leeg)* |
| Output location | `dist` |

**Belangrijk:** voeg je Azure URL toe als Authorized JavaScript origin in Google Cloud Console!

### 4. Installeren op tablet/telefoon

1. Open de Azure URL in Chrome (Android) of Safari (iOS)
2. Tik op het menu (⋮ of deelknop)
3. Kies **"Toevoegen aan startscherm"**
4. De app draait nu fullscreen zonder browser-balk

## Gebruik

### Als ouder
1. Open de app → voer pincode in (standaard: `1234`)
2. Tik op ⚙️ → voer opnieuw pincode in
3. Plak je Google **Client ID** en klik **"Inloggen met Google"**
4. Beheer de zoektermen: "Bumba", "Peppa Pig", "Donald Duck"
5. Optioneel: voeg YouTube playlist-ID's toe (beginnen met `PL`)
6. Optioneel: wijzig de pincode
7. Sla op → video's worden opgehaald

### Als kind
1. Opent de app → ziet alleen goedgekeurde video's
2. Kan filteren per categorie (knoppen bovenaan)
3. Tikt op een video om te kijken (autoplay)
4. Kan "zappen" via de suggesties onder de video
5. Kan **niet** weg uit de app (fullscreen + lockdown)
6. De ⚙️ knop is beveiligd met pincode

## Geen reclame?

Als het Google-account waarmee je inlogt **YouTube Premium** heeft, worden er geen advertenties getoond in de embedded player. Dit is de aanbevolen setup.

## Technisch

- **Vite + React** — snelle build, modern tooling
- **Google Identity Services** — OAuth 2.0 token-based login
- **YouTube Data API v3** — zoekt met `safeSearch=strict`
- **YouTube IFrame Player** — officiële embedded player
- **localStorage** — config, pincode en video-cache (token wordt NIET opgeslagen)
- **PWA manifest** — installeerbaar op mobiel

## Veiligheid

- OAuth token wordt alleen in geheugen bewaard, niet in localStorage
- Alle zoekopdrachten gebruiken `safeSearch=strict`
- "voor kinderen" wordt automatisch aan zoektermen toegevoegd
- Geen YouTube-interface, comments of aanbevelingen zichtbaar
- Fullscreen modus + beforeunload voorkomt navigatie weg
- Rechtermuisklik uitgeschakeld
- Instellingen alleen bereikbaar via pincode
- Token verloopt na ~1 uur — ouder moet opnieuw inloggen via instellingen

## Beperkingen

- OAuth consent screen moet in "Testing" mode staan OF gepubliceerd worden voor productiegebruik
- In testing mode kun je max 100 test users toevoegen
- YouTube API heeft een dagelijks quotum van 10.000 units (ruim voldoende voor thuisgebruik)
