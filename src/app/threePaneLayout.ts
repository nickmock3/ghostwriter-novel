import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

export const DEFAULT_CENTER_PANE_WIDTH = 720;
export const DEFAULT_RIGHT_PANE_WIDTH = 340;
export const MIN_LEFT_PANE_WIDTH = 250;
export const MIN_CENTER_PANE_WIDTH = 560;
export const MIN_RIGHT_PANE_WIDTH = 300;
export const GRID_GAP_WIDTH = 1;

export type ResizedPaneWidths = {
  center: number;
  right: number;
};

type ResizeDragState = {
  layoutWidth: number;
  startCenterWidth: number;
  startClientX: number;
  startRightWidth: number;
};

export type CreateThreePaneGridTemplateColumnsInput = {
  isLeftPaneCollapsed: boolean;
  isRightPaneCollapsed: boolean;
  paneWidths: ResizedPaneWidths | null;
};

export function createThreePaneGridTemplateColumns({
  isLeftPaneCollapsed,
  isRightPaneCollapsed,
  paneWidths,
}: CreateThreePaneGridTemplateColumnsInput): CSSProperties | undefined {
  if (!paneWidths) {
    return undefined;
  }

  const { center, right } = paneWidths;

  if (isLeftPaneCollapsed && isRightPaneCollapsed) {
    return {
      gridTemplateColumns: `minmax(${center}px, 100%)`,
    };
  }

  if (isLeftPaneCollapsed) {
    return {
      gridTemplateColumns: `minmax(${center}px, calc(100% - ${right}px - 1px)) 1px ${right}px`,
    };
  }

  if (isRightPaneCollapsed) {
    return {
      gridTemplateColumns: `${MIN_LEFT_PANE_WIDTH}px minmax(${center}px, 1fr)`,
    };
  }

  return {
    gridTemplateColumns: `minmax(${MIN_LEFT_PANE_WIDTH}px, calc(100% - ${center}px - ${right}px - 1px)) ${center}px 1px ${right}px`,
  };
}

export type UseThreePaneLayoutResult = {
  handleCollapseLeftPane: () => void;
  handleCollapseRightPane: () => void;
  handleResetPaneWidths: () => void;
  handleResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleRestoreLeftPane: () => void;
  handleRestoreRightPane: () => void;
  isLeftPaneCollapsed: boolean;
  isRightPaneCollapsed: boolean;
  isPaneResizeDragging: boolean;
  layoutRef: MutableRefObject<HTMLElement | null>;
  paneWidths: ResizedPaneWidths | null;
  restoreRightPane: () => void;
  threePaneLayoutStyle: CSSProperties | undefined;
};

export function useThreePaneLayout(): UseThreePaneLayoutResult {
  const [paneWidths, setPaneWidths] = useState<ResizedPaneWidths | null>(null);
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false);
  const [isRightPaneCollapsed, setIsRightPaneCollapsed] = useState(false);
  const [isPaneResizeDragging, setIsPaneResizeDragging] = useState(false);
  const layoutRef = useRef<HTMLElement | null>(null);
  const resizeDragStateRef = useRef<ResizeDragState | null>(null);

  const handleCollapseLeftPane = useCallback(() => {
    setIsLeftPaneCollapsed(true);
  }, []);

  const handleRestoreLeftPane = useCallback(() => {
    setIsLeftPaneCollapsed(false);
  }, []);

  const handleCollapseRightPane = useCallback(() => {
    setIsRightPaneCollapsed(true);
  }, []);

  const handleRestoreRightPane = useCallback(() => {
    setIsRightPaneCollapsed(false);
  }, []);

  const handleResizeMove = useCallback(
    (event: PointerEvent) => {
      const dragState = resizeDragStateRef.current;
      if (!dragState) {
        return;
      }

      const delta = event.clientX - dragState.startClientX;
      const leftPaneReserve = isLeftPaneCollapsed ? 0 : MIN_LEFT_PANE_WIDTH;
      const rightPaneReserve = isRightPaneCollapsed ? 0 : MIN_RIGHT_PANE_WIDTH;
      const maxCenterWidth = Math.max(
        MIN_CENTER_PANE_WIDTH,
        dragState.layoutWidth -
          leftPaneReserve -
          rightPaneReserve -
          GRID_GAP_WIDTH * (isRightPaneCollapsed ? 0 : 2),
      );
      const maxRightWidth = Math.max(
        MIN_RIGHT_PANE_WIDTH,
        dragState.layoutWidth -
          leftPaneReserve -
          MIN_CENTER_PANE_WIDTH -
          GRID_GAP_WIDTH * (isRightPaneCollapsed ? 0 : 2),
      );

      const nextCenterWidth = Math.min(
        maxCenterWidth,
        Math.max(MIN_CENTER_PANE_WIDTH, dragState.startCenterWidth + delta),
      );
      const nextRightWidth = Math.min(
        maxRightWidth,
        Math.max(MIN_RIGHT_PANE_WIDTH, dragState.startRightWidth - delta),
      );

      setPaneWidths({
        center: Math.round(nextCenterWidth),
        right: Math.round(nextRightWidth),
      });
    },
    [isLeftPaneCollapsed, isRightPaneCollapsed],
  );

  const handleResizeEnd = useCallback(() => {
    resizeDragStateRef.current = null;
    setIsPaneResizeDragging(false);
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", handleResizeEnd);
    window.removeEventListener("pointercancel", handleResizeEnd);
  }, [handleResizeMove]);

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const layoutElement = layoutRef.current;
      if (!layoutElement) {
        return;
      }

      event.preventDefault();

      const layoutRect = layoutElement.getBoundingClientRect();
      const editorPane = layoutElement.querySelector('[aria-label="テキストエディター"]');
      const chatPane =
        layoutElement.querySelector('[aria-label="AIアシスト"]') ??
        layoutElement.querySelector('[aria-label="AIチャット"]');
      const measuredEditorWidth =
        editorPane instanceof HTMLElement ? editorPane.getBoundingClientRect().width : 0;
      const measuredChatWidth =
        chatPane instanceof HTMLElement ? chatPane.getBoundingClientRect().width : 0;
      const startCenterWidth =
        paneWidths?.center ?? (measuredEditorWidth > 0 ? measuredEditorWidth : DEFAULT_CENTER_PANE_WIDTH);
      const startRightWidth =
        paneWidths?.right ?? (measuredChatWidth > 0 ? measuredChatWidth : DEFAULT_RIGHT_PANE_WIDTH);
      resizeDragStateRef.current = {
        layoutWidth: layoutRect.width,
        startCenterWidth,
        startClientX: event.clientX,
        startRightWidth,
      };
      setIsPaneResizeDragging(true);

      window.addEventListener("pointermove", handleResizeMove);
      window.addEventListener("pointerup", handleResizeEnd);
      window.addEventListener("pointercancel", handleResizeEnd);
    },
    [handleResizeEnd, handleResizeMove, paneWidths],
  );

  const handleResetPaneWidths = useCallback(() => {
    resizeDragStateRef.current = null;
    setIsPaneResizeDragging(false);
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", handleResizeEnd);
    window.removeEventListener("pointercancel", handleResizeEnd);
    setPaneWidths(null);
  }, [handleResizeEnd, handleResizeMove]);

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", handleResizeMove);
      window.removeEventListener("pointerup", handleResizeEnd);
      window.removeEventListener("pointercancel", handleResizeEnd);
    },
    [handleResizeEnd, handleResizeMove],
  );

  useEffect(() => {
    if (paneWidths !== null) {
      return;
    }

    layoutRef.current?.removeAttribute("style");
  }, [paneWidths]);

  const threePaneLayoutStyle = createThreePaneGridTemplateColumns({
    isLeftPaneCollapsed,
    isRightPaneCollapsed,
    paneWidths,
  });

  return {
    handleCollapseLeftPane,
    handleCollapseRightPane,
    handleResetPaneWidths,
    handleResizeStart,
    handleRestoreLeftPane,
    handleRestoreRightPane,
    isLeftPaneCollapsed,
    isRightPaneCollapsed,
    isPaneResizeDragging,
    layoutRef,
    paneWidths,
    restoreRightPane: handleRestoreRightPane,
    threePaneLayoutStyle,
  };
}
