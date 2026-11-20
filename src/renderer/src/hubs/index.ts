import type { ComponentType } from 'react';
import type { ConsoleId } from '@shared/types';
import { SwitchHub } from './Switch';
import { PS5Hub } from './PS5';
import { PS4Hub } from './PS4';
import { PS3Hub } from './PS3';
import { X360Hub } from './X360';
import { WiiHub } from './Wii';
import { RetroHub } from './Retro';
import { PCHub } from './PC';

export interface HubProps { id: ConsoleId; game?: string; tab?: 'lib' | 'cat'; onBack: () => void }
export interface HubDef { component: ComponentType<HubProps>; hd: boolean }

export const HUBS: Partial<Record<ConsoleId, HubDef>> = {
  switch: { component: SwitchHub, hd: true },
  switch2: { component: SwitchHub, hd: true },
  ps5: { component: PS5Hub, hd: true },
  ps4: { component: PS4Hub, hd: true },
  ps3: { component: PS3Hub, hd: true },
  psp: { component: PS3Hub, hd: true },
  x360: { component: X360Hub, hd: true },
  wii: { component: WiiHub, hd: true },
  snes: { component: RetroHub, hd: true },
  n64: { component: RetroHub, hd: true },
  ps1: { component: RetroHub, hd: true },
  gc: { component: RetroHub, hd: true },
  ps2: { component: RetroHub, hd: true },
  nes: { component: RetroHub, hd: true },
  megadrive: { component: RetroHub, hd: true },
  gb: { component: RetroHub, hd: true },
  nds: { component: RetroHub, hd: true },
  xbox: { component: X360Hub, hd: true },
  pc: { component: PCHub, hd: true },
  other: { component: RetroHub, hd: true },
};
