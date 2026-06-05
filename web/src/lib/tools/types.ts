import type { ChatCompletionTool } from "openai/resources/chat/completions";

export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

export type ServerTool = {
  name: string;
  execution: "server";
  definition: ChatCompletionTool;
  handler: (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>;
};

export type ClientTool = {
  name: string;
  execution: "client";
  definition: ChatCompletionTool;
};

export type Tool = ServerTool | ClientTool;

export type ToolContext = {
  userCoords?: { lat: number; lon: number };
};

export type ClientToolCall = {
  id: string;
  name: string;
  args: ToolArgs;
};
