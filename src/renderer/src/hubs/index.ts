import type { ComponentType } from 'react';
import type { ConsoleId } from '@shared/types';
import { SwitchHub } from './Switch';
import { PS5Hub } from './PS5';

export interface HubProps { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }
export interface HubDef { component: ComponentType<HubProps>; hd: boolean }

export const HUBS: Partial<Record<ConsoleId, HubDef>> = {
  switch: { component: SwitchHub, hd: true },
  switch2: { component: SwitchHub, hd: true },
  ps5: { component: PS5Hub, hd: true },
};
