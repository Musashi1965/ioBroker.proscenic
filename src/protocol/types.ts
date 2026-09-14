export interface ProscenicEnvelope<T = unknown> {
	code?: number;
	msg?: string;
	errorMsg?: string;
	data?: T;
}

export interface LoginData {
	token: string;
}

export interface DeviceRecord {
	code?: string;
	model?: string;
	name?: string;
	sn?: string;
	status?: boolean;
}

export interface DeviceListData {
	content?: DeviceRecord[];
}

export interface GatewayAddress {
	ip?: string;
	port?: number | string;
}

export interface GatewayData {
	addr_list?: GatewayAddress[];
}

export interface MaintenanceHistoryData {
	content?: unknown[];
	totalElements?: number;
	totalPages?: number;
	number?: number;
	size?: number;
}

export interface GatewayEndpoint {
	host: string;
	port: number;
}

export interface GatewayEvent {
	encrypted: boolean;
	infoType?: unknown;
	data?: unknown;
}
