import React from 'react';
import { Settings } from 'lucide-react';
import type { AppView } from '../navigation';

const viewTitles: Record<AppView, string> = {
  today: '今日',
  record: '食事を記録',
  trend: '推移',
};

type AppHeaderProps = {
  currentView: AppView;
  dateLabel: string;
  onOpenSettings: () => void;
};

export const AppHeader = React.forwardRef<HTMLButtonElement, AppHeaderProps>(function AppHeader(
  { currentView, dateLabel, onOpenSettings },
  settingsButtonRef,
): JSX.Element {
  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">Meal Logger</p>
        <h1>{viewTitles[currentView]}</h1>
      </div>
      <div className="app-header-actions">
        <div className="today-chip">{dateLabel}</div>
        <button
          ref={settingsButtonRef}
          className="icon-button settings-button"
          type="button"
          aria-label="設定を開く"
          onClick={onOpenSettings}
        >
          <Settings size={20} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
});
