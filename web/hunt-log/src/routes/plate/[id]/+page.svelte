<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Card from '$lib/components/Card.svelte';
  import TracePlan from '$lib/components/TracePlan.svelte';
  import TraceSpecimen from '$lib/components/TraceSpecimen.svelte';
  import TraceReply from '$lib/components/TraceReply.svelte';
  import SignatureCard from '$lib/components/SignatureCard.svelte';
  import { traces, applyToTraces, resetTraces } from '$lib/stores/traces';
  import { session, applyToSession, resetSession } from '$lib/stores/session';
  import { decision, applyToDecision, resetDecision } from '$lib/stores/decision';
  import { page } from '$app/stores';
  import { decodeFrame } from '$lib/gateway/frames';

  let ws: WebSocket | null = null;
  let backoffMs = 1000;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/api/session`);
    ws.addEventListener('open', () => {
      backoffMs = 1000;
      const initialBrief = sessionStorage.getItem('hunt-log:initial-brief');
      if (initialBrief) {
        ws!.send(JSON.stringify({
          type: 'begin',
          brief: initialBrief,
          model: 'nemotron3-nano:latest',
          repo: '~/cortejo-api'
        }));
        sessionStorage.removeItem('hunt-log:initial-brief');
      }
    });
    ws.addEventListener('message', (e) => {
      try {
        const frame = decodeFrame(e.data);
        applyToSession(frame as never);
        applyToTraces(frame as never);
        applyToDecision(frame as never);
      } catch (err) {
        console.error('bad frame', err);
      }
    });
    ws.addEventListener('close', () => {
      ws = null;
      backoffMs = Math.min(backoffMs * 2, 8000);
      setTimeout(connect, backoffMs);
    });
  }

  function handleDecision(action: 'approve' | 'edit' | 'reject') {
    ws?.send(JSON.stringify({ type: 'decision', action }));
  }

  onMount(() => {
    resetSession();
    resetTraces();
    resetDecision();
    connect();
  });

  onDestroy(() => {
    ws?.close();
  });

  let timestamp = $derived($session?.createdAt
    ? $session.createdAt.slice(0, 16).replace('T', ' · ') + ' LOCAL'
    : new Date().toISOString().slice(0, 16).replace('T', ' · ') + ' LOCAL'
  );
</script>

<Card plateNo={`PLATE ${$page.params.id ?? '?'}`}
      timestamp={timestamp}
      footerLeft={`nemotron3-nano · ${$traces.order.length} traces`}
      footerRight="Press esc to interrupt · ? for field guide">
  {#each $traces.order as id, i}
    {#if $traces.byId[id].kind === 'plan'}
      <TracePlan trace={$traces.byId[id]} num={i + 1} />
    {:else if $traces.byId[id].kind === 'specimen'}
      <TraceSpecimen trace={$traces.byId[id]} num={i + 1} />
    {:else if $traces.byId[id].kind === 'reply'}
      <TraceReply trace={$traces.byId[id]} num={i + 1} />
    {/if}
  {/each}
</Card>

{#if $decision}
  <SignatureCard
    plateId={$decision.plateId}
    files={$decision.proposal.files}
    notes={$decision.proposal.notes}
    timestamp={timestamp}
    ondecision={handleDecision}
  />
{/if}
