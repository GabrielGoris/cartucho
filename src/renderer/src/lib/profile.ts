import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { useSettings } from './settings';

export const AVATARS: [string, string][] = [['acc', 'Cor da paleta'], ['#ff3ea5', 'Rosa'], ['#34e3ff', 'Ciano'], ['#ffb43d', 'Âmbar'], ['#b6ff5c', 'Lima'], ['#8f7bff', 'Lilás'], ['#ff6a4d', 'Coral'], ['#e8e8f0', 'Prata']];

const nice = (u: string | undefined) => (u ? u.charAt(0).toUpperCase() + u.slice(1) : '');

export function useProfile() {
  const s = useSettings();
  const trpc = useTRPC();
  const user = useQuery(trpc.system.user.queryOptions(undefined, { staleTime: Infinity }));
  const name = s.name.trim() || nice(user.data) || 'Jogador';
  return { name, initial: name.charAt(0).toUpperCase(), color: s.avatar === 'acc' ? 'var(--acc)' : s.avatar, custom: !!s.name.trim(), suggested: nice(user.data) };
}
