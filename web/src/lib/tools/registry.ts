import type { Tool, ServerTool, ClientTool } from "./types";
import { getTime } from "./handlers/getTime";
import { getWeather } from "./handlers/getWeather";
import { setTimer } from "./handlers/setTimer";
import { setAlarm } from "./handlers/setAlarm";
import { cancelTimer, cancelAlarm } from "./handlers/cancel";
import { calculate } from "./handlers/calculate";
import {
  pauseMusic,
  resumeMusic,
  toggleMusic,
  skipNext,
  skipPrevious,
  restartTrack,
} from "./handlers/music";

export const TOOLS: Tool[] = [
  getTime,
  getWeather,
  setTimer,
  setAlarm,
  cancelTimer,
  cancelAlarm,
  calculate,
  pauseMusic,
  resumeMusic,
  toggleMusic,
  skipNext,
  skipPrevious,
  restartTrack,
];

export function getToolDefinitions() {
  return TOOLS.map((t) => t.definition);
}

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function isServerTool(t: Tool): t is ServerTool {
  return t.execution === "server";
}

export function isClientTool(t: Tool): t is ClientTool {
  return t.execution === "client";
}
