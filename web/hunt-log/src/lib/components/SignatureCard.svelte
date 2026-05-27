<script lang="ts">
  import DiffBlock from './DiffBlock.svelte';

  type ProposalFile = { name: string; hunks: string; meta?: string };
  type Props = {
    plateId: string;
    files: ProposalFile[];
    notes: string[];
    timestamp?: string;
    ondecision?: (action: 'approve' | 'edit' | 'reject') => void;
  };
  let { plateId, files, notes, timestamp = '', ondecision }: Props = $props();

  let totalAdds = $derived(
    files.reduce(
      (acc, f) => acc + (f.hunks.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length),
      0
    )
  );
  let totalRems = $derived(
    files.reduce(
      (acc, f) => acc + (f.hunks.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length),
      0
    )
  );
</script>

<article class="card card-decision">
  <header class="card-head">
    <span class="plate-no decision-pulse">DECISION — {plateId}</span>
    <span class="plate-no right">{timestamp} · WAITING ON YOU</span>
  </header>

  <h1 class="card-h1 cut-h">A proposal awaits your mark.</h1>
  <p class="card-sub">
    OpenClaw will not write to your filesystem without your signature. The diff below modifies
    {files.length} {files.length === 1 ? 'file' : 'files'}. Read it. Then approve, edit, or reject.
  </p>

  <section class="proposal">
    <header class="proposal-head">
      <span class="proposal-tag">PROPOSAL</span>
      <span class="proposal-meta">{files.length} files · +{totalAdds} / −{totalRems} lines</span>
    </header>

    {#each files as f}
      <div class="proposal-file">
        <DiffBlock raw={f.hunks} fileName={f.name} meta={f.meta} />
      </div>
    {/each}

    {#if notes.length}
      <aside class="proposal-notes">
        <span class="ash mono small">AGENT NOTES</span>
        <ul>
          {#each notes as n}<li>{n}</li>{/each}
        </ul>
      </aside>
    {/if}
  </section>

  <section class="signature">
    <span class="sig-prompt">Your mark:</span>
    <button class="sig sig-approve" type="button" onclick={() => ondecision?.('approve')}>
      <span class="sig-glyph">✓</span>
      <span class="sig-label">Apply the patch</span>
      <span class="sig-key">⏎</span>
    </button>
    <button class="sig sig-edit" type="button" onclick={() => ondecision?.('edit')}>
      <span class="sig-glyph">↻</span>
      <span class="sig-label">Ask for revisions</span>
      <span class="sig-key">E</span>
    </button>
    <button class="sig sig-reject" type="button" onclick={() => ondecision?.('reject')}>
      <span class="sig-glyph">×</span>
      <span class="sig-label">Reject and abandon</span>
      <span class="sig-key">⌫</span>
    </button>
  </section>

  <footer class="card-foot decision-foot">
    <span><strong>Holding the cursor.</strong> No file will change until you sign.</span>
    <span class="ash">This decision will be recorded in the plate's audit trail.</span>
  </footer>
</article>

<style>
  .card-decision {
    max-width: 920px;
    margin: 48px auto;
    padding: 0 32px 32px;
    background: var(--obsidian);
    border: 1px solid var(--cinnabar);
  }
  .card-head {
    display: flex; justify-content: space-between;
    padding: 14px 0;
    border-bottom: 1px solid var(--cinnabar);
    font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.16em; text-transform: uppercase;
  }
  .decision-pulse {
    color: var(--cinnabar);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: 0.55; } }
  .card-h1 {
    font-family: var(--sans); font-weight: 700; font-size: 48px;
    line-height: 1.0; letter-spacing: -0.025em;
    color: var(--bone-bright); margin: 32px 0 16px;
  }
  .card-sub {
    color: var(--bone); font-size: 16px; max-width: 56ch; margin-bottom: 32px;
  }
  .proposal {
    border: 1px solid var(--steel); padding: 18px;
    margin-bottom: 28px;
  }
  .proposal-head {
    display: flex; justify-content: space-between; align-items: baseline;
    padding-bottom: 10px; border-bottom: var(--rule-fade);
    font-family: var(--mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.16em;
  }
  .proposal-tag { color: var(--cinnabar); }
  .proposal-meta { color: var(--ash); }
  .proposal-file { margin: 12px 0; }
  .proposal-notes {
    margin-top: 16px; padding: 14px; background: var(--gunmetal);
  }
  .proposal-notes ul { padding-left: 18px; margin-top: 6px; }
  .proposal-notes li { padding: 2px 0; }

  .signature {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    padding: 18px 0; border-top: var(--rule);
  }
  .sig-prompt {
    font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--ash); margin-right: 12px;
  }
  .sig {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 12px 18px; border: 1px solid var(--steel);
    background: var(--obsidian); color: var(--bone);
    font-family: var(--mono); font-size: 13px;
    cursor: pointer; transition: all 120ms var(--ease);
  }
  .sig-glyph { font-size: 16px; }
  .sig-label { letter-spacing: 0.04em; }
  .sig-key {
    margin-left: 6px; color: var(--ash); font-size: 11px;
    padding: 1px 6px; border: 1px solid var(--steel);
  }
  .sig-approve:hover { background: var(--cinnabar); color: var(--obsidian); border-color: var(--cinnabar); }
  .sig-edit:hover { border-color: var(--bone); color: var(--bone-bright); }
  .sig-reject:hover { color: var(--cinnabar-dim); border-color: var(--cinnabar-dim); }

  .card-foot {
    display: flex; justify-content: space-between;
    padding-top: 16px; border-top: var(--rule-fade);
    font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  .ash { color: var(--ash); }
  .mono { font-family: var(--mono); }
  .small { font-size: 11px; }
</style>
