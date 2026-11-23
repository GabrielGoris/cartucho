import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { askConfirm } from './dialogs';
import { tt } from '@shared/i18n';

/** For when a game is being removed: asks whether to delete its Wine prefix too. No question when it has none. */
export function useAskDeletePrefix() {
  const trpc = useTRPC(), qc = useQueryClient();
  return async (id: string, title: string) => {
    if (!navigator.userAgent.includes('Linux')) return false;
    const { hasPrefix } = await qc.fetchQuery(trpc.wine.config.queryOptions({ id }, { staleTime: 0 }));
    return hasPrefix && askConfirm({ title: tt('Apagar também o prefixo do Wine de {0}? Ele guarda os saves e as configurações que o jogo fez dentro do Wine.', { 0: title }), ok: tt('Apagar o prefixo'), cancel: tt('Manter'), danger: true });
  };
}
