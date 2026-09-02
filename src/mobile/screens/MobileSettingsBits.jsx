import MIcon from '../MIcon'

// Bouwstenen voor de mobiele Instellingen (v1.126, design A): kop met
// eyebrow óf terug-chevron, inset-groep met label, en de standaard rij
// (icoon · titel/subregel · meta · chevron). Alle tap-targets ≥ 44px.

/** Kop: eyebrow (niveau 1) of terugknop (niveau 2/3) + titel + intro. */
export function MSetHead({ eyebrow, back, backLabel, title, titleRight, sub, meta, children }) {
  return (
    <header className="m-set__head">
      {back ? (
        <button type="button" className="m-set__back" onClick={back}>
          <MIcon name="chevron" size={20} stroke={2.2} />{backLabel}
        </button>
      ) : (
        eyebrow && <div className="m-set__eyebrow">{eyebrow}</div>
      )}
      <h1 className={`m-set__title ${titleRight ? 'm-set__title--row' : ''}`}>
        {title}{titleRight}
      </h1>
      {sub && <p className="m-set__sub">{sub}</p>}
      {meta && <p className="m-set__meta">{meta}</p>}
      {children}
    </header>
  )
}

/** Inset-groep met uppercase label erboven. */
export function MSetGroup({ label, children }) {
  return (
    <section className="m-set__group">
      {label && <div className="m-set__grouplbl">{label}</div>}
      <div className="m-inset">{children}</div>
    </section>
  )
}

/**
 * Rij. `icon` + `tone` (warm/cool/leaf/ink) tekent het icoonblok; `dot`
 * ('on'|'off') vervangt het icoon door een status-dot (agents-lijst).
 * `right` = eigen rechterkant (bv. switch); anders meta + chevron.
 */
export function MSetRow({ icon, tone, dot, title, sub, meta, right, onClick, chevron = true, className = '', ...rest }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`m-inset__row ${className}`}
      onClick={onClick}
      {...rest}
    >
      {dot && <span className={`m-set__dot ${dot === 'off' ? 'm-set__dot--empty' : ''}`} aria-hidden />}
      {icon && (
        <span className={`m-inset__ico ${tone ? `m-inset__ico--${tone}` : ''}`}><MIcon name={icon} size={19} /></span>
      )}
      {sub ? (
        <span className="m-inset__txt">
          <span className="m-inset__lbl">{title}</span>
          <span className="m-inset__sub">{sub}</span>
        </span>
      ) : (
        <span className="m-inset__lbl">{title}</span>
      )}
      {right !== undefined ? right : (
        <>
          {meta != null && meta !== '' && <span className="m-set__count">{meta}</span>}
          {chevron && onClick && <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>}
        </>
      )}
    </Tag>
  )
}

/** iOS-switch (puur visueel; de rij is de knop). */
export function MSwitch({ on }) {
  return <span className={`m-switch ${on ? 'is-on' : ''}`} aria-hidden><span className="m-switch__knob" /></span>
}
