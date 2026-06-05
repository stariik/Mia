export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

export type ClientToolCall = {
  id: string;
  name: string;
  args: ToolArgs;
};
