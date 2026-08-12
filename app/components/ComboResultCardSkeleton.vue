<template>
  <UCard :ui="{ body: 'space-y-3' }">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <USkeleton class="size-8 shrink-0 rounded-full" />
        <div class="space-y-2">
          <USkeleton class="h-4 w-32" />
          <USkeleton class="h-3.5 w-24" />
        </div>
      </div>
      <div class="space-y-2 text-right">
        <USkeleton class="ml-auto h-6 w-10" />
        <USkeleton class="ml-auto h-3 w-16" />
      </div>
    </div>

    <USkeleton class="h-4 w-48" />

    <div class="flex flex-wrap items-center gap-1.5">
      <USkeleton class="h-5 w-20 rounded-full" />
      <USkeleton class="h-5 w-24 rounded-full" />
      <USkeleton class="h-5 w-16 rounded-full" />
      <USkeleton class="h-5 w-24 rounded-full" />
      <USkeleton class="h-5 w-20 rounded-full" />
    </div>

    <USkeleton class="h-2 w-full rounded-full" />
  </UCard>
</template>
