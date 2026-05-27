<script lang="ts">
  type Props = {
    plateNo?: string;
    timestamp?: string;
    footerLeft?: string;
    footerRight?: string;
    children?: import('svelte').Snippet;
  };
  let {
    plateNo = 'PLATE — TO BE NAMED',
    timestamp = '',
    footerLeft = '',
    footerRight = '',
    children
  }: Props = $props();
</script>

<article class="card">
  <header class="card-head">
    <span class="plate-no">{plateNo}</span>
    <span class="plate-no right">{timestamp}</span>
  </header>
  {#if children}{@render children()}{/if}
  <footer class="card-foot">
    <span>{footerLeft}</span>
    <span class="ash">{footerRight}</span>
  </footer>
</article>

<style>
  .card {
    max-width: 920px;
    margin: 48px auto;
    padding: 0 32px 32px;
    background: var(--obsidian);
    color: var(--bone);
    border: 1px solid var(--steel);
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    padding: 14px 0;
    border-bottom: 1px solid var(--steel);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--cinnabar);
  }
  .plate-no.right { color: var(--ash); }
  .card-foot {
    display: flex;
    justify-content: space-between;
    margin-top: 36px;
    padding-top: 16px;
    border-top: var(--rule-fade);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bone);
  }
  .ash { color: var(--ash); }
</style>
