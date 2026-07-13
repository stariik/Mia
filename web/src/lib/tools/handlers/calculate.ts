import type { ServerTool } from "../types";

// Safe arithmetic evaluator — recursive descent over the model's expression
// string. No eval / Function: the string is PARSED, never executed as code, so
// a hostile expression can't run anything. Supports + - * / % , parentheses,
// unary +/-, and decimals. LLMs are unreliable at mental math ("500+1017" →
// 1516), so any arithmetic is computed here instead.
function evaluate(s: string): number {
  let i = 0;
  const ws = () => {
    while (i < s.length && s[i] === " ") i++;
  };

  function expr(): number {
    let v = term();
    for (;;) {
      ws();
      const c = s[i];
      if (c === "+") {
        i++;
        v += term();
      } else if (c === "-") {
        i++;
        v -= term();
      } else return v;
    }
  }

  function term(): number {
    let v = factor();
    for (;;) {
      ws();
      const c = s[i];
      if (c === "*") {
        i++;
        v *= factor();
      } else if (c === "/") {
        i++;
        v /= factor();
      } else if (c === "%") {
        i++;
        v %= factor();
      } else return v;
    }
  }

  function factor(): number {
    ws();
    const c = s[i];
    if (c === "-") {
      i++;
      return -factor();
    }
    if (c === "+") {
      i++;
      return factor();
    }
    if (c === "(") {
      i++;
      const v = expr();
      ws();
      if (s[i] !== ")") throw new Error("missing )");
      i++;
      return v;
    }
    return num();
  }

  function num(): number {
    ws();
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    const tok = s.slice(start, i);
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(tok)) throw new Error("bad number: " + tok);
    return parseFloat(tok);
  }

  const r = expr();
  ws();
  if (i !== s.length) throw new Error("unexpected: " + s.slice(i));
  return r;
}

export const calculate: ServerTool = {
  name: "calculate",
  execution: "server",
  definition: {
    type: "function",
    function: {
      name: "calculate",
      description:
        "Evaluate an arithmetic expression exactly. ALWAYS use this for any math — addition, subtraction, multiplication, division, percentages — instead of computing in your head, which is error-prone. Pass the expression with digits and the operators + - * / % and parentheses, e.g. \"500+1017\" or \"(12.5*4)-3\".",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: 'The arithmetic expression, e.g. "500+1017".',
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  },
  async handler(args) {
    const expression = String(args.expression ?? "").trim();
    if (!expression) return { error: "no expression" };
    try {
      const value = evaluate(expression);
      if (!Number.isFinite(value)) return { error: "result is not finite" };
      // Trim floating-point noise (0.1 + 0.2 → 0.3, not 0.30000000000000004).
      return { expression, result: Math.round(value * 1e10) / 1e10 };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "invalid expression" };
    }
  },
};

// ponytail: self-check for the parser — run with `npx tsx` on this file or call
// from a script. Throws on the first mismatch.
export function selfCheck(): void {
  const ok: [string, number][] = [
    ["500+1017", 1517], ["2*3+4", 10], ["(2+3)*4", 20], ["10/4", 2.5],
    ["-5+2", -3], ["0.1+0.2", 0.3],
  ];
  for (const [e, want] of ok) {
    const got = Math.round(evaluate(e) * 1e10) / 1e10;
    if (got !== want) throw new Error(`evaluate(${e}) = ${got}, want ${want}`);
  }
  for (const bad of ["2+", "1.2.3", "5+(3", "abc", "2**3"]) {
    let threw = false;
    try {
      evaluate(bad);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`evaluate(${bad}) should have thrown`);
  }
}
