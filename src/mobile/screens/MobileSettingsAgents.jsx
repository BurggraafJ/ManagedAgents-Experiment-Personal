import { useEffect, useMemo } from 'react'
import { useAgentInstructionsEditor } from '../../hooks/useAgentInstructionsEditor'
import { keyboardInset } from '../../lib/keyboardInset'
import {
  friendlyName, instructionText, ruleCount, scheduleLabel, editedLabel, PLACEHOLDERS,
} from '../../lib/agentInstructions'
import RichTextEditor from '../../components/ui/RichTextEditor'
import RteFormatButtons from '../../components/ui/RteFormatButtons'
import { MSetHead, MSetGroup, MSetRow } from './MobileSettingsBits'

// Agents op mobiel (v1.126): niveau 2 = lijst (Met eigen regels · Alleen
// SKILL.md), niveau 3 = editor met gedockte Opslaan-balk boven de tabbar.
// Zelfde data + RPC als desktop (useAgentInstructionsEditor →
// upsert_agent_instructions).

export function MobileAgentsList({ agents, lookup, loading, onBack, onOpen }) {
  const { withRules, without } = useMemo(() => {
    const withRules = [], without = []
    for (const a of agents) (instructionText(lookup[a.agent_name]) ? withRules : without).push(a)
    return { withRules, without }
  }, [agents, lookup])

  return (
    <div className="m-dash m-set">
      <MSetHead back={onBack} backLabel="Instellingen" title="Agents" sub="Vrije-tekst regels per agent, gelezen bij elke run." />
      <div className="m-set__body">
        {agents.length === 0 && (
          <div className="m-set__empty">{loading ? 'Agents laden…' : 'Geen agents geladen.'}</div>
        )}
        {withRules.length > 0 && (
          <MSetGroup label="Met eigen regels">
            {withRules.map(a => {
              const row = lookup[a.agent_name]
              const n = ruleCount(instructionText(row))
              const edited = editedLabel(row?.updated_at)
              return (
                <MSetRow key={a.agent_name} dot="on" title={friendlyName(a)}
                  sub={[`${n} ${n === 1 ? 'regel' : 'regels'}`, edited].filter(Boolean).join(' · ')}
                  onClick={() => onOpen(a.agent_name)} />
              )
            })}
          </MSetGroup>
        )}
        {without.length > 0 && (
          <MSetGroup label="Alleen SKILL.md">
            {without.map(a => (
              <MSetRow key={a.agent_name} dot="off" title={friendlyName(a)} onClick={() => onOpen(a.agent_name)} />
            ))}
          </MSetGroup>
        )}
      </div>
    </div>
  )
}

export function MobileAgentEditor({ schedule, row, onBack }) {
  const ed = useAgentInstructionsEditor(schedule, row)

  // Toetsenbord-lift (--m-kb) + scroll-lock op .m-main, zelfde recept als de
  // Vraagbaak-composer: de dock plakt tegen het toetsenbord óf de tabbar.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('m-set-ed-active')
    const vv = window.visualViewport
    const apply = () => { if (vv) root.style.setProperty('--m-kb', `${keyboardInset(vv)}px`) }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      root.style.setProperty('--m-kb', '0px')
      root.classList.remove('m-set-ed-active')
    }
  }, [])

  const live = schedule.enabled !== false
  const meta = [schedule.agent_name, scheduleLabel(schedule), editedLabel(row?.updated_at)].filter(Boolean).join(' · ')
  const chars = (ed.text || '').length

  return (
    <div className="m-set-ed">
      <MSetHead
        back={onBack} backLabel="Agents"
        title={friendlyName(schedule)}
        titleRight={<span className={`m-set__pill ${live ? '' : 'm-set__pill--off'}`}><i />{live ? 'Live' : 'Uit'}</span>}
        meta={meta}
      />
      <div className="m-set-ed__scroll">
        <div className="m-set-ed__card">
          <div className="m-set-ed__bar">
            <RteFormatButtons className="m-set-ed__fmt" disabled={ed.busy} />
            <span className="m-set-ed__chars">{chars.toLocaleString('nl-NL')} tekens</span>
          </div>
          <div className="m-set-ed__body">
            <RichTextEditor
              valueMd={ed.text}
              onChangeMd={ed.setText}
              resetKey={ed.resetKey}
              disabled={ed.busy}
              placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
              minHeight={260}
            />
          </div>
        </div>
        {ed.saved && !ed.dirty && <div className="m-set-ed__hint m-set-ed__hint--ok">✓ Opgeslagen</div>}
        {ed.err && <div className="m-set-ed__hint m-set-ed__hint--err">⚠ {ed.err}</div>}
      </div>
      <div className="m-set-ed__dock">
        <button type="button" className="m-set-ed__btn" onClick={ed.reset} disabled={ed.busy || !ed.dirty}>Ongedaan</button>
        <button type="button" className="m-set-ed__btn m-set-ed__btn--primary" onClick={ed.save} disabled={ed.busy || !ed.dirty}>
          {ed.busy ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
    </div>
  )
}
