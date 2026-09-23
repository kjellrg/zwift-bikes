<template>
  <!-- `SegmentCard`'s own shape: the name line and the three numbers. -->
  <div
    class="h-full rounded-xl border border-default bg-elevated px-4 py-3.5"
    aria-hidden="true"
  >
    <div class="flex justify-between gap-2">
      <USkeleton class="h-4 w-36" />
      <USkeleton class="h-4 w-14" />
    </div>
    <USkeleton class="mt-2 h-4 w-40" />
  </div>
</template>
