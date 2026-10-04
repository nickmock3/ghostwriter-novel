import {
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  SIDECAR_DISCONNECT_MESSAGE,
  type DesktopRuntimeController,
  desktopRuntimeController,
} from "./desktopRuntime";

type DesktopRuntimeGateProps = {
  children: ReactNode;
  controller?: DesktopRuntimeController;
};

export function DesktopRuntimeGate({
  children,
  controller = desktopRuntimeController,
}: DesktopRuntimeGateProps) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.start();
  }, [controller]);

  if (snapshot.status === "ready") {
    return children;
  }

  if (snapshot.status === "starting") {
    return (
      <div className="desktop-runtime-gate">
        <div className="desktop-runtime-gate__panel">
          <p className="workspace-status" role="status">
            ローカルAPIサーバーに接続しています…
          </p>
        </div>
      </div>
    );
  }

  const isDisconnect =
    snapshot.message === SIDECAR_DISCONNECT_MESSAGE;

  return (
    <div className="desktop-runtime-gate">
      <div className="desktop-runtime-gate__panel" role="alert">
        <p className="workspace-error">
          {isDisconnect ? snapshot.message : "ローカルAPIサーバーを起動できませんでした。"}
        </p>
        {!isDisconnect ? (
          <p className="workspace-error-detail">{snapshot.message}</p>
        ) : null}
        <button
          className="secondary-action"
          onClick={() => {
            void controller.restart();
          }}
          type="button"
        >
          再起動
        </button>
      </div>
    </div>
  );
}
