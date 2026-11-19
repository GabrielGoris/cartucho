const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function matchesQuery(q: string, ...fields: (string | null | undefined)[]) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = ' ' + fields.filter(Boolean).map(f => norm(f!)).join(' ') + ' ';
  const squashed = hay.replace(/ /g, '');
  return words.every(w => hay.includes(' ' + w) || hay.includes(w) || squashed.includes(w));
}

export const focusSearch = () => {
  const el = [...document.querySelectorAll<HTMLInputElement>('input[data-search]')].find(e => e.offsetParent);
  if (!el) return false;
  el.focus(); el.select();
  return true;
};
