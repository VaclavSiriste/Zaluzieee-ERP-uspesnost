# Operator Metrics Dashboard - Nastavení

## 🚀 Instalace

### 1. Instalace Node.js a Yarn

Na macOS bez Homebrew:
```bash
# Nainstalujte Xcode Command Line Tools
xcode-select --install

# Poté stáhněte Node.js z https://nodejs.org/
# Vyberte LTS verzi

# Po instalaci Node.js, nainstalujte yarn
npm install -g yarn
```

### 2. Instalace dependencí
```bash
cd /Users/vaclavsiriste/Testprojekt/Prvni
yarn install
```

### 3. Spuštění dev serveru
```bash
yarn dev
```

Server poběží na `http://localhost:3000`

---

## 📚 Struktura projektu

```
Prvni/
├── .env                 # Databázové kredence
├── .env.example         # Template pro .env
├── .gitignore          # Git ignore rules
├── next.config.js      # Next.js konfigurace
├── jsconfig.json       # JavaScript config
├── package.json        # Node dependencies
├── pages/              # Next.js pages
│   ├── api/           # API routes
│   │   └── metrics.js # API endpoint pro metriky
│   ├── _app.js        # App wrapper
│   └── index.js       # Home page
├── components/        # React komponenty
│   ├── Dashboard.js   # Hlavní dashboard
│   ├── MetricsCard.js # Komponenta pro metriky
│   └── Filters.js     # Filtrování a segmentace
├── lib/              # Utility funkce
│   ├── db.js        # Databází profily
│   ├── metrics.js   # Výpočty metrik
│   └── calculations.js # Pyramida metrik
├── styles/           # CSS/SCSS
│   └── globals.css
├── public/          # Static assets
└── README.md
```

---

## 📊 Klíčové metriky

### Pyramida metrik (Top-Down)

1. **Úroveň 1: Základní data**
   - Počet sjednaných schůzek
   - Počet realizovaných schůzek

2. **Úroveň 2: Konverzní metriky**
   - Show-up rate = proběhlo / sjednáno
   - Offer rate = nabídka / proběhlo
   - Close rate = uzavřeno / nabídka

3. **Úroveň 3: Odpovědnost**
   - Operátor odpovídá za: show-up rate + kvalitu leadu (offer rate)
   - Obchodník (OVT) odpovídá za: close rate

4. **Úroveň 4: Filtrování**
   - Vyloučení: technical_stop, interní storna
   - Division: storno zákazník vs. interní

5. **Úroveň 5: Segmentace**
   - Region
   - Produkt
   - Lead source (FB, web, cold call)
   - Cenová hladina

### Leaderboard OVT (operátor)

```
| Operátor    | Schůzky | Show-up % | Close % | Avg. Value |
|-------------|---------|-----------|---------|------------|
| User A      |   45    |   92%     |   68%   |   €2,450   |
| User B      |   38    |   87%     |   72%   |   €2,100   |
| ...         |   ...   |   ...     |   ...   |    ...     |
```

---

## 🔌 API Endpoints

### GET /api/metrics
Vrátí metriky s filtrováním

**Query parametry:**
- `startDate` - od (ISO 8601)
- `endDate` - do (ISO 8601)
- `period` - týden/měsíc/rok/YTD
- `operatorId` - filtr operátora
- `region` - filtr regionu
- `product` - filtr produktu
- `leadSource` - filtr zdroje leadu
- `excludeTechnical` - exclude technical stops (true/false)

**Response:**
```json
{
  "period": "month",
  "metrics": {
    "totalMeetings": 120,
    "completedMeetings": 105,
    "showUpRate": 0.875,
    "offerRate": 0.85,
    "closeRate": 0.72,
    "averageValue": 2350
  },
  "leaderboard": [
    {
      "operatorName": "John Doe",
      "meetingCount": 45,
      "showUpRate": 0.92,
      "closeRate": 0.68,
      "avgValue": 2450
    }
  ],
  "funnel": {
    "scheduled": 120,
    "completed": 105,
    "offered": 92,
    "closed": 66
  }
}
```

---

## 🗄️ Struktura databáze (PostgreSQL)

Předpokládané tabulky v ERP:

```sql
-- Schůzky
meetings (
  id, operator_id, scheduled_date, status, 
  result_type, region, product, lead_source, 
  price_range, created_at
)

-- Výsledky
meeting_results (
  meeting_id, result (closed|offer|no_show|cancelled),
  cancellation_reason, is_technical_stop, created_at
)

-- Operátoři
operators (
  id, name, region, created_at
)
```

---

## ⚙️ Proměnné prostředí

V `.env` jsou již nakonfigurované:
- `ERP_DB_CONNECTION_STRING` - PostgreSQL connection
- `ERP_DB_CA_CERT` - SSL certifikát

---

## 📋 TODO - Implementace

- [ ] Vytvořit Next.js API routes s databázovými dotazy
- [ ] Komponenta pro Dashboard s metriky
- [ ] Filtrování a segmentace
- [ ] Časové přepínání (týden/měsíc/YTD)
- [ ] Funnel visualization
- [ ] Leaderboard
- [ ] Export do CSV/PDF
- [ ] Alerty pro anomálie

---

## 🔗 Užitečné zdroje

- [Next.js Docs](https://nextjs.org/docs)
- [PostgreSQL Node Client](https://node-postgres.com/)
- [React Documentation](https://react.dev/)

---

## 👥 Kontakt a schůzky s Dimou

**Pátek v 9:00 - Analytics Review**
- Slot: 2 hodiny
- Témata: Vytíženost operátorů + Úspěšnost schůzek
- Příprava: Potvrdite konkrétní pátek dopředu
