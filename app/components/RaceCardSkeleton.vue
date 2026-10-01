<template>
  <!-- `RaceCard`'s own row: date, silhouette, name and course, link. -->
  <li
    class="grid grid-cols-[minmax(0,1fr)_4rem] gap-4 border-b border-default py-4 sm:grid-cols-[7.5rem_7rem_minmax(0,1fr)_auto] sm:items-center"
    aria-hidden="true"
  >
    <USkeleton class="h-4 w-24" />
    <USkeleton class="h-10 w-16 sm:w-auto" />
    <div class="col-start-1 space-y-2 sm:col-start-auto">
      <USkeleton class="h-4 w-40" />
      <USkeleton class="h-3.5 w-56 max-w-full" />
    </div>
    <USkeleton class="hidden h-4 w-5 sm:block" />
  </li>
</template>
