<template>
  <!-- `RouteCard`'s own shape: the silhouette, the strip, the name, then the world line and the numbers. -->
  <div
    class="h-full rounded-xl border border-default bg-elevated px-4 pt-3.5 pb-3.5"
    aria-hidden="true"
  >
    <USkeleton class="h-14 w-full" />
    <USkeleton class="mt-1 h-1 w-full" />
    <USkeleton class="mt-3 h-4 w-36" />
    <USkeleton class="mt-3 h-3.5 w-28" />
    <USkeleton class="mt-1.5 h-3.5 w-44" />
  </div>
</template>
