import React from 'react';
import { X } from 'lucide-react';

type SettingsSheetProps = {
  children: React.ReactNode;
  onClose: () => void;
};

export function SettingsSheet({ children, onClose }: SettingsSheetProps): JSX.Element {
  const sheetRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key === 'Tab' && sheetRef.current) {
        const focusableElements = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ));
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (!firstElement || !lastElement) return;
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="settings-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={sheetRef}
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-sheet-title"
      >
        <header className="settings-sheet-header">
          <div>
            <p className="eyebrow">Meal Logger</p>
            <h2 id="settings-sheet-title">設定</h2>
          </div>
          <button className="icon-button" type="button" aria-label="設定を閉じる" autoFocus onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="settings-sheet-content">{children}</div>
      </section>
    </div>
  );
}
