/** A closed arithmetic trace, not an arbitrary Python/JavaScript evaluator. */
export interface ArithmeticAssignmentProgram {
  readonly language: "python";
  readonly filename: "lesson.py";
  readonly lines: readonly { readonly text: string; readonly annotation: string }[];
}

const reserved = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

function bounded(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error("Arithmetic result exceeds the supported numeric range");
  }
  return Object.is(value, -0) ? 0 : value;
}

function evaluate(expression: string, variables: ReadonlyMap<string, number>): number {
  const tokens: string[] = [];
  const pattern = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+\-*/])/uy;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match || match.index !== offset || tokens.length >= 128) {
      throw new Error("Unsupported arithmetic syntax");
    }
    tokens.push(match[1]!);
    offset = pattern.lastIndex;
  }
  let cursor = 0;
  const primary = (depth: number): number => {
    if (depth > 16) throw new Error("Arithmetic nesting exceeds the limit");
    const token = tokens[cursor++];
    if (token === "+") return primary(depth + 1);
    if (token === "-") return bounded(-primary(depth + 1));
    if (token === "(") {
      const value = sum(depth + 1);
      if (tokens[cursor++] !== ")") throw new Error("Unclosed arithmetic group");
      return value;
    }
    if (token && /^\d+(?:\.\d+)?$/u.test(token)) {
      if (/^0\d/u.test(token)) throw new Error("Ambiguous leading-zero literal");
      return bounded(Number(token));
    }
    if (token && /^[A-Za-z_][A-Za-z_0-9]*$/u.test(token) && variables.has(token)) {
      return variables.get(token)!;
    }
    throw new Error("Unknown arithmetic value");
  };
  const product = (depth: number): number => {
    let value = primary(depth);
    while (tokens[cursor] === "*" || tokens[cursor] === "/") {
      const operator = tokens[cursor++];
      const right = primary(depth);
      if (operator === "/" && right === 0) throw new Error("Division by zero");
      value = bounded(operator === "*" ? value * right : value / right);
    }
    return value;
  };
  const sum = (depth: number): number => {
    let value = product(depth);
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const operator = tokens[cursor++];
      const right = product(depth);
      value = bounded(operator === "+" ? value + right : value - right);
    }
    return value;
  };
  const result = sum(0);
  if (cursor !== tokens.length) throw new Error("Trailing arithmetic syntax");
  return result;
}

/**
 * Compile approved worked assignments into valid Python and measured results.
 * A chained display equality is accepted only when its asserted result checks.
 * Calls, properties, indexing, statements, and unknown names are never executed.
 * Unsupported content returns undefined so its caller can label it as prose.
 */
export function compileArithmeticAssignmentProgram(
  approvedLines: readonly string[],
): ArithmeticAssignmentProgram | undefined {
  if (approvedLines.length === 0 || approvedLines.length > 24) return undefined;
  const variables = new Map<string, number>();
  const lines: { text: string; annotation: string }[] = [];
  try {
    for (const raw of approvedLines) {
      if (raw.length > 512 || /[\r\n]/u.test(raw)) return undefined;
      const source = raw.trim().replace(/[−–]/gu, "-").replace(/×/gu, "*").replace(/÷/gu, "/");
      const parts = source.split("=").map((part) => part.trim());
      if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part)) return undefined;
      const name = parts[0]!;
      if (!/^[A-Za-z_][A-Za-z_0-9]{0,63}$/u.test(name) || reserved.has(name)) return undefined;
      const expression = parts[1]!;
      const result = evaluate(expression, variables);
      if (parts.length === 3) {
        const asserted = evaluate(parts[2]!, variables);
        const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(result), Math.abs(asserted));
        if (Math.abs(result - asserted) > tolerance) return undefined;
      }
      variables.set(name, result);
      // Tokens have already been checked by the closed parser. Retaining their
      // exact order preserves unary signs and parenthesized arithmetic.
      const formatted = expression.replace(/\s+/gu, " ");
      lines.push({ text: `${name} = ${formatted}`, annotation: `${name} = ${result}` });
    }
  } catch {
    return undefined;
  }
  return { language: "python", filename: "lesson.py", lines };
}
