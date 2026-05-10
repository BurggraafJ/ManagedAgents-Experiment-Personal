// Inline icon-helper voor NowView sub-components.
// Vermijdt herhaling van svg-attributen in elke render.
export default function Icon({ children, size = 13 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      stroke="currentColor"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}
