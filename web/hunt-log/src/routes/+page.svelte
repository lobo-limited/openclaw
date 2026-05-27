<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import BriefForm from '$lib/components/BriefForm.svelte';

  function handleSubmit(submission: { brief: string; model: string; repo: string }) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/session`);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'begin', ...submission }));
    });
    ws.addEventListener('message', (e) => {
      try {
        const frame = JSON.parse(e.data);
        if (frame.type === 'session') {
          // Pass the brief to the plate route via sessionStorage,
          // then navigate. The plate page opens its own WS and resumes.
          sessionStorage.setItem('hunt-log:initial-brief', submission.brief);
          window.history.pushState({}, '', `/plate/${frame.id}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      } catch {
        // ignore non-JSON frames during this brief handoff window
      }
    });
  }

  const now = new Date().toISOString().slice(0, 16).replace('T', ' · ');
</script>

<Card plateNo="PLATE — TO BE NAMED"
      timestamp={now + ' LOCAL'}
      footerLeft="Past plates: — (this repo)"
      footerRight="No telemetry. No phone-home. Your machine, your move.">
  <BriefForm onsubmit={handleSubmit} />
</Card>
