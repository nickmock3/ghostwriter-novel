import {
  createContext,
  useContext,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ResizedPaneWidths } from "./threePaneLayout";

export type PaneLayoutContextValue = {
  handleCollapseLeftPane: () => void;
  handleCollapseRightPane: () => void;
  handleResetPaneWidths: () => void;
  handleResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleRestoreLeftPane: () => void;
  handleRestoreRightPane: () => void;
  isLeftPaneCollapsed: boolean;
  isPaneResizeDragging: boolean;
  isRightPaneCollapsed: boolean;
  layoutRef: MutableRefObject<HTMLElement | null>;
  paneWidths: ResizedPaneWidths | null;
  threePaneLayoutStyle: CSSProperties | undefined;
};

export const PaneLayoutContext = createContext<PaneLayoutContextValue | null>(null);

export function usePaneLayoutContext() {
  const value = useContext(PaneLayoutContext);

  if (!value) {
    throw new Error("usePaneLayoutContext must be used inside App.");
  }

  return value;
}
