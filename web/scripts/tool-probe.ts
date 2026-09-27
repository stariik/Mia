/**
 * Runs scripted conversations through the chat route's exact model config and
 * system instruction; prints each tool call and spoken reply. Client tools are
 * answered {scheduled:true}, as the route does.
 *   npm run tools:probe -- cases.json [repeats]
 * cases.json: [{ "turns": ["მაღვიძარა მინდა", "შვიდზე"], "ctx": { timers: [...] } }]
 */
import dotenv from 'dotenv';
import type { Content, Part } from '@google/genai';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });
import { gemini, CHAT_MODEL, LOW_THINKING } from '../src/lib/gemini';
import { buildSystemInstruction, type ChatUserContext } from '../src/lib/chatSystem';
import { findTool, getToolDefinitions, isServerTool } from '../src/lib/tools/registry';

type Case = { turns: string[]; ctx?: ChatUserContext };

async function runTurn(contents: Content[], system: string) {
  const out: string[] = [];
  for (let round = 0; round < 3; round++) {
    const res = await gemini().models.generateContent({
      model: CHAT_MODEL,
      contents,
      config: {
        systemInstruction: system,
        temperature: 0.7,
        maxOutputTokens: 1024,
        thinkingConfig: LOW_THINKING,
        tools: [{ functionDeclarations: getToolDefinitions() }],
      },
    });
    const parts: Part[] = res.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    if (text) out.push(`  reply: ${text}`);
    const calls = parts.flatMap((p) => (p.functionCall ? [p.functionCall] : []));
    if (!calls.length) return { out, text };
    contents.push({ role: 'model', parts });
    for (const c of calls) out.push(`  CALL ${c.name} ${JSON.stringify(c.args)}`);
    const responses: Part[] = [];
    for (const c of calls) {
      const tool = findTool(c.name ?? '');
      const response =
        tool && isServerTool(tool)
          ? await tool.handler(c.args ?? {}, { timezone: 'Asia/Tbilisi' })
          : { scheduled: true };
      responses.push({ functionResponse: { id: c.id, name: c.name, response } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { out, text: '' };
}

async function main() {
  const file = process.argv[2];
  const cases: Case[] = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  const repeats = Number(process.argv[3] ?? 1);
  const runs = cases.flatMap((c) => Array.from({ length: repeats }, () => c));
  await Promise.all(
    runs.map(async (c) => {
      const system = buildSystemInstruction({ timezone: 'Asia/Tbilisi', ...c.ctx });
      const contents: Content[] = [];
      const log: string[] = [];
      for (const t of c.turns) {
        log.push(`> ${t}`);
        contents.push({ role: 'user', parts: [{ text: t }] });
        try {
          const { out } = await runTurn(contents, system);
          log.push(...out);
        } catch (e) {
          log.push(`  ERROR ${(e as Error).message.slice(0, 200)}`);
          break;
        }
      }
      return log.join('\n');
    }),
  ).then((logs) => console.log(logs.join('\n\n')));
}
main();
