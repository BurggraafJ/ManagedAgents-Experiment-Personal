import './Skeleton.css'

/**
 * <Skeleton> — herbruikbaar shimmer-placeholder primitive.
 *
 * Gebruik tijdens data-fetch om de uiteindelijke shape van de UI alvast te
 * tonen. Subtiele shimmer-animatie (links→rechts gradient) op een
 * paper-2/paper-3 base. Respecteert `prefers-reduced-motion`.
 *
 * Variants:
 *   - block  (default) — generic rectangle, gebruik voor cards / panels
 *   - line   — tekst-regel, default 12px hoog, semi-rounded
 *   - circle — perfecte cirkel, gebruik `size` prop (px)
 *   - pill   — pill / badge, hoog-radius
 *
 * Props:
 *   width   number (px) | string ("60%", "12rem")  | undefined = 100%
 *   height  number (px) | string                    | undefined = variant default
 *   size    number — convenience voor circle (width=height=size)
 *   className  extra classes voor positionering / margin
 *
 * Voorbeeld:
 *   <Skeleton variant="line" width="40%" />
 *   <Skeleton variant="circle" size={32} />
 *   <Skeleton width="100%" height={120} />
 */
export default function Skeleton({
  variant = 'block',
  width,
  height,
  size,
  className = '',
  style: extraStyle,
  ...rest
}) {
  const style = { ...extraStyle }
  if (variant === 'circle' && size != null) {
    style.width = typeof size === 'number' ? `${size}px` : size
    style.height = style.width
  } else {
    if (width != null) style.width = typeof width === 'number' ? `${width}px` : width
    if (height != null) style.height = typeof height === 'number' ? `${height}px` : height
  }

  return (
    <span
      className={`sk sk--${variant} ${className}`.trim()}
      style={style}
      aria-hidden="true"
      {...rest}
    />
  )
}

/**
 * <Skeleton.Group> — semantische wrapper met `role="status"` voor screen
 * readers. Toont één keer een live-region tekst, kindjes zijn aria-hidden.
 */
function SkeletonGroup({ label = 'Inhoud wordt geladen…', className = '', children, ...rest }) {
  return (
    <div
      className={`sk-group ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      {...rest}
    >
      <span className="sk-group__sr">{label}</span>
      {children}
    </div>
  )
}
Skeleton.Group = SkeletonGroup
