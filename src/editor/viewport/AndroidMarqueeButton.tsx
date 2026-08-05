import './android-marquee-button.css';

interface AndroidMarqueeButtonProps {
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}

export function AndroidMarqueeButton({ active, disabled, onToggle }: AndroidMarqueeButtonProps) {
  return (
    <button
      type="button"
      data-android-marquee-button="true"
      className={`android-marquee-button${active ? ' active' : ''}`}
      aria-label="Bereich auswählen"
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="3.5" y="4.5" width="17" height="13" rx="1.5" />
        <path d="M8 20.5h8" />
      </svg>
      <span>Bereich</span>
    </button>
  );
}
