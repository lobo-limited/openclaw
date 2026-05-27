<script lang="ts">
  import type { Trace } from '../stores/traces';

  type PlanData = {
    steps?: Array<{ index?: string; text?: string }>;
    files?: Array<{ path?: string; lines?: number }>;
  };

  type Props = { trace: Trace; num: number };
  let { trace, num }: Props = $props();
  let data = $derived(trace.data as PlanData);
</script>

<section class="trace trace-plan">
  <header>
    <span class="trace-num">{String(num).padStart(2, '0')}</span>
    <span class="trace-kind">PLAN · OPENCLAW</span>
    {#if data.steps && data.files}
      <span class="ash mono">{data.steps.length} steps · {data.files.length} files in scope</span>
    {/if}
  </header>
  {#if data.steps && data.steps.length}
    <ol class="plan-steps">
      {#each data.steps as step, i}
        <li><span class="step-no">{String(i + 1).padStart(2, '0')}</span> {step.text}</li>
      {/each}
    </ol>
  {/if}
  {#if data.files && data.files.length}
    <div class="plan-files">
      <span class="ash mono small">Files in scope:</span>
      <ul>
        {#each data.files as f}
          <li><code>{f.path}</code> <span class="ash">{f.lines} lines</span></li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .trace { padding: 24px 0; border-top: var(--rule-fade); }
  .trace header { display: flex; gap: 16px; align-items: baseline; margin-bottom: 12px; }
  .trace-num {
    font-family: var(--mono); font-size: 11px; color: var(--ash);
    letter-spacing: 0.16em;
  }
  .trace-kind {
    font-family: var(--mono); font-size: 11px; color: var(--bone);
    letter-spacing: 0.16em; text-transform: uppercase;
  }
  .trace-plan {
    background: var(--gunmetal);
    padding: 18px 22px;
    border: 1px solid var(--steel);
    margin: 12px 0;
  }
  .plan-steps { list-style: none; padding-left: 0; margin: 12px 0; }
  .plan-steps li {
    font-family: var(--body); font-size: 15px; color: var(--bone);
    padding: 6px 0;
  }
  .step-no {
    font-family: var(--mono); font-size: 11px; color: var(--cinnabar);
    margin-right: 10px;
  }
  .plan-files { margin-top: 16px; }
  .plan-files ul { list-style: none; padding-left: 0; }
  .plan-files li {
    font-family: var(--mono); font-size: 12px; padding: 2px 0;
  }
  .ash { color: var(--ash); }
  .mono { font-family: var(--mono); }
  .small { font-size: 11px; }
  code { font-family: var(--mono); color: var(--bone-bright); }
</style>
