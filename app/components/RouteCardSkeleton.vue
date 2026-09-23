<template>
  <!-- `RouteCard`'s own shape: the silhouette, the strip, the name line and the numbers. -->
  <div
    class="h-full rounded-xl border border-default bg-elevated px-4 pt-3.5 pb-3.5"
    aria-hidden="true"
  >
    <USkeleton class="h-14 w-full" />
    <USkeleton class="mt-1 h-1 w-full" />
    <div class="mt-3 flex justify-between gap-2">
      <USkeleton class="h-4 w-36" />
      <USkeleton class="h-4 w-16" />
    </div>
    <USkeleton class="mt-2 h-4 w-48" />
  </div>
</template>
