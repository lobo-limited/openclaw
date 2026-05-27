<script lang="ts">
  import { parseUnifiedDiff } from '../diff/parse';

  type Props = { raw: string; fileName?: string; meta?: string };
  let { raw, fileName, meta }: Props = $props();

  let hunks = $derived(parseUnifiedDiff(raw));
</script>

<div class="diff-file">
  {#if fileName}
    <header class="file-head">
      <span class="file-name">{fileName}</span>
      {#if meta}<span class="file-meta">{meta}</span>{/if}
    </header>
  {/if}
  <pre class="diff">
    {#each hunks as hunk}
      {#if hunk.header}<span class="hunk">{hunk.header}</span>{'\n'}{/if}
      {#each hunk.lines as line}
        {#if line.kind === 'add'}<span class="add">+{line.text}</span>{'\n'}
        {:else if line.kind === 'remove'}<span class="rem">-{line.text}</span>{'\n'}
        {:else}<span> {line.text}</span>{'\n'}{/if}
      {/each}
    {/each}
  </pre>
</div>

<style>
  .diff-file {
    border: 1px solid var(--steel);
    margin: 12px 0;
  }
  .file-head {
    display: flex;
    justify-content: space-between;
    padding: 8px 14px;
    background: var(--gunmetal);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--bone);
  }
  .file-meta { color: var(--ash); }
  pre.diff {
    margin: 0;
    padding: 14px;
    background: var(--obsidian);
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.55;
    overflow-x: auto;
    color: var(--bone);
    white-space: pre;
  }
  .hunk { color: var(--ash); }
  .add { color: var(--bone-bright); background: rgba(200, 65, 42, 0.08); display: inline-block; width: 100%; }
  .rem { color: var(--ash); text-decoration: line-through; display: inline-block; width: 100%; }
</style>
