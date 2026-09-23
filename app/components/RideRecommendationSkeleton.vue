<template>
  <!-- The Recommendation's own shape while the first ranking loads: the
       label, the frame, the wheels, the big time, the evidence and the two
       buttons, so the answer lands where the skeleton was. -->
  <div
    class="space-y-3"
    aria-hidden="true"
  >
    <USkeleton class="h-4 w-44" />
    <USkeleton class="h-3.5 w-64" />
    <USkeleton class="mt-4 h-9 w-4/5" />
    <USkeleton class="h-5 w-3/5" />
    <USkeleton class="mt-5 h-20 w-64" />
    <div class="flex flex-wrap gap-4 pt-2">
      <USkeleton class="h-4 w-44" />
      <USkeleton class="h-4 w-52" />
    </div>
    <div class="flex gap-2.5 pt-3">
      <USkeleton class="h-10 w-40 rounded-md" />
      <USkeleton class="h-10 w-32 rounded-md" />
    </div>
  </div>
</template>
