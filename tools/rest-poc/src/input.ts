import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptLine(prompt: string): Promise<string> {
  const readline = createInterface({ input, output });
  try {
    return await readline.question(prompt);
  } finally {
    readline.close();
  }
}

export async function promptHidden(prompt: string): Promise<string> {
  output.write(prompt);
  const wasRaw = input.isRaw;
  input.setRawMode?.(true);
  input.resume();

  let value = "";
  try {
    for await (const chunk of input) {
      const text = chunk.toString("utf8");
      for (const char of text) {
        if (char === "\r" || char === "\n") {
          output.write("\n");
          return value;
        }
        if (char === "\u0003") {
          throw new Error("Interrupted");
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }
  } finally {
    input.setRawMode?.(wasRaw ?? false);
    input.pause();
  }

  throw new Error("No password entered");
}
