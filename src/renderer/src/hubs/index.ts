import type { ComponentType } from 'react';
import type { ConsoleId } from '@shared/types';
import { SwitchHub } from './Switch';

export interface HubProps { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }
export interface HubDef { component: ComponentType<HubProps>; /** tela "HD": sem o filtro CRT por cima */ hd: boolean }

/** Consoles que já têm o hub no estilo próprio. Os outros usam o hub provisório. */
export const HUBS: Partial<Record<ConsoleId, HubDef>> = {
  switch: { component: SwitchHub, hd: true },
  switch2: { component: SwitchHub, hd: true },
};
