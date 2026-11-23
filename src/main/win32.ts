import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Rect = [number, number, number, number];
export interface Win { hwnd: number; pid: number; path: string; r: Rect; m: Rect }
export interface Mon { m: Rect; w: Rect }

const CS = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CartuchoWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int f, StringBuilder s, ref int n);

  public static void Init() { try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { } }

  static string R(RECT r) { return "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"; }
  static string Q(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
  static MONITORINFO Mon(IntPtr h) { var i = new MONITORINFO(); i.cbSize = Marshal.SizeOf(typeof(MONITORINFO)); GetMonitorInfo(MonitorFromWindow(h, 2), ref i); return i; }
  static string PathOf(uint pid) {
    IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return "";
    try { var sb = new StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(p, 0, sb, ref n) ? sb.ToString() : ""; } finally { CloseHandle(p); }
  }
  static string One(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid); RECT r; GetWindowRect(h, out r); var m = Mon(h);
    return "{\"hwnd\":" + h.ToInt64() + ",\"pid\":" + pid + ",\"path\":" + Q(PathOf(pid)) + ",\"r\":" + R(r) + ",\"m\":" + R(m.rcMonitor) + "}";
  }

  public static string Run(string line) {
    string[] a = line.Split(' ');
    switch (a[0]) {
      case "fg": { IntPtr h = GetForegroundWindow(); return h == IntPtr.Zero ? "null" : One(h); }
      case "wins": {
        var list = new List<string>();
        EnumWindows((h, l) => {
          if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
          RECT r; GetWindowRect(h, out r);
          if (r.R - r.L < 320 || r.B - r.T < 200) return true;
          list.Add(One(h)); return true;
        }, IntPtr.Zero);
        return "[" + string.Join(",", list) + "]";
      }
      case "mon": { var m = Mon(new IntPtr(long.Parse(a[1]))); return "{\"m\":" + R(m.rcMonitor) + ",\"w\":" + R(m.rcWork) + "}"; }
      case "place": {
        IntPtr h = new IntPtr(long.Parse(a[1])); int l = int.Parse(a[2]), t = int.Parse(a[3]), rr = int.Parse(a[4]), b = int.Parse(a[5]);
        if (IsIconic(h)) ShowWindow(h, 9);
        return SetWindowPos(h, IntPtr.Zero, l, t, rr - l, b - t, 0x0004 | 0x0010 | 0x4000) ? "true" : "false";
      }
      case "front": {
        IntPtr h = new IntPtr(long.Parse(a[1]));
        if (IsIconic(h)) ShowWindow(h, 9);
        return SetForegroundWindow(h) ? "true" : "false";
      }
    }
    return "null";
  }
}
`;

const PS = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CS}
'@
[CartuchoWin]::Init()
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($l -eq $null) { break }
  $i = $l.IndexOf(' ')
  $id = $l.Substring(0, $i)
  try { $r = [CartuchoWin]::Run($l.Substring($i + 1)) } catch { $r = 'null' }
  [Console]::Out.WriteLine($id + ' ' + $r)
  [Console]::Out.Flush()
}
`;

export class Win32 {
  private ps: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private wait = new Map<number, (v: unknown) => void>();
  private buf = '';
  private dead = 0;

  constructor(private dir: string) {}

  private start() {
    if (process.platform !== 'win32') return null;
    if (this.ps) return this.ps;
    if (this.dead >= 3) return null;
    const file = join(this.dir, 'cartucho-win.ps1');
    try { writeFileSync(file, '﻿' + PS, 'utf8'); } catch { return null; }
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (d: string) => {
      this.buf += d;
      for (let i; (i = this.buf.indexOf('\n')) >= 0;) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        const sp = line.indexOf(' '); if (sp < 0) continue;
        const f = this.wait.get(Number(line.slice(0, sp))); if (!f) continue;
        this.wait.delete(Number(line.slice(0, sp)));
        try { f(JSON.parse(line.slice(sp + 1))); } catch { f(null); }
      }
    });
    ps.stderr.resume();
    const gone = () => { if (this.ps === ps) { this.ps = null; this.dead++; } for (const f of this.wait.values()) f(null); this.wait.clear(); };
    ps.on('exit', gone);
    ps.on('error', gone);
    this.ps = ps;
    return ps;
  }

  private ask<T>(cmd: string, timeout = 8000): Promise<T | null> {
    const ps = this.start();
    if (!ps) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise(ok => {
      const t = setTimeout(() => { this.wait.delete(id); ok(null); }, timeout);
      this.wait.set(id, v => { clearTimeout(t); ok(v as T); });
      ps.stdin.write(`${id} ${cmd}\n`);
    });
  }

  warm() { void this.ask('fg', 20_000); }
  foreground() { return this.ask<Win>('fg'); }
  windows() { return this.ask<Win[]>('wins'); }
  monitor(hwnd: number) { return this.ask<Mon>(`mon ${Math.trunc(hwnd)}`); }
  place(hwnd: number, r: Rect) { return this.ask<boolean>(`place ${Math.trunc(hwnd)} ${r.map(Math.round).join(' ')}`); }
  front(hwnd: number) { return this.ask<boolean>(`front ${Math.trunc(hwnd)}`); }
  stop() { this.ps?.kill(); this.ps = null; }
}

const same = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]!) <= 2);

export function moveTo(w: Pick<Win, 'r' | 'm'>, target: Mon): Rect | null {
  if (same(w.m, target.m)) return null;
  if (same(w.r, w.m)) return [...target.m];
  const W = target.w[2] - target.w[0], H = target.w[3] - target.w[1];
  const ww = Math.min(w.r[2] - w.r[0], W), hh = Math.min(w.r[3] - w.r[1], H);
  const x = target.w[0] + Math.round((W - ww) / 2), y = target.w[1] + Math.round((H - hh) / 2);
  return [x, y, x + ww, y + hh];
}

export function ownedBy(w: Pick<Win, 'pid' | 'path'>, pids: Set<number>, dirs: string[]) {
  if (pids.has(w.pid)) return true;
  const k = (x: string) => x.replace(/[\\/]+/g, '/').toLowerCase().replace(/\/$/, '');
  const p = k(w.path);
  return !!p && dirs.filter(Boolean).some(d => p.startsWith(k(d) + '/'));
}
