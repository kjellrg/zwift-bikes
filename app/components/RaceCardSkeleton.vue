<template>
  <!-- Same box as `RaceCard`: name + date, two badges, a course line. -->
  <UCard
    class="h-full"
    :ui="{ body: 'space-y-3' }"
    aria-hidden="true"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="space-y-2">
        <USkeleton class="h-4 w-36" />
        <USkeleton class="h-3 w-24" />
      </div>
      <div class="flex flex-col items-end gap-1.5">
        <USkeleton class="h-5 w-16" />
        <USkeleton class="h-5 w-24" />
      </div>
    </div>
    <div class="flex gap-3">
      <USkeleton class="h-4 w-40" />
      <USkeleton class="h-4 w-16" />
    </div>
  </UCard>
</template>
