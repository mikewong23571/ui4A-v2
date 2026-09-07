'use client';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

const InteractionContext = createContext<(() => () => void) | undefined>(undefined);

/** Only presentation reconstruction is held; fresh reads and server judgment continue. */
export function PresentationInteractionProvider({
  hold,
  children,
}: {
  hold: () => () => void;
  children: ReactNode;
}) {
  return <InteractionContext.Provider value={hold}>{children}</InteractionContext.Provider>;
}

export function usePresentationInteraction(open: boolean): void {
  const hold = useContext(InteractionContext);
  useEffect(() => (open ? hold?.() : undefined), [hold, open]);
}
