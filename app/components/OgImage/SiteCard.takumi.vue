<script setup lang="ts">
// Brand social-share card for the home and about pages (issue #59): same
// build-time Takumi constraints as RouteCard - flexbox-only CSS, Inter
// 400/700. No props: one card, one message, everywhere the site itself
// (rather than a specific route or race) is what's being shared.
</script>

<template>
  <div
    class="flex h-full w-full flex-col justify-between"
    style="background: linear-gradient(160deg, #0D1C19 0%, #071412 100%); padding: 56px 64px;"
  >
    <div
      class="flex items-center"
      style="gap: 16px;"
    >
      <div style="width: 14px; height: 34px; background: #C6F135; border-radius: 4px;" />
      <span style="font-size: 34px; font-weight: 700; color: #ffffff;">ZwiftBikes</span>
    </div>

    <div
      class="flex flex-col"
      style="gap: 18px;"
    >
      <span style="font-size: 64px; font-weight: 700; color: #ffffff; line-height: 1.1;">Find the fastest bike for any Zwift route</span>
      <span style="font-size: 30px; color: #8FA79F; line-height: 1.4;">Every frame and wheel combo in the game, ranked by predicted finish time for your weight, height and power.</span>
    </div>

    <span style="font-size: 26px; font-weight: 700; color: #C6F135;">zwiftbikes.com</span>
  </div>
</template>
