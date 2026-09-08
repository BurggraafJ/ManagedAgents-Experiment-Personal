import { useState } from 'react'
import OrgSkillsPanel from './skills/OrgSkillsPanel'
import AppSkillsPanel from './skills/AppSkillsPanel'
import './skills/skills.css'

// SkillsPage (Organisatie › Skills) — twee soorten in-app kennis die de
// vragenbak in zijn prompt injecteert, elk met een eigen tabblad:
//
//   • Begrippen  (`org_skills`)  — korte definities die bij ÉLKE vraag meegaan.
//     "Dit is hoe wij het noemen." Eén trap, org-breed.
//   • Werkwijzen (`app_skills`)  — procedures in drie trappen: de titel gaat
//     altijd mee, de wanneer-openen-regel alleen op de onderzoeks-route, en de
//     tekst zelf pas als het model erom vraagt. "Dit is hoe wij het doen."
//     Met een scope: iedereen, één persoon of één rol.
//
// Dit zijn GEEN Claude-skills en geen MCP-server-instructies: het is kennis in
// de database, hier te bewerken, direct werkzaam in de chat zonder deploy. Zie
// supabase/functions/rag-chat/{org-skills,app-skills}.ts.
//
// v1.134: nieuw (Begrippen). v1.156 (04 PR-B): tweede tabblad Werkwijzen; de
// Begrippen-tabel is ongewijzigd naar skills/OrgSkillsPanel.jsx verhuisd.

const TABS = [
  { key: 'app', label: 'Werkwijzen', hint: 'Procedures in drie trappen — de tekst komt pas mee als de vraag erover gaat.' },
  { key: 'org', label: 'Begrippen', hint: 'Korte definities die in élk antwoord meegaan.' },
]

export default function SkillsPage() {
  const [tab, setTab] = useState('app')

  return (
    <>
      <header className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="admin-page-head__title">Skills</h1>
          <p className="admin-page-head__subtitle">
            Wat de vragenbak over Legal Mind weet zonder het te hoeven zoeken. Hier bewerken werkt direct — geen deploy.
          </p>
        </div>
      </header>

      <div className="admin-skills__tabs" role="tablist" aria-label="Soort kennis">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`admin-skills__tab${tab === t.key ? ' admin-skills__tab--on' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="admin-skills__tabhint">{TABS.find(t => t.key === tab)?.hint}</p>

      {tab === 'app' ? <AppSkillsPanel /> : <OrgSkillsPanel />}
    </>
  )
}
