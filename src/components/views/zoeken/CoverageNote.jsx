import s from './zoeken.module.css'
import { Ico } from './Icons'

// WP2 — een leeg antwoord noemt zijn oorzaak.
//
// Tot v1.146 kreeg Jelle bij elk van deze vijf situaties dezelfde vriendelijke
// alinea: "hier kon ik niets over vinden". Een zoekactie die in een time-out
// liep zag er precies zo uit als een index die het echt niet weet, en dat is
// het verschil tussen "probeer het nog eens" en "dit bestaat niet".
//
// Gemeten op 2026-09-05: van de chat-runs die context-build echt aanriepen was
// 4 van de 12 een time-out — en geen enkele een lege index. De leegte kwam dus
// nooit door de index, altijd door de klok. Dat was in de interface niet te
// zien.
//
// De tekst is bewust feitelijk en zonder excuus, en bij acl_filtered staat
// nadrukkelijk NIET wát er is afgeschermd: het bestaan van een pagina in een
// afgeschermde space is zelf informatie.
const REASONS = {
  timeout: {
    icon: 'clock',
    kop: 'De zoekactie liep in een time-out',
    uitleg: 'Er is dus niets doorzocht. Dit zegt niets over of de informatie bestaat — probeer het opnieuw, of stel de vraag smaller.',
    toon: 'warn',
  },
  acl_filtered: {
    icon: 'lock',
    kop: 'Beperkte leesrechten op de wiki',
    uitleg: 'Binnen het deel van de wiki dat je mag lezen staat hier niets over. Er kan elders meer zijn; dat is van hieruit niet te zien.',
    toon: 'info',
  },
  below_threshold: {
    icon: 'search',
    kop: 'Wel gevonden, niet dichtbij genoeg',
    uitleg: 'Er zijn fragmenten die er in de verte op lijken, maar geen enkele haalde de gelijkenisdrempel — ook niet na een tweede poging met een lagere drempel.',
    toon: 'info',
  },
  truly_empty: {
    icon: 'search',
    kop: 'Hier staat niets over in de index',
    uitleg: 'Er is wel degelijk gezocht, in alle bronnen. De kennisindex bevat er niets over.',
    toon: 'info',
  },
  not_tracked: {
    icon: 'alert',
    kop: 'Reden onbekend',
    uitleg: 'Het antwoord staat op geen enkele bron en de oorzaak kon niet worden vastgesteld. Dat hoort niet voor te komen — meld het.',
    toon: 'warn',
  },
}

export default function CoverageNote({ coverage }) {
  const reason = coverage?.reason
  if (!reason) return null
  const r = REASONS[reason] || REASONS.not_tracked
  const searched = Array.isArray(coverage.searched) ? coverage.searched : []
  const notSearched = Array.isArray(coverage.not_searched) ? coverage.not_searched : []

  return (
    <div className={`${s.covNote} ${r.toon === 'warn' ? s.covWarn : ''}`}>
      <span className={s.covIcon}>{Ico[r.icon] || Ico.search}</span>
      <div className={s.covBody}>
        <strong className={s.covKop}>{r.kop}</strong>
        <span className={s.covUitleg}>{r.uitleg}</span>
        {(searched.length > 0 || notSearched.length > 0) && (
          <span className={s.covBronnen}>
            {searched.length > 0 && <>Doorzocht: {searched.join(', ')}.</>}
            {notSearched.length > 0 && <> Niet doorzocht: {notSearched.join(', ')}.</>}
          </span>
        )}
      </div>
    </div>
  )
}
