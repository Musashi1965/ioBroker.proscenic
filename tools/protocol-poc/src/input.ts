import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY) {
    throw new Error("Password prompt requires a TTY or PROSCENIC_PASSWORD");
  }

  return new Promise((resolve) => {
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    let value = "";
    const onData = (char: string): void => {
      if (char === "\r" || char === "\n") {
        output.write("\n");
        input.setRawMode(false);
        input.pause();
        input.off("data", onData);
        resolve(value);
        return;
      }

      if (char === "\u0003") {
        output.write("\n");
        process.exit(130);
      }

      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += char;
    };

    input.on("data", onData);
  });
}
