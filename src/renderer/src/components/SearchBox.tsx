import { forwardRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onDone?: () => void;
  className?: string;
  nav?: boolean;
}

export const SearchBox = forwardRef<HTMLInputElement, Props>(({ value, onChange, placeholder, onDone, className = 'search', nav = true }, ref) => (
  <input ref={ref} className={className} data-search data-hf={nav ? true : undefined} placeholder={placeholder} value={value} spellCheck={false}
    onClick={e => e.currentTarget.focus()}
    onChange={e => onChange(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); onDone?.(); }
    }} />
));
SearchBox.displayName = 'SearchBox';
