<script lang="ts">
  import type { Trace } from '../stores/traces';

  type ReplyData = { text?: string; tokenRate?: number };

  type Props = { trace: Trace; num: number };
  let { trace, num }: Props = $props();
  let data = $derived(trace.data as ReplyData);
  let statusLine = $derived(
    trace.status === 'streaming' ? `streaming${data.tokenRate ? ` · ${data.tokenRate} tok/s` : ''}` :
    trace.status === 'done' ? 'done' :
    'error'
  );
</script>

<section class="trace trace-reply">
  <header>
    <span class="trace-num">{String(num).padStart(2, '0')}</span>
    <span class="trace-kind">REPLY · OPENCLAW</span>
    <span class="ash mono">{statusLine}</span>
  </header>
  <div class="reply-body">
    {#if data.text}<p>{data.text}</p>{/if}
    {#if trace.status === 'streaming'}<span class="cursor"></span>{/if}
  </div>
</section>

<style>
  .trace-reply { padding: 18px 22px; margin: 12px 0; }
  .trace header { display: flex; gap: 16px; align-items: baseline; margin-bottom: 12px; }
  .trace-num, .trace-kind {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .trace-num { color: var(--ash); }
  .trace-kind { color: var(--bone); }
  .reply-body {
    font-family: var(--body); font-size: 16px; line-height: 1.55;
    color: var(--bone-bright);
  }
  .reply-body p { white-space: pre-wrap; }
  .cursor {
    display: inline-block; width: 8px; height: 1em;
    background: var(--cinnabar); vertical-align: text-bottom;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  .ash { color: var(--ash); }
  .mono { font-family: var(--mono); }
</style>
