import type { RunAgentLoopToolServiceOverrides } from "../ai-agent/tools/agentTools";
import { createChatModeProposalToolServices } from "./editProposalAutoApply";
import {
  cleanupDroppedTextFiles,
  consumeDroppedTextFile,
  readDroppedTextFile,
  readDroppedTextFileForPlacement,
  stageDroppedTextFiles,
} from "./droppedTextFiles";
import {
  appendConversationMessage,
  createConversation,
  getConversation,
} from "./conversationHistory";
import type {
  AgentChatApplicationEvent,
  AgentChatApplicationInput,
  DroppedTextFileStatus,
  DroppedTextFileStatusTracker,
  PreparedConversation,
  StagedDroppedTextFiles,
} from "./agentChatApplicationTypes";

export async function prepareAgentChatConversation(input: {
  applicationInput: AgentChatApplicationInput;
  dataRoot: string;
}): Promise<PreparedConversation> {
  const baseConversation = input.applicationInput.conversationId
    ? await getConversation({
        conversationId: input.applicationInput.conversationId,
        dataRoot: input.dataRoot,
        workspaceRoot: input.applicationInput.workspaceRoot,
      })
    : await createConversation({
        dataRoot: input.dataRoot,
        workspaceRoot: input.applicationInput.workspaceRoot,
      });

  const droppedTextFileInputs = input.applicationInput.droppedTextFiles ?? [];
  if (droppedTextFileInputs.length > 0 && input.applicationInput.mode !== "chat") {
    throw new Error("Dropped text files are available only in chat mode");
  }
  if (droppedTextFileInputs.length > 0 && baseConversation.agentRuntime === "codex-app-server") {
    throw new Error("Dropped text files are not available for Codex conversations yet");
  }

  const droppedTextFiles =
    droppedTextFileInputs.length > 0
      ? await stageDroppedTextFiles({
          conversationId: baseConversation.id,
          dataRoot: input.dataRoot,
          files: droppedTextFileInputs,
          workspaceRoot: input.applicationInput.workspaceRoot,
        })
      : undefined;

  try {
    const userConversation = await appendConversationMessage({
      content: input.applicationInput.content,
      conversationId: baseConversation.id,
      dataRoot: input.dataRoot,
      role: "user",
      workspaceRoot: input.applicationInput.workspaceRoot,
    });
    return {
      ...(droppedTextFiles ? { droppedTextFiles } : {}),
      userConversation,
    };
  } catch (error) {
    if (droppedTextFiles) {
      await cleanupDroppedTextFiles(droppedTextFiles.context);
    }
    throw error;
  }
}

export function droppedTextFilesModelContext(
  droppedTextFiles: StagedDroppedTextFiles | undefined,
): string | undefined {
  if (!droppedTextFiles || droppedTextFiles.files.length === 0) {
    return undefined;
  }

  return [
    "The current user message includes these temporary dropped text files.",
    "Use ReadDroppedTextFile with the opaque ID to inspect each file, then PlaceDroppedTextFile with that ID and an appropriate new workspace-relative targetPath.",
    "Do not reproduce the file content in tool arguments.",
    ...droppedTextFiles.files.map(
      (file) => `- droppedFileId=${file.id}; name=${JSON.stringify(file.name)}; sizeBytes=${file.sizeBytes}`,
    ),
  ].join("\n");
}

export function createDroppedTextFileStatusTracker(input: {
  droppedTextFiles: StagedDroppedTextFiles | undefined;
  onEvent?: (event: AgentChatApplicationEvent) => void;
}): DroppedTextFileStatusTracker {
  const entries = (input.droppedTextFiles?.files ?? []).map((file, index) => ({
    file,
    index,
    status: "pending" as DroppedTextFileStatus,
  }));
  const emit = (
    entry: (typeof entries)[number],
    targetPath?: string,
  ): void => {
    input.onEvent?.({
      file: {
        index: entry.index,
        name: entry.file.name,
        sizeBytes: entry.file.sizeBytes,
        status: entry.status,
        ...(targetPath ? { targetPath } : {}),
      },
      type: "dropped-text-file-status",
    });
  };

  return {
    emitPending: () => {
      entries.forEach((entry) => emit(entry));
    },
    finalizePending: (status) => {
      entries.forEach((entry) => {
        if (entry.status !== "pending") {
          return;
        }
        entry.status = status;
        emit(entry);
      });
    },
    updatePlacement: (droppedFileId, status, targetPath) => {
      const entry = entries.find((candidate) => candidate.file.id === droppedFileId);
      if (!entry) {
        return;
      }
      entry.status = status;
      emit(entry, targetPath);
    },
  };
}

export function createDroppedTextFileToolServices(input: {
  dataRoot: string;
  conversationId: string;
  droppedTextFiles: StagedDroppedTextFiles | undefined;
  statusTracker: DroppedTextFileStatusTracker;
  workspaceRoot: string;
}): Pick<
  RunAgentLoopToolServiceOverrides,
  "placeDroppedTextFile" | "readDroppedTextFile"
> {
  if (!input.droppedTextFiles) {
    return {};
  }

  const droppedTextFiles = input.droppedTextFiles;
  const proposalServices = createChatModeProposalToolServices(input);
  return {
    readDroppedTextFile: ({ droppedFileId }) =>
      readDroppedTextFile({
        context: droppedTextFiles.context,
        droppedFileId,
      }),
    placeDroppedTextFile: async ({ droppedFileId, targetPath }) => {
      try {
        const droppedFile = await readDroppedTextFileForPlacement({
          context: droppedTextFiles.context,
          droppedFileId,
        });
        const proposal = await proposalServices.createFileProposal!({
          content: droppedFile.content,
          path: targetPath,
          workspaceRoot: input.workspaceRoot,
        });
        if (proposal.status !== "applied") {
          input.statusTracker.updatePlacement(droppedFileId, "failed", targetPath);
          return proposal;
        }
        await consumeDroppedTextFile({
          context: droppedTextFiles.context,
          droppedFileId,
        });
        input.statusTracker.updatePlacement(droppedFileId, "placed", targetPath);
        return proposal;
      } catch (error) {
        input.statusTracker.updatePlacement(droppedFileId, "failed", targetPath);
        throw error;
      }
    },
  };
}
