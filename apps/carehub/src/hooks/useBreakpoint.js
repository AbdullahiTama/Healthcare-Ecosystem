// Re-export the shared responsive hook from the design-system package (Stage 3 /
// Slice 6). CareHub and CareFind each had a near-identical useBreakpoint; this
// shim keeps existing `import { useBreakpoint } from '../../hooks/useBreakpoint'`
// call sites working while the logic lives in one place, reading the five-tier
// scale from theme.breakpoints (docs/design/GRID_SYSTEM.md).
export { useBreakpoint } from '../../../../packages/design-system/src/components/ui/useBreakpoint.js';
