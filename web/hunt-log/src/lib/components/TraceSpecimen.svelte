<script lang="ts">
  import type { Trace } from '../stores/traces';

  type SpecimenData = {
    tool?: string;
    file?: string;
    meta?: string;
    preview?: string;
    startedAt?: number;
  };

  type Props = { trace: Trace; num: number };
  let { trace, num }: Props = $props();
  let data = $derived(trace.data as SpecimenData);
  let elapsed = $derived(
    data.startedAt ? `${Math.round((Date.now() - data.startedAt))}ms` : ''
  );
  let statusLabel = $derived(
    trace.status === 'streaming' ? `running · ${elapsed}` :
    trace.status === 'done' ? 'done' :
    'error'
  );
  let statusClass = $derived(trace.status === 'streaming' ? 'running' : trace.status);
</script>

<section class="trace trace-specimen">
  <header>
    <span class="trace-num">{String(num).padStart(2, '0')}</span>
    <span class="trace-kind">SPECIMEN · TOOL IN FLIGHT</span>
    <span class="tool-status {statusClass}">{statusLabel}</span>
  </header>
  <div class="specimen-body">
    {#if data.tool || data.file}
      <div class="specimen-tag">
        <span class="ash mono">{data.tool ?? ''}</span>
        {#if data.file}<strong>{data.file}</strong>{/if}
        {#if data.meta}<span class="ash mono">{data.meta}</span>{/if}
      </div>
    {/if}
    {#if data.preview}
      <pre class="specimen-preview"><span class="ash">{`// Excerpt`}</span>
{data.preview}</pre>
    {/if}
  </div>
</section>

<style>
  .trace-specimen {
    padding: 18px 22px;
    border-left: 3px solid var(--cinnabar);
    margin: 12px 0;
    background: rgba(200, 65, 42, 0.04);
  }
  .trace header { display: flex; gap: 16px; align-items: baseline; margin-bottom: 12px; }
  .trace-num, .trace-kind {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .trace-num { color: var(--ash); }
  .trace-kind { color: var(--bone); }
  .tool-status {
    font-family: var(--mono); font-size: 11px;
    padding: 2px 8px; border: 1px solid var(--steel);
  }
  .tool-status.running { color: var(--cinnabar); border-color: var(--cinnabar); }
  .tool-status.done { color: var(--ash); }
  .tool-status.error { color: var(--cinnabar-dim); border-color: var(--cinnabar-dim); }
  .specimen-tag {
    display: flex; gap: 10px; align-items: baseline;
    font-family: var(--mono); font-size: 12px;
    padding: 6px 0;
  }
  .specimen-tag strong { color: var(--bone-bright); font-weight: 600; }
  .specimen-preview {
    margin-top: 8px;
    padding: 12px 14px;
    background: var(--obsidian);
    border: 1px solid var(--steel);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--bone);
    overflow-x: auto;
    white-space: pre;
  }
  .ash { color: var(--ash); }
  .mono { font-family: var(--mono); }
</style>
