<script lang="ts">
  type Props = { env?: string };
  let { env = 'supercat · ARM · 128GB · nemotron3-nano' }: Props = $props();
</script>

<header class="topbar">
  <div class="brand">
    <svg class="mark" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M3 4 C 5 10, 9 15, 17 18 L 19 14 C 14 13, 10 10, 7 5 Z" fill="#C8412A"/>
      <path d="M17 18 L 19 21" stroke="#C8412A" stroke-width="1.5" stroke-linecap="square"/>
    </svg>
    <span class="wordmark">open<em>claw</em></span>
    <span class="bird">/  hunt log  /  v0</span>
  </div>
  <span class="env">{env}</span>
</header>

<style>
  .topbar {
    border-bottom: var(--rule);
    padding: 18px 32px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 32px;
    align-items: center;
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ash);
    background: var(--obsidian);
    position: sticky; top: 0; z-index: 10;
  }
  .brand { display: flex; align-items: baseline; gap: 10px; color: var(--bone); }
  .brand .mark { width: 22px; height: 22px; position: relative; top: 5px; }
  .brand .wordmark {
    font-family: var(--sans); font-weight: 700; font-size: 17px;
    letter-spacing: -0.01em; text-transform: none; color: var(--bone);
  }
  .brand .wordmark em { color: var(--cinnabar); font-style: normal; }
  .bird { color: var(--ash); }
  .env { justify-self: end; }
</style>
