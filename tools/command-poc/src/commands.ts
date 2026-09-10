export type CommandName = "start" | "pause" | "continue" | "return";

export interface CommandRequest {
  path: string;
  body: string;
}

export function buildCommandRequest(command: CommandName, serial: string, username: string): CommandRequest {
  const encodedSerial = encodeURIComponent(serial);
  const encodedUsername = encodeURIComponent(username);

  switch (command) {
    case "start":
      return {
        path: `/instructions/cmd21005/${encodedSerial}?username=${encodedUsername}`,
        body: "cleanMode=sweepOnly",
      };
    case "pause":
      return {
        path: `/instructions/${encodedSerial}/21017?username=${encodedUsername}`,
        body: "mode=pause",
      };
    case "continue":
      return {
        path: `/instructions/${encodedSerial}/21017?username=${encodedUsername}`,
        body: "pauseOrContinue=continue",
      };
    case "return":
      return {
        path: `/instructions/${encodedSerial}/21012?username=${encodedUsername}`,
        body: "charge=start",
      };
  }
}

export function isCommandName(value: string): value is CommandName {
  return value === "start" || value === "pause" || value === "continue" || value === "return";
}
