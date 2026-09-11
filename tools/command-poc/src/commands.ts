export type CommandName =
  | "start"
  | "pause"
  | "continue"
  | "return"
  | "fan-quiet"
  | "fan-standard"
  | "fan-strong"
  | "deep-cleaning"
  | "collect-dust";

export interface CommandRequest {
  path: string;
  body: string;
  contentType?: string;
}

export function buildCommandRequest(
  command: CommandName,
  serial: string,
  username: string,
  now = new Date(),
): CommandRequest {
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
    case "fan-quiet":
      return {
        path: `/instructions/${encodedSerial}/21022?username=${encodedUsername}`,
        body: "setMode=quiet",
      };
    case "fan-standard":
      return {
        path: `/instructions/${encodedSerial}/21022?username=${encodedUsername}`,
        body: "setMode=auto",
      };
    case "fan-strong":
      return {
        path: `/instructions/${encodedSerial}/21022?username=${encodedUsername}`,
        body: "setMode=strong",
      };
    case "deep-cleaning":
      return {
        path: `/instructions/cmd21005_2/${encodedSerial}?username=${encodedUsername}`,
        body: "mode=depthTotalClean",
      };
    case "collect-dust":
      return {
        path: `/instructions/cmd/${encodedSerial}?username=${encodedUsername}`,
        contentType: "application/json;charset=UTF-8",
        body: JSON.stringify({
          dInfo: {
            ts: now.getTime().toString(),
            userId: username,
          },
          data: {
            cmd: "startDustCenter",
            value: 0,
          },
          infoType: 21024,
        }),
      };
  }
}

export function isCommandName(value: string): value is CommandName {
  return (
    value === "start" ||
    value === "pause" ||
    value === "continue" ||
    value === "return" ||
    value === "fan-quiet" ||
    value === "fan-standard" ||
    value === "fan-strong" ||
    value === "deep-cleaning" ||
    value === "collect-dust"
  );
}
