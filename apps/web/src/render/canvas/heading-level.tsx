'use client';
import { createContext, useContext, type ReactNode } from 'react';
const HeadingLevel = createContext<1 | 2>(1);
/** The containing page owns its heading hierarchy; no business facts enter this context. */
export function PresentationHeadingLevel({
  level,
  children,
}: {
  level: 1 | 2;
  children: ReactNode;
}) {
  return <HeadingLevel.Provider value={level}>{children}</HeadingLevel.Provider>;
}
export function usePresentationHeadingLevel() {
  return useContext(HeadingLevel);
}
