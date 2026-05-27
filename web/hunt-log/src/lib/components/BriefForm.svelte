<script lang="ts">
  type Submit = { brief: string; model: string; repo: string };
  type Props = {
    initialBrief?: string;
    model?: string;
    repo?: string;
    mcpReady?: number;
    onsubmit?: (e: Submit) => void;
  };
  let {
    initialBrief = '',
    model = 'nemotron3-nano:latest',
    repo = '~/cortejo-api',
    mcpReady = 12,
    onsubmit
  }: Props = $props();

  let brief = $state(initialBrief);

  function handleInput(e: Event) {
    brief = (e.currentTarget as HTMLDivElement).innerText;
  }

  function handleSubmit() {
    if (!brief.trim()) return;
    onsubmit?.({ brief: brief.trim(), model, repo });
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<h1 class="card-h1">A new hunt.</h1>
<p class="card-sub">
  Describe the work. OpenClaw will form a plan before it touches a file. You
  will see the plan, then the diff, then the result — in that order.
</p>

<form class="brief" aria-label="Session brief" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
  <label class="field-label" for="brief-input">BRIEF</label>
  <div
    id="brief-input"
    class="brief-input"
    contenteditable="true"
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    spellcheck="false"
    oninput={handleInput}
    onkeydown={handleKey}
  >{brief}</div>

  <div class="field-row">
    <div class="field-cell">
      <span class="field-label">MODEL</span>
      <span class="field-value">{model} <span class="ash">·</span> local</span>
    </div>
    <div class="field-cell">
      <span class="field-label">REPO</span>
      <span class="field-value">{repo} <span class="ash">·</span> master · clean</span>
    </div>
    <div class="field-cell">
      <span class="field-label">MCP</span>
      <span class="field-value">{mcpReady} ready</span>
    </div>
    <div class="field-cell">
      <span class="field-label">APPROVALS</span>
      <span class="field-value">writes require my mark</span>
    </div>
  </div>

  <div class="brief-cta">
    <button type="submit" class="primary">Begin the hunt</button>
    <span class="ash mono">⌘⏎</span>
  </div>
</form>

<style>
  .card-h1 {
    font-family: var(--sans);
    font-weight: 700;
    font-size: 56px;
    line-height: 1.0;
    letter-spacing: -0.025em;
    color: var(--bone-bright);
    margin: 32px 0 16px;
  }
  .card-sub {
    color: var(--bone);
    font-size: 16px;
    max-width: 56ch;
    margin-bottom: 32px;
  }
  .brief { display: flex; flex-direction: column; gap: 18px; }
  .field-label {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ash);
  }
  .brief-input {
    min-height: 64px;
    border: 1px solid var(--steel);
    padding: 14px 16px;
    font-family: var(--body);
    font-size: 17px;
    line-height: 1.45;
    color: var(--bone-bright);
    background: var(--gunmetal);
    outline: none;
  }
  .brief-input:focus { border-color: var(--cinnabar); }
  .field-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
    padding-top: 8px;
    border-top: var(--rule-fade);
  }
  .field-cell { display: flex; flex-direction: column; gap: 4px; }
  .field-value {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--bone);
  }
  .ash { color: var(--ash); }
  .brief-cta {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  }
  .primary {
    font-family: var(--mono);
    font-size: 13px;
    letter-spacing: 0.04em;
    background: var(--cinnabar);
    color: var(--obsidian);
    border: 1px solid var(--cinnabar);
    padding: 12px 20px;
    cursor: pointer;
    transition: background 120ms var(--ease);
  }
  .primary:hover { background: var(--cinnabar-dim); color: var(--bone-bright); }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .mono { font-family: var(--mono); }
</style>
