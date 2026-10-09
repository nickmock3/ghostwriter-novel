import { useCallback, useEffect, useRef, useState } from "react";
import { shouldShowStartGuide } from "./StartGuideModal";
import type { WorkspaceSelectedOptions } from "./FirstRunWorkspaceModal";
import { workspaceSelectSuccessSchema } from "./workspaceSchemas";
import { apiFetch } from "../../shared/client/apiTransport";
import { clearStoredWorkspaceRoot, readStoredWorkspaceRoot, writeStoredWorkspaceRoot } from "./workspaceSessionStorage";

export type WorkspaceRestoreState =
  | { status: "idle" }
  | { previousRoot: string; status: "restoring" }
  | { previousRoot: string; status: "failed" };

export function useWorkspaceSession(restoreLastWorkspace: boolean) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceRestoreState, setWorkspaceRestoreState] = useState<WorkspaceRestoreState>({ status: "idle" });
  const [showStartGuide, setShowStartGuide] = useState(false);
  const suppressStartGuideForWorkspaceRef = useRef<string | null>(null);
  const showStartGuideForWorkspaceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!restoreLastWorkspace) {
      return;
    }

    const storedWorkspaceRoot = readStoredWorkspaceRoot();

    if (!storedWorkspaceRoot) {
      setWorkspaceRestoreState({ status: "idle" });
      return;
    }

    const previousWorkspaceRoot = storedWorkspaceRoot;
    let isActive = true;
    setWorkspaceRestoreState({ previousRoot: previousWorkspaceRoot, status: "restoring" });

    async function restoreWorkspace() {
      try {
        const response = await apiFetch("/api/workspace/validate", {
          body: JSON.stringify({ workspaceRoot: storedWorkspaceRoot }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const body: unknown = await response.json();
        const parsedBody = workspaceSelectSuccessSchema.safeParse(body);

        if (!response.ok || !parsedBody.success) {
          throw new Error("Workspace validation failed");
        }

        if (readStoredWorkspaceRoot() !== previousWorkspaceRoot) {
          return;
        }

        if (!isActive) {
          return;
        }

        setWorkspaceRoot(parsedBody.data.workspaceRoot);
        setWorkspaceRestoreState({ status: "idle" });
        writeStoredWorkspaceRoot(parsedBody.data.workspaceRoot);
      } catch {
        if (readStoredWorkspaceRoot() !== previousWorkspaceRoot) {
          return;
        }

        if (!isActive) {
          return;
        }

        clearStoredWorkspaceRoot();
        setWorkspaceRestoreState({ previousRoot: previousWorkspaceRoot, status: "failed" });
      }
    }

    void restoreWorkspace();

    return () => {
      isActive = false;
    };
  }, [restoreLastWorkspace]);

  const dismissStartGuide = useCallback(() => {
    setShowStartGuide(false);
  }, []);

  useEffect(() => {
    if (!workspaceRoot) {
      setShowStartGuide(false);
      return;
    }

    if (suppressStartGuideForWorkspaceRef.current === workspaceRoot) {
      suppressStartGuideForWorkspaceRef.current = null;
      setShowStartGuide(false);
      return;
    }

    if (showStartGuideForWorkspaceRef.current === workspaceRoot) {
      showStartGuideForWorkspaceRef.current = null;
      setShowStartGuide(true);
      return;
    }

    const abortController = new AbortController();

    void shouldShowStartGuide(workspaceRoot, abortController.signal)
      .then((shouldShow) => {
        if (!abortController.signal.aborted) {
          setShowStartGuide(shouldShow);
        }
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          setShowStartGuide(false);
        }
      });

    return () => abortController.abort();
  }, [workspaceRoot]);

  const selectWorkspace = useCallback((nextWorkspaceRoot: string, options?: WorkspaceSelectedOptions) => {
    if (options?.suppressStartGuide) {
      suppressStartGuideForWorkspaceRef.current = nextWorkspaceRoot;
    }
    if (options?.showStartGuide) {
      showStartGuideForWorkspaceRef.current = nextWorkspaceRoot;
    }
    setWorkspaceRoot(nextWorkspaceRoot);
    setWorkspaceRestoreState({ status: "idle" });
    writeStoredWorkspaceRoot(nextWorkspaceRoot);
  }, []);

  return { dismissStartGuide, selectWorkspace, showStartGuide, workspaceRestoreState, workspaceRoot };
}
