<script setup>
useHead({
  meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
  link: [{ rel: "icon", href: "/favicon.ico" }],
  htmlAttrs: {
    lang: "en",
  },
});

const title = "Zwift Best Bike";
const description =
  "Find the best bike and wheel combination for any Zwift route, based on distance, elevation and surface.";

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: "summary_large_image",
});
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink to="/">
          <AppLogo />
        </NuxtLink>
      </template>

      <template #right>
        <div class="hidden items-center gap-1.5 lg:flex">
          <UButton
            to="/profile"
            icon="i-lucide-user"
            label="My Profile"
            color="neutral"
            variant="ghost"
          />

          <UButton
            to="/garage"
            icon="i-lucide-warehouse"
            label="My Garage"
            color="neutral"
            variant="ghost"
          />

          <UButton
            to="https://github.com/andipaetzold/zwift-data"
            target="_blank"
            icon="i-lucide-database"
            label="zwift-data"
            aria-label="zwift-data on GitHub"
            color="neutral"
            variant="ghost"
          />

          <UButton
            to="https://github.com/kjellrg/zwift-bikes"
            target="_blank"
            icon="i-simple-icons-github"
            aria-label="zwift-bikes on GitHub"
            color="neutral"
            variant="ghost"
          />
        </div>

        <UColorModeButton />
      </template>

      <template #body>
        <div class="flex flex-col gap-1.5">
          <UButton
            to="/profile"
            icon="i-lucide-user"
            label="My Profile"
            color="neutral"
            variant="ghost"
            block
          />

          <UButton
            to="/garage"
            icon="i-lucide-warehouse"
            label="My Garage"
            color="neutral"
            variant="ghost"
            block
          />

          <UButton
            to="https://github.com/andipaetzold/zwift-data"
            target="_blank"
            icon="i-lucide-database"
            label="zwift-data"
            aria-label="zwift-data on GitHub"
            color="neutral"
            variant="ghost"
            block
          />

          <UButton
            to="https://github.com/kjellrg/zwift-bikes"
            target="_blank"
            icon="i-simple-icons-github"
            label="zwift-bikes on GitHub"
            aria-label="zwift-bikes on GitHub"
            color="neutral"
            variant="ghost"
            block
          />
        </div>
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>

    <USeparator icon="i-lucide-bike" />

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Route &amp; equipment catalog data from
          <ULink
            to="https://www.npmjs.com/package/zwift-data"
            target="_blank"
            class="underline"
            >zwift-data</ULink
          >. Bike frame and wheelset aero/climb ratings use real bot speed-test
          data from
          <ULink
            to="https://zwiftinsider.com/charts-wheels/"
            target="_blank"
            class="underline"
            >ZwiftInsider</ULink
          >
          where available (look for the "verified" badge) - otherwise, and for
          route surface, these are heuristic estimates, not official Zwift data.
        </p>
      </template>

      <template #right>
        <p class="text-sm text-muted">
          Unofficial fan project • not affiliated with Zwift
        </p>
      </template>
    </UFooter>
  </UApp>
</template>
