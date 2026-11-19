/** Imagens em boa resolução (LaunchBox) de um jogo; vazio enquanto não chegam. */
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';

export function useArt(console: string | null | undefined, title: string, platformName?: string | null) {
  const trpc = useTRPC();
  const q = useQuery(trpc.art.get.queryOptions({ console: console ?? 'other', platformName, title }, { enabled: !!console, staleTime: Infinity }));
  return q.data ?? {};
}
