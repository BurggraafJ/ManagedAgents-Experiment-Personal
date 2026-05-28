// TimelineParts — barrel-export voor SenderTimeline + CompanyTimeline.
// De daadwerkelijke implementatie staat in `./timeline/` zodat elk bestand
// onder de 400-LOC cap blijft.
export {
  TYPES, classifyThread, stripHtml, formatDayShort, formatEventTime, truncate,
} from './timeline/timelineHelpers'
export { TypeBadge, Chev, AttributionBadge, BodyBlock } from './timeline/TimelineBadges'
export {
  StyleToggle, FilterChips, NotesToggle, ExpandAllButton, Legend,
} from './timeline/TimelineControls'
export { GroupSection } from './timeline/TimelineItems'
export { EmptyGraphic, LoadingGraphic, ErrorGraphic } from './timeline/TimelineGraphics'
