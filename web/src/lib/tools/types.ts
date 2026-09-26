// OpenAI-style function schema; registry.ts converts it for Gemini.
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

export type ServerTool = {
  name: string;
  execution: "server";
  definition: ToolDefinition;
  handler: (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>;
};

export type ClientTool = {
  name: string;
  execution: "client";
  definition: ToolDefinition;
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
