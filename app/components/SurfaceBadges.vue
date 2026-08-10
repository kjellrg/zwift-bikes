<script setup lang="ts">
import type { SurfaceComposition, SurfaceEstimate, ZwiftSurfaceType } from '../../shared/types/catalog'

const props = defineProps<{
  surface: SurfaceEstimate
}>()

// Only `'measured'`/`'curated'` routes ever have non-zero gravel/cobble -
// `'unverified'` and `'heuristic'` routes always default to 100% road (see
// `estimateSurface` in `routeTerrain.ts`), so there's nothing non-tarmac to
// show for them.
const hasNonTarmac = computed(
  () => props.surface.gravel > 0 || props.surface.cobble > 0
)

// The `gravel`/`cobble` fields are coarse buckets for scoring/filtering
// (see `coarsenSurfaceComposition` in `surfaceCrr.ts`) - "cobble" also
// covers brick and wood/boardwalk, and "gravel" also covers dirt/snow/
// grass/sand. Labelling every non-tarmac route "X% cobbles" is misleading
// when the real surface is e.g. a wooden boardwalk (as on Canopies and
// Coastlines) - use the detailed composition, when available, to name what
// the surface actually is instead of the bucket name.
const COBBLE_BUCKET_TYPES: ZwiftSurfaceType[] = ['brick', 'wood', 'cobbles']
const GRAVEL_BUCKET_TYPES: ZwiftSurfaceType[] = ['dirt', 'snow', 'grass', 'sand', 'gravel']

function describeBucket<T>(
  composition: SurfaceComposition | undefined,
  types: ZwiftSurfaceType[],
  fallback: T,
  mixed: T,
  resolve: (type: ZwiftSurfaceType) => T
): T {
  if (!composition) return fallback
  const present = types.filter(type => (composition[type] ?? 0) > 0)
  if (present.length === 0) return fallback
  if (present.length === 1) return resolve(present[0]!)
  return mixed
}

const cobbleLabel = computed(() =>
  describeBucket(props.surface.composition, COBBLE_BUCKET_TYPES, 'cobbles', 'rough surface', type => SURFACE_TYPE_LABELS[type].toLowerCase())
)
const gravelLabel = computed(() =>
  describeBucket(props.surface.composition, GRAVEL_BUCKET_TYPES, 'gravel', 'loose surface', type => SURFACE_TYPE_LABELS[type].toLowerCase())
)
// Generic bucket icons (mountain-snow/grip) match the previous fixed icons -
// used whenever the surface mix is unknown or genuinely mixed; a specific
// icon is used when the bucket resolves to exactly one real surface type.
const cobbleIcon = computed(() =>
  describeBucket(props.surface.composition, COBBLE_BUCKET_TYPES, 'i-lucide-grip', 'i-lucide-grip', type => SURFACE_TYPE_ICONS[type])
)
const gravelIcon = computed(() =>
  describeBucket(props.surface.composition, GRAVEL_BUCKET_TYPES, 'i-lucide-mountain-snow', 'i-lucide-mountain-snow', type => SURFACE_TYPE_ICONS[type])
)

const tooltipText = computed(() =>
  props.surface.confidence === 'measured'
    ? 'Measured from this route\'s real GPS trace against zwiftmap\'s community-mapped surface data (MIT licensed - see THIRD_PARTY_NOTICES.md).'
    : 'Best-effort estimate based on public route descriptions. Which Zwift worlds contain gravel/cobble sections at all is cross-checked against zwiftmap\'s community-mapped surface data (MIT licensed - see THIRD_PARTY_NOTICES.md).'
)
</script>

<template>
  <div
    v-if="hasNonTarmac"
    class="flex flex-wrap items-center gap-1.5"
  >
    <UBadge
      v-if="surface.gravel > 0"
      color="warning"
      variant="subtle"
      :icon="gravelIcon"
    >
      ~{{ formatPercent(surface.gravel) }} {{ gravelLabel }}
    </UBadge>
    <UBadge
      v-if="surface.cobble > 0"
      color="neutral"
      variant="subtle"
      :icon="cobbleIcon"
    >
      ~{{ formatPercent(surface.cobble) }} {{ cobbleLabel }}
    </UBadge>
    <UTooltip :text="tooltipText">
      <UIcon
        name="i-lucide-info"
        class="size-4 text-muted"
      />
    </UTooltip>
  </div>
</template>
