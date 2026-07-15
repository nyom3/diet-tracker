import type React from 'react';

type RecordViewProps = {
  children: React.ReactNode;
};

export function RecordView({ children }: RecordViewProps): JSX.Element {
  return (
    <main id="record-view" className="app-view record-view" tabIndex={-1}>
      {children}
    </main>
  );
}
