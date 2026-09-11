export type RobotCommand =
	| "start"
	| "pause"
	| "continue"
	| "return"
	| "fanQuiet"
	| "fanStandard"
	| "fanStrong"
	| "deepCleaning"
	| "collectDust";

export interface CommandRequest {
	path: string;
	body: string;
	contentType?: string;
}

export interface CommandDefinition {
	id: string;
	command: RobotCommand;
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
	{ id: "commands.start", command: "start" },
	{ id: "commands.pause", command: "pause" },
	{ id: "commands.continue", command: "continue" },
	{ id: "commands.return", command: "return" },
	{ id: "commands.fan.quiet", command: "fanQuiet" },
	{ id: "commands.fan.standard", command: "fanStandard" },
	{ id: "commands.fan.strong", command: "fanStrong" },
	{ id: "commands.deepCleaning", command: "deepCleaning" },
	{ id: "commands.collectDust", command: "collectDust" },
];

export function commandForStateId(id: string): RobotCommand | undefined {
	return COMMAND_DEFINITIONS.find(definition => definition.id === id)?.command;
}

export function normalizeCommandButtonValue(value: ioBroker.StateValue | undefined): boolean | undefined {
	if (value === true || value === 1) {
		return true;
	}

	if (value === false || value === 0 || value === null) {
		return false;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true" || normalized === "1" || normalized === "on") {
			return true;
		}
		if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "") {
			return false;
		}
	}

	return undefined;
}

export function buildCommandRequest(
	command: RobotCommand,
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
		case "fanQuiet":
			return {
				path: `/instructions/${encodedSerial}/21022?username=${encodedUsername}`,
				body: "setMode=quiet",
			};
		case "fanStandard":
			return {
				path: `/instructions/${encodedSerial}/21022?username=${encodedUsername}`,
				body: "setMode=auto",
			};
		case "fanStrong":
			return {
				path: `/instructions/${encodedSerial}/21022?username=${encodedUsername}`,
				body: "setMode=strong",
			};
		case "deepCleaning":
			return {
				path: `/instructions/cmd21005_2/${encodedSerial}?username=${encodedUsername}`,
				body: "mode=depthTotalClean",
			};
		case "collectDust":
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
