export type EditorTarget = {
  content: string;
  isDirty: boolean;
  path: string;
  selection: { end: number; start: number } | null;
};

