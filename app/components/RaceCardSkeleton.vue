<template>
  <!-- `RaceCard`'s own row: date, silhouette, name and course, link. -->
  <li
    class="-mx-3 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 border-b border-default px-3 py-4 sm:grid-cols-[5.5rem_7rem_minmax(0,1fr)_auto] sm:items-center"
    aria-hidden="true"
  >
    <USkeleton class="h-4 w-16" />
    <USkeleton class="hidden h-10 sm:block" />
    <div class="space-y-2">
      <USkeleton class="h-4 w-40" />
      <USkeleton class="h-3.5 w-56 max-w-full" />
    </div>
    <USkeleton class="col-start-2 h-4 w-28 sm:col-start-auto" />
  </li>
</template>
