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
  // The phone speaks the outcome itself (only it knows it — e.g. SMS contact
  // lookup), so the chat route skips the model's follow-up reply.
  speaksResult?: true;
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
