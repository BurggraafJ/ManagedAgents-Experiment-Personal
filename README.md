# Legal Mind Dashboard

React-frontend voor het Legal Mind agent-dashboard. Live op Vercel, data uit Supabase.

## Architectuur

- **Framework:** Vite + React 18 (JavaScript, geen TypeScript)
- **Data:** Supabase (client-side via anon key, read-only via RLS)
- **Hosting:** Vercel (auto-deploy bij elke push naar `main`)

## Lokaal draaien

```bash
cp .env.example .env       # vul VITE_SUPABASE_ANON_KEY in
npm install
npm run dev
```

## Structuur

```
src/
├── main.jsx                # entry
├── App.jsx                 # tab-router
├── index.css               # design tokens
├── lib/supabase.js         # Supabase client
├── hooks/useDashboard.js   # data-fetch + polling
└── components/
    ├── Header.jsx
    ├── TabNav.jsx
    ├── tabs/               # Dashboard | Inbox | Configuratie
    ├── AgentCard.jsx
    ├── Sparkline.jsx
    ├── QuestionPanel.jsx
    ├── QuestionCard.jsx
    └── FeedbackCard.jsx
```

## Deployen

Push naar `main` → Vercel bouwt + deployt automatisch. Live URL leeft in Supabase `agent_config.vercel_live_url`.
