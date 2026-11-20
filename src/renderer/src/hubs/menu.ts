import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isSelfInstall } from '@shared/consoles';
import { useTRPC } from '../trpc';
import { sfx } from '../lib/sfx';
import type { DOpt } from '../components/Discover';
import { useHubActions, type HubGame } from './data';

export function useGameMenu({ show, onInfo, onAch, onRemoved }: { show: (t: string) => void; onInfo: (g: HubGame) => void; onAch?: (g: HubGame) => void; onRemoved?: () => void }) {
  const act = useHubActions();
  const trpc = useTRPC(), qc = useQueryClient();
  const chooseExe = useMutation(trpc.games.chooseExe.mutationOptions({ onSuccess: () => void qc.invalidateQueries({ queryKey: trpc.games.pathKey() }) }));
  const openFolder = useMutation(trpc.games.openFolder.mutationOptions());

  const options = (x: HubGame, page = false): DOpt[] => {
    const inst = x.installed, self = isSelfInstall(x.console);
    const L: DOpt[] = [];
    if (inst?.missing) {
      if (x.catalog?.repo && !self) L.push({ k: 'reinstall', l: 'Instalar de novo' });
      L.push({ k: 'relink', l: 'Procurar a pasta' });
      L.push({ k: 'remove', l: 'Tirar da biblioteca' });
    } else if (inst) {
      L.push(inst.running ? { k: 'quit', l: 'Fechar o jogo' } : inst.exe ? { k: 'play', l: 'Jogar' } : { k: 'exe', l: 'Escolher o .exe' });
      if (x.update?.updateAvailable && !self) L.push({ k: 'update', l: `Atualizar para ${x.update.latest?.tag}` });
      if (inst.adapter && onAch) L.push({ k: 'ach', l: 'Conquistas' });
      L.push({ k: 'folder', l: 'Abrir pasta' });
      if (inst.exe) L.push({ k: 'exe', l: 'Trocar o .exe' });
    } else {
      if (x.repo && !self) L.push({ k: 'install', l: 'Instalar' });
      L.push({ k: 'add', l: self ? 'Já instalei: adicionar pasta' : 'Escolher pasta' });
    }
    if (x.repo) L.push({ k: 'gh', l: 'Ver no GitHub' });
    if (!page) L.push({ k: 'info', l: 'Página do jogo' });
    return L;
  };

  const run = (k: string, x: HubGame) => {
    if (k === 'play' || k === 'quit' || k === 'install') {
      const r = act.primary(x);
      sfx.play(r === 'quit' ? 'back' : 'ok');
      if (r === 'play') show(`${x.title} aberto`);
      else if (r === 'install') show(`Baixando ${x.repo}…`);
      else if (r === 'quit') show('Fechando…');
      else if (r === 'pick') chooseExe.mutate({ id: x.installed!.id });
      else if (r === 'relink') show('Escolha onde o jogo está agora');
      return;
    }
    sfx.play('ok');
    if (k === 'add') { act.addFolder(x); return show('Escolha a pasta do jogo'); }
    if (k === 'reinstall') { act.reinstall(x); return show(`Baixando ${x.repo} de novo…`); }
    if (k === 'relink') { act.relink(x); return show('Escolha onde o jogo está agora'); }
    if (k === 'remove') { act.remove(x); onRemoved?.(); return show('Jogo tirado da biblioteca · nenhum arquivo apagado'); }
    if (k === 'update') { act.update(x); return show(`Atualizando para ${x.update?.latest?.tag}…`); }
    if (k === 'ach') return onAch?.(x);
    if (k === 'folder') return openFolder.mutate({ id: x.installed!.id });
    if (k === 'exe') return chooseExe.mutate({ id: x.installed!.id });
    if (k === 'gh') return act.github(x);
    if (k === 'info') return onInfo(x);
  };

  return { options, run, error: act.error, reset: act.reset };
}
