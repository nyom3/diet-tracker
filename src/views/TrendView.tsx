import type React from 'react';

type TrendViewProps = {
  children: React.ReactNode;
};

export function TrendView({ children }: TrendViewProps): JSX.Element {
  return (
    <main id="trend-view" className="app-view trend-view" tabIndex={-1}>
      {children}
    </main>
  );
}
