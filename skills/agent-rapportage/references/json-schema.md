# JSON Schema — Rapportageformat

Dit document beschrijft het exacte format dat elke skill moet gebruiken om te rapporteren. Er zijn twee soorten bestanden: een **runlog** (na elke run) en een **skill-registratie** (eenmalig).

---

## 1. Runlog (na elke run)

**Locatie:** `/home/user/agent-reports/runs/{skill-naam}-{YYYY-MM-DD}T{HH-MM}.json`

**Voorbeeld bestandsnaam:** `auto-draft-2026-04-01T08-00.json`

Schrijf dit bestand als **allerlaatste stap** van je run. Zelfs als de run faalde — schrijf dan het runlog met `status: "failed"`.

```json
{
  "skill": "auto-draft",
  "run_id": "auto-draft-2026-04-01T08-00",
  "started_at": "2026-04-01T08:00:12Z",
  "finished_at": "2026-04-01T08:03:45Z",
  "duration_seconds": 213,
  "status": "success",
  "summary": "6 mails verwerkt, 4 drafts geschreven, 2 overgeslagen (auto-reply)",
  "metrics": {
    "processed": 6,
    "drafts_created": 4,
    "skipped": 2,
    "errors": 0
  },
  "errors": [],
  "warnings": [],
  "questions": [],
  "next_scheduled": "2026-04-01T10:00:00Z"
}
```

### Veldverklaring

| Veld | Type | Verplicht | Beschrijving |
|---|---|---|---|
| `skill` | string | Ja | De naam van de skill, exact zoals in het skill-registratiebestand |
| `run_id` | string | Ja | Unieke ID: `{skill-naam}-{timestamp}` |
| `started_at` | ISO 8601 | Ja | Starttijd van de run |
| `finished_at` | ISO 8601 | Ja | Eindtijd van de run |
| `duration_seconds` | number | Ja | Duur in seconden |
| `status` | string | Ja | Een van: `"success"`, `"partial"`, `"failed"`, `"skipped"` |
| `summary` | string | Ja | Menselijk leesbare samenvatting in 1-2 zinnen. Dit is het belangrijkste veld — het verschijnt in het dagrapport en de e-mail. Wees specifiek: niet "run voltooid" maar "12 kantoren verrijkt, 3 overgeslagen (website down)" |
| `metrics` | object | Ja | Vrij object met skill-specifieke cijfers. Elke skill vult hier in wat relevant is. Gebruik altijd consistente keys tussen runs van dezelfde skill |
| `errors` | array | Ja | Array van error-objecten (zie onder). Leeg als er geen fouten waren |
| `warnings` | array | Ja | Array van warning-strings. Voor zaken die niet faalden maar aandacht verdienen |
| `questions` | array | Ja | Array van question-objecten voor Jelle (zie onder). Leeg als er geen vragen zijn |
| `next_scheduled` | ISO 8601 | Nee | Wanneer de volgende run gepland staat. Null als niet van toepassing |

### Status-waarden

| Status | Betekenis | Wanneer gebruiken |
|---|---|---|
| `success` | Alles gelukt | De run is volledig afgerond zonder fouten |
| `partial` | Deels gelukt | Sommige taken gelukt, andere niet (bijv. 8 van 10 mails verwerkt) |
| `failed` | Mislukt | De run kon niet (zinvol) worden afgerond |
| `skipped` | Overgeslagen | De run was niet nodig (bijv. geen nieuwe mails, lock actief, buiten werktijd) |

### Error-objecten

```json
{
  "code": "CHROME_UNREACHABLE",
  "message": "Chrome kon niet bereikt worden — mogelijk gecrasht of niet gestart",
  "severity": "critical",
  "context": "Stap 0b: Chrome-check"
}
```

| Veld | Beschrijving |
|---|---|
| `code` | Korte error-code in UPPER_SNAKE_CASE. Gebruik consistente codes zodat ze te filteren zijn |
| `message` | Menselijk leesbare uitleg |
| `severity` | `"critical"` (run gestopt), `"warning"` (run ging door), of `"info"` (ter informatie) |
| `context` | In welke stap van de skill de fout optrad |

### Question-objecten (voor vragen aan Jelle)

```json
{
  "question_id": "auto-draft-2026-04-01-q1",
  "question": "Mail van advocaat Van der Berg bevat een klacht over facturatie. Moet ik een draft schrijven of is dit een escalatie?",
  "options": ["Draft schrijven", "Overslaan — escalatie", "Doorsturen naar CS team"],
  "context": "Mail ontvangen om 14:23, onderwerp: 'Factuur maart incorrect'",
  "priority": "medium",
  "posted_to_slack": true,
  "slack_thread_ts": "1234567890.123456"
}
```

Wanneer een skill een vraag heeft:
1. Voeg het question-object toe aan het runlog
2. Post de vraag naar `#agent-vragen` in Slack met de opties
3. Sla de `slack_thread_ts` op zodat het dagrapport kan checken of er al een antwoord is

---

## 2. Skill-registratie (eenmalig)

**Locatie:** `/home/user/agent-reports/skills/{skill-naam}.json`

**Voorbeeld bestandsnaam:** `auto-draft.json`

Schrijf dit bestand **eenmalig** bij de eerste run. Check altijd of het al bestaat — zo ja, overschrijf het niet.

```json
{
  "skill": "auto-draft",
  "display_name": "Auto-Draft",
  "description": "Schrijft concept-antwoorden op nieuwe mails in Jelle's schrijfstijl",
  "category": "personal-ops",
  "schedule": "Werkdagen elke 2u (08:00-20:00), weekend 11:00 + 17:00",
  "registered_at": "2026-04-01T08:00:12Z",
  "metric_labels": {
    "processed": "Mails verwerkt",
    "drafts_created": "Drafts geschreven",
    "skipped": "Overgeslagen",
    "errors": "Fouten"
  },
  "health_rules": {
    "max_hours_without_run": 4,
    "min_success_rate_24h": 0.8
  },
  "alert_channel": true,
  "primary_metric": "drafts_created"
}
```

### Veldverklaring

| Veld | Type | Verplicht | Beschrijving |
|---|---|---|---|
| `skill` | string | Ja | Interne naam, moet overeenkomen met wat in runlogs staat |
| `display_name` | string | Ja | Mooie naam voor het dashboard en e-mail |
| `description` | string | Ja | Korte beschrijving (1 zin) voor het dagrapport |
| `category` | string | Ja | Groepering: `"personal-ops"`, `"sales"`, `"development"`, `"crm"`, of `"other"` |
| `schedule` | string | Ja | Menselijk leesbare beschrijving van het schedule |
| `registered_at` | ISO 8601 | Ja | Wanneer de skill zich voor het eerst registreerde |
| `metric_labels` | object | Ja | Vertaling van metric-keys naar leesbare labels. De keys hier moeten overeenkomen met de keys in `metrics` in de runlogs |
| `health_rules` | object | Ja | Regels voor de health-check (zie onder) |
| `alert_channel` | boolean | Ja | Of deze skill naar `#agent-alerts` post bij fouten |
| `primary_metric` | string | Ja | Welke metric-key het belangrijkst is — deze wordt getoond in de compacte Slack-samenvatting |

### Health rules

| Regel | Beschrijving |
|---|---|
| `max_hours_without_run` | Na zoveel uur zonder succesvolle run wordt de skill als "inactief" gemarkeerd in het dashboard |
| `min_success_rate_24h` | Minimaal succespercentage over de laatste 24 uur. Onder deze drempel wordt een waarschuwing gegeven |

---

## 3. Config-bestand (systeembreed)

**Locatie:** `/home/user/agent-reports/config.json`

Dit bestand wordt aangemaakt bij de setup en bevat de Slack-kanaal-ID's en andere systeembrede configuratie.

```json
{
  "channels": {
    "rapportage": "C_XXXXXXXXX",
    "alerts": "C_XXXXXXXXX",
    "vragen": "C_XXXXXXXXX"
  },
  "email": "burggraaf@legal-mind.nl",
  "canvas_id": "F_XXXXXXXXX",
  "reports_dir": "/home/user/agent-reports",
  "retention_days": 30,
  "daily_report_time_weekday": "21:00",
  "daily_report_time_weekend": "18:00"
}
```

---

## Hoe een skill dit in de praktijk gebruikt

### Stap 1: Check of je geregistreerd bent

```bash
if [ ! -f /home/user/agent-reports/skills/mijn-skill.json ]; then
  # Schrijf het registratiebestand (zie format hierboven)
fi
```

### Stap 2: Doe je werk (de normale skill-logica)

Houd tijdens de run bij:
- Starttijd
- Welke taken gelukt/gefaald zijn
- Metrics die relevant zijn
- Eventuele fouten of vragen

### Stap 3: Schrijf het runlog

Als **allerlaatste stap**, schrijf het JSON-bestand naar `/home/user/agent-reports/runs/`.

### Stap 4: Bij fouten of vragen — Slack

- **Fouten (severity: critical):** Post een kort bericht naar `#agent-alerts`:
  ```
  🚨 Auto-Draft [08:00] | FAILED — Chrome onbereikbaar
  Details: Chrome kon niet bereikt worden, mogelijk gecrasht. Run afgebroken.
  ```

- **Vragen aan Jelle:** Post naar `#agent-vragen`:
  ```
  🙋 Auto-Draft vraagt:
  Mail van advocaat Van der Berg bevat een klacht over facturatie. Moet ik een draft schrijven of is dit een escalatie?

  Opties:
  1. Draft schrijven
  2. Overslaan — escalatie
  3. Doorsturen naar CS team

  Context: Mail ontvangen om 14:23, onderwerp: 'Factuur maart incorrect'
  ```

Lees de kanaal-ID's uit `/home/user/agent-reports/config.json`. Als het config-bestand niet bestaat, maak het aan met placeholder-waarden en meld dit als warning.
