import { ChartNoAxesColumnIncreasing, House, NotebookPen } from 'lucide-react';
import type { AppView } from '../navigation';

type BottomNavigationProps = {
  currentView: AppView;
  onSelect: (view: AppView) => void;
};

const navigationItems: Array<{
  view: AppView;
  label: string;
  Icon: typeof House;
}> = [
  { view: 'today', label: '今日', Icon: House },
  { view: 'record', label: '記録', Icon: NotebookPen },
  { view: 'trend', label: '推移', Icon: ChartNoAxesColumnIncreasing },
];

export function BottomNavigation({ currentView, onSelect }: BottomNavigationProps): JSX.Element {
  return (
    <nav className="bottom-navigation" aria-label="メインナビゲーション">
      {navigationItems.map(({ view, label, Icon }) => (
        <button
          key={view}
          className={`bottom-navigation-item ${currentView === view ? 'active' : ''}`}
          type="button"
          aria-current={currentView === view ? 'page' : undefined}
          onClick={() => onSelect(view)}
        >
          <Icon size={20} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
