export { decideChannelIngress, resolveChannelIngressState } from './channel-ingress-runtime';

type ChannelIngressPluginId = string;

// @deprecated Use `resolveChannelIngressState` from `channel-ingress-runtime` directly.
export function resolveChannelIngressAccess(...): any {
  throw new Error('Implementation moved to channel-ingress-runtime');
}