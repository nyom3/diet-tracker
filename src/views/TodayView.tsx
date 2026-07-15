import type React from 'react';

type TodayViewProps = {
  children: React.ReactNode;
};

export function TodayView({ children }: TodayViewProps): JSX.Element {
  return (
    <main id="today-view" className="app-view today-view" tabIndex={-1}>
      {children}
    </main>
  );
}
