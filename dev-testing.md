# YT Rec Fix - Development & Testing (Local)

Den här filen är **endast lokal** (står i .gitignore) och används för att spara praktiska instruktioner, teststeg och tips så att de inte försvinner i chatten.

## Hur man laddar den temporära / utvecklingsversionen i Firefox

**Viktigt:** Den signerade 0.1.5-versionen (från AMO eller release) **måste tas bort först**. Att ha både den permanenta och en temporär version samtidigt ger konflikter (samma extension ID).

### Alternativ 1: Manuellt (enklast att komma igång)

1. Gå till `about:addons`
2. Hitta "YT Rec Fix (Watched Blocker)" → ta bort eller disable den permanenta versionen.
3. Gå till `about:debugging#/runtime/this-firefox`
4. Klicka på **"Load Temporary Add-on..."**
5. Välj filen `manifest.json` i roten av det här projektet (`/home/danne/YTaddon/manifest.json`)
6. Firefox laddar nu den temporära versionen (du ser ofta en grön punkt på ikonen).
7. **Ge behörighet** om det behövs:
   - Klicka på pusselbiten (extensions) → hitta YT Rec Fix → kugghjul → tillåt "Access your data for www.youtube.com"
8. Hard-reloada YouTube-sidan (Ctrl+Shift+R eller Cmd+Shift+R).

Efter kodändringar (särskilt i popup eller content script):
- Gå tillbaka till `about:debugging`
- Klicka på **Reload**-knappen bredvid den temporära addon:en.

### Alternativ 2: Rekommenderat för utveckling – `web-ext` (npm run dev)

Det här är det smidigaste sättet när man itererar mycket (auto-reload vid filändringar).

1. Se till att den permanenta 0.1.5-versionen är borttagen (se ovan).
2. I projektroten kör du:

   ```bash
   npm run dev
   ```

Första gången kan du behöva:

```bash
npm install
```

Andra användbara kommandon (finns i package.json):

- `npm run dev:chromium` – testa i Chrome/Edge
- `npm run lint`
- `npm run build`

`web-ext` är Mozillas officiella verktyg för addon-utveckling.

### Vanliga fel & lösningar

#### "Error: not found: firefox" (särskilt i WSL + Windows 11)

Detta är förväntat när du kör i en **blandad miljö** (Windows 11 som primärt OS + WSL för terminal/Grok).

- Du kör `npm run dev` inifrån WSL (Linux-miljö).
- Firefox är installerat på Windows-sidan (normal desktop-version).
- Därför finns det ingen `firefox`-binär i WSL:ets PATH → `web-ext` hittar den inte.

Detta är en vanlig och fullt fungerande setup för Firefox addon-utveckling.

**Hitta din Windows Firefox-sökväg**

Kör i PowerShell (på Windows-sidan, inte i WSL):

```powershell
(Get-Command firefox).Source
# eller
Get-ChildItem "C:\Program Files\Mozilla Firefox\firefox.exe" -ErrorAction SilentlyContinue
Get-ChildItem "C:\Program Files (x86)\Mozilla Firefox\firefox.exe" -ErrorAction SilentlyContinue
```

Vanligaste sökvägen är:
`C:\Program Files\Mozilla Firefox\firefox.exe`

Från WSL blir den:
`/mnt/c/Program Files/Mozilla Firefox/firefox.exe`

**Kör med rätt binary (tillfälligt):**

```bash
npm run dev -- --firefox-binary="/mnt/c/Program Files/Mozilla Firefox/firefox.exe"
```

**Permanent bekvämt sätt**

Vi har redan lagt till stöd för `FIREFOX_BINARY` i `package.json`. Du kan göra så här:

```bash
# Engångskörning
FIREFOX_BINARY="/mnt/c/Program Files/Mozilla Firefox/firefox.exe" npm run dev

# Eller lägg till i din WSL bashrc/zshrc för alltid
echo 'export FIREFOX_BINARY="/mnt/c/Program Files/Mozilla Firefox/firefox.exe"' >> ~/.bashrc
source ~/.bashrc
npm run dev
```

#### Andra vanliga problem

**"Behörigheter behövs" / grön prick på ikonen**
- Klicka på pusselbiten → YT Rec Fix → kugghjul → tillåt "Access your data for www.youtube.com".
- Hard-reloada YouTube-sidan efteråt (Ctrl + Shift + R).

**web-ext startar inte Firefox alls**
- Dubbelkolla att sökvägen ovan är korrekt (kolla om det finns `firefox.exe` på den platsen i Utforskaren).
- Ibland heter mappen annorlunda om du installerat via Microsoft Store eller har flera versioner (Nightly/Beta).

**Auto-reload fungerar inte perfekt**
- Det funkar oftast bra över WSL-gränsen, men ibland behöver du manuellt hard-reloada fliken i Firefox efter större ändringar.

`package.json` är uppdaterad med `FIREFOX_BINARY`-stöd så det blir enkelt att använda i WSL + Windows-miljö.

### Flytta projektet från WSL till native Windows (rekommenderat om du mest kör i Windows)

Om du vill slippa WSL-relaterade problem med Firefox + web-ext helt, är det fullt rimligt att flytta koden till ren Windows-miljö.

**Steg-för-steg (säker flytt):**

1. **Spara ditt nuvarande arbete på en egen branch först** (viktigt!):
   ```bash
   git checkout -b wsl-to-native-windows
   git add -A
   git commit -m "Save state before moving from WSL to native Windows"
   git push origin wsl-to-native-windows   # om du har remote
   ```

2. **På Windows-sidan (PowerShell eller Git Bash)** skapa en ny mapp, t.ex.:
   ```
   C:\dev\yt-rec-fix
   eller
   D:\Projects\YTaddon
   ```

3. **Kopiera bara källkoden** (hoppa över dessa kataloger/filer):

   **Hoppa alltid över:**
   - `node_modules/`          ← Störst och farligast (plattformsspecifika binärer)
   - `dist/`                  ← Build-artefakter
   - `web-ext-artifacts/`     ← web-ext build-output
   - `screenshots/`           ← Lokala debug-bilder (redan i .gitignore)
   - `dev-testing.md`         ← Personliga anteckningar (redan i .gitignore)
   - `.git/`                  ← Kopiera inte manuellt

   **Kopiera istället:**
   - Alla andra filer och mappar (`content/`, `popup/`, `icons/`, `images/`, `manifest.json`, `package.json`, `package-lock.json`, `README.md`, `.gitignore` osv.)

4. **I den nya Windows-mappen:**
   ```powershell
   cd C:\dev\yt-rec-fix
   npm install                 # skapar ny node_modules för Windows
   git clone -b wsl-to-native-windows <ditt-repo-url> .     # om du pushade
   # eller
   git init
   git remote add origin <ditt-repo-url>
   git fetch
   git checkout wsl-to-native-windows
   ```

5. Testa:
   ```powershell
   npm run dev
   ```
   Nu borde Firefox hittas direkt utan `--firefox-binary`.

**Fördelar med att flytta till native Windows:**
- Mycket enklare att starta Firefox (ingen path-översättning).
- Bättre prestanda på filwatch ibland.
- Mindre "dubbelmiljö"-konfusion.

**Nackdelar:**
- Du tappar Linux-verktyg om du gillade det i bash.
- Du kan fortsätta använda Git Bash om du vill ha bash-känsla på Windows.

När du är klar på Windows-sidan kan du ta bort (eller behålla som backup) den gamla WSL-mappen.

#### Andra vanliga problem

- **"Behörigheter behövs" / grön prick**: Ge host permission via pusselbiten på ikonen → YT Rec Fix → kugghjul.
- Efter kodändringar: web-ext brukar ladda om automatiskt, men ibland behöver du hard-reloada YouTube-sidan (Ctrl+Shift+R).
- Om du har den signerade 0.1.5-versionen installerad samtidigt → ta bort den i `about:addons` först.

`web-ext` är bra, men på Linux kan man behöva peka ut Firefox-binären en gång.

## Testa de senaste ändringarna (feedback + debug)

De senaste ändringarna handlar om att **inte gömma kortet för tidigt** så att YouTubes "Tell us why"-panel (med checkboxar) får synas och vi kan klicka i den automatiskt. 

Som UX-förbättring (0.1.6) göms den mellanliggande "Video removed" / Tell us why-panelen som YouTube renderar **nästan direkt efter** att vi submittat anledningarna. Detta minskar flashen av det tillfälliga mellanläget (se `screenshots/resulting_code.png`) utan att påverka klick eller signaler.

### Steg för test:

1. Se till att du kör den **temporära** versionen (se ovan).
2. Öppna YouTube (startsida eller trending).
3. Öppna tilläggs-popupen (klicka på ikon) och bocka i:
   - **Enable debug logging (console)**
4. Klicka på "Watched" eller "👎" på en rekommendation.
5. Öppna DevTools Console (F12) och filtrera på `[YT-Rec-Fix]` (alla loggar använder nu detta prefix för enkel filtrering).

**Vad du vill se i konsolen (med debug på):**

- `Post "Not interested" — looking for YT-created Tell us why reason panel or button...`
- Antingen:
  - `Direct reason chooser panel located...`
  - eller `Tell us why button found — clicking it...`
- `Checkboxes found in follow-up...` + cbDump
- `Clicked watched reason checkbox:...` (och ev. dislike)
- `Clicking submit button:...` + `reasonsClicked: ["watched"]` eller `["watched", "dislike"]`
- `YT network: POST https://www.youtube.com/youtubei/v1/feedback...` (interceptor-logg när debug är på)
- `Feedback automation result { ok: true, reason: 'full-flow-completed', ... }`
- `Post-feedback UI evidence found ...` (t.ex. 'undo:button "Undo"')
- `hid card <video-id>` (nu med riktigt ID, inte "null")

Du kommer troligen **knappt eller inte alls** se den sista checkbox-popupen (med "I've already watched..." + Submit). Det är avsiktligt – automatiseringen är snabb och containern göms direkt efter submit för att minska visuell störning.

Kortet kan synas en kort stund (utan våra knappar) medan panelen dyker upp och vi väljer + submittar. Sen göms det lokalt som vanligt.

**Vid sidladdning / hard reload** kommer du ofta se flera `hid card <id>` för tidigare blockerade videos. Det är den lokala blocklistan som gör sitt jobb (den scannar och gömmer kända ID:n varje gång).

### Snabbtest från konsolen (utan att klicka knappar)

```js
// Testa direkt på första synliga kortet
window.__YT_REC_FIX__.debugTriggerOnFirstCard('watched')

// Eller med dislike
window.__YT_REC_FIX__.debugTriggerOnFirstCard('dislike')
```

### Snabbtest från konsolen (utan att klicka knappar)

```js
// Testa direkt på första synliga kortet
window.__YT_REC_FIX__.debugTriggerOnFirstCard('watched')

// Eller med dislike
window.__YT_REC_FIX__.debugTriggerOnFirstCard('dislike')
```

## Tips för att spara framtida instruktioner

- Säg till mig:  
  **"Uppdatera dev-testing.md med de senaste instruktionerna"**  
  eller  
  **"Lägg till teststeg för X i dev-testing.md"**

- Jag kan då skriva in det direkt i den här filen så det finns kvar lokalt.

- Du kan också be mig att "Sammanfatta de viktigaste stegen just nu som en kort checklista".

## Andra vanliga dev-kommandon

- `git status`
- `git diff`
- Efter ändringar: `npm run lint` (om du vill)
- För att bygga en test-zip: `npm run build`

---

Lycka till med testningen! Om du kör `npm run dev` och aktiverar debug så får du väldigt bra loggar just nu för att verifiera att "Tell us why" + reasons faktiskt skickas till Youtube.