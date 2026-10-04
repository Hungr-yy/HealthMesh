import { createContext, useCallback, useContext, useState, type ReactNode, type Ref } from 'react';

export type IconName =
  | 'check'
  | 'clock'
  | 'radio'
  | 'clinic'
  | 'mail'
  | 'user'
  | 'warning'
  | 'lock'
  | 'globe'
  | 'back'
  | 'info'
  | 'help'
  | 'send'
  | 'search'
  | 'flag'
  | 'mic'
  | 'stop';

const PATHS: Record<IconName, string> = {
  check: 'M5 12.5l4.2 4.2L19 7',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  radio: 'M4 9h16v10H4zM7 9l9-5M8 14h4M16 14h.01',
  clinic: 'M4 20V8l8-4 8 4v12M10 20v-6h4v6M12 8v3M10.5 9.5h3',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  warning: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 118 0v3',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  back: 'M15 5l-7 7 7 7',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5h.01',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 115 0c0 1.7-2.5 2-2.5 4M12 17h.01',
  send: 'M3 12l18-8-6 16-3-7-9-1z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l5 5',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3M9 21h6',
  stop: 'M6 6h12v12H6z',
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'link';
  disabled?: boolean;
  inline?: boolean;
  type?: 'button' | 'submit';
  'aria-pressed'?: boolean;
  'data-testid'?: string;
  lang?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  children,
  onClick,
  icon,
  variant = 'primary',
  disabled,
  inline,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    variant === 'secondary' ? 'secondary' : '',
    variant === 'link' ? 'link' : '',
    inline ? 'inline' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className={`field${error ? ' error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <div className="hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
      {children}
      {error ? (
        <div className="error-text" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ screen-reader announcements
const AnnounceCtx = createContext<(msg: string) => void>(() => {});
export function useAnnounce() {
  return useContext(AnnounceCtx);
}
export function AnnounceProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const announce = useCallback((m: string) => {
    // toggle trailing space so identical messages are re-announced
    setMsg((prev) => (prev === m ? `${m}\u00a0` : m));
  }, []);
  return (
    <AnnounceCtx.Provider value={announce}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="announcer"
      >
        {msg}
      </div>
    </AnnounceCtx.Provider>
  );
}
