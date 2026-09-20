# Railway Ticket Booking Tools — Chrome Extension (v2.0 Auto)

Production-quality Chrome Extension designed for Bangladesh Railway ticket booking automation (`eticket.railway.gov.bd`).

---

## 🌟 Key Features

* **Visual Reference Design**: Dark navy/black theme, cyan accents, bright red/orange gradient Autobot button, high information density.
* **Live Bangladesh Clock**: Real-time BST digital clock (`Asia/Dhaka` timezone).
* **Journey Configuration**:
  * Searchable origin & destination station dropdowns with keyboard navigation.
  * Date picker with quick selection shortcuts (`Today`, `Tomorrow`, `+2` to `+10` Days).
  * Target train & seat class selector (`S_CHAIR`, `SNIGDHA`, `AC_S`, `AC_B`, `F_BERTH`, etc.).
  * Seat count and seat mode selection (`1 Seat`, `2 Seats Adjacent`, `3/4 Seats Adjacent`, `2 Seats Face-to-Face`, `Best Available`).
* **Human-Like Pacing**: Configurable action delays with shortcuts (`Fast 350ms`, `Normal 600ms`, `Safe 1000ms`) and randomized variance.
* **Smart Seat Map Engine**: Dynamic DOM seat map parser and spatial relationship analyzer with multi-stage fallback cascade.
* **Safety Bounds (Human Intervention Halts)**: Halts automation immediately when CAPTCHA, OTP, or Payment verification forms are detected.
* **Persistent Settings**: Auto-saves user configuration using `chrome.storage.local`.

---

## 🛠 Project Structure

```text
RailwayBooking/
├── manifest.json            # Manifest V3 extension configuration
├── vite.config.ts           # Vite build & bundle setup
├── index.html               # Popup HTML container
├── src/
│   ├── shared/
│   │   ├── types.ts         # TypeScript interfaces & state machine enums
│   │   ├── constants.ts     # APP_VERSION, stations, seat classes
│   │   ├── storage.ts       # chrome.storage.local helper with localStorage fallback
│   │   └── messages.ts      # Chrome runtime message contracts
│   ├── popup/
│   │   ├── main.tsx         # React entry point
│   │   ├── App.tsx          # Main popup view
│   │   ├── components/      # Header, Clock, JourneySettings, StationInput, DateSelector, etc.
│   │   └── styles/          # Design tokens & CSS
│   ├── background/
│   │   └── serviceWorker.ts # Background service worker
│   ├── content/
│   │   ├── content.ts       # Content script entry
│   │   └── railway/
│   │       ├── selectors.ts # Resilient DOM selectors
│   │       └── RailwayAdapter.ts
│   └── automation/
│       ├── AutomationEngine.ts # Master state machine & AbortController cancellation
│       └── seat/
│           ├── SeatTypes.ts
│           ├── SeatMapParser.ts
│           ├── SeatRelationshipAnalyzer.ts
│           ├── SeatSelectionEngine.ts
│           └── __tests__/   # Vitest unit tests for seat selection algorithms
```

---

## 🚀 How to Build & Load Extension in Chrome

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Unit Tests**:
   ```bash
   npm test
   ```

3. **Build Extension**:
   ```bash
   npm run build
   ```

4. **Load in Google Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in upper right corner)
   - Click **Load unpacked**
   - Select the `dist/` directory inside this project folder

---

## 🔍 Railway Website Dependencies & Selectors

The extension uses resilient fallback selectors in `src/content/railway/selectors.ts` for `eticket.railway.gov.bd`:
- **Origin Station**: `input[name="from_city"]`, `input#from_city`, `#dest_from`
- **Destination Station**: `input[name="to_city"]`, `input#to_city`, `#dest_to`
- **Date**: `input[name="date_of_journey"]`, `input#date_of_journey`, `#doj`
- **Class**: `select[name="seat_class"]`, `select#seat_class`
- **Seat Map**: `.seat-layout`, `.seat-plan`, `#seat_map`
- **Safety Stops**: `#captcha`, `.g-recaptcha`, `.otp-input`, `.bkash-payment`, `#payment_gateway`
