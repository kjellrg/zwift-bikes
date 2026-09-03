<template>
  <!-- Same box as `RouteCard`: title + world, two stat chips, a badge row. -->
  <UCard
    class="h-full"
    :ui="{ body: 'space-y-3' }"
    aria-hidden="true"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="space-y-2">
        <USkeleton class="h-4 w-40" />
        <USkeleton class="h-3 w-24" />
      </div>
      <USkeleton class="h-5 w-16" />
    </div>
    <div class="flex gap-4">
      <USkeleton class="h-4 w-16" />
      <USkeleton class="h-4 w-16" />
    </div>
    <USkeleton class="h-5 w-28" />
  </UCard>
</template>
