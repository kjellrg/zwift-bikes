<template>
  <!-- `SegmentCard`'s own shape for a climb: the name, the muted line, the wedge. -->
  <div
    class="flex items-center justify-between gap-4 border-b border-default py-2.5"
    aria-hidden="true"
  >
    <div class="space-y-1.5">
      <USkeleton class="h-4 w-44" />
      <USkeleton class="h-3.5 w-52 max-w-full" />
    </div>
    <USkeleton class="h-8 w-24 shrink-0" />
  </div>
</template>
