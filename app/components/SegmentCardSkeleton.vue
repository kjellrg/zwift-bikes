<template>
  <!-- `SegmentCard`'s own shape for a climb: the outline, the name, the foot. -->
  <div
    class="h-full rounded-xl border border-default bg-elevated px-4 pt-3.5 pb-3.5"
    aria-hidden="true"
  >
    <USkeleton class="h-14 w-full" />
    <USkeleton class="mt-3 h-4 w-36" />
    <USkeleton class="mt-4 h-3.5 w-20" />
    <USkeleton class="mt-1.5 h-4 w-40" />
  </div>
</template>
