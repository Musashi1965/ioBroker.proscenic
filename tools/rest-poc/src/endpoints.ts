export type EndpointGroup = "device" | "maintenance" | "messages" | "map" | "rooms";

export interface EndpointContext {
  username: string;
  serial: string;
}

export interface EndpointCandidate {
  id: string;
  group: EndpointGroup;
  method: "GET" | "POST";
  path(context: EndpointContext): string;
  body?(context: EndpointContext): Record<string, string>;
  token: boolean;
}

interface BodyVariant {
  id: string;
  body(context: EndpointContext): Record<string, string>;
}

const COMMON_BODY_VARIANTS: readonly BodyVariant[] = [
  variant("username-sn", ({ username, serial }) => ({ username, sn: serial })),
  variant("username-serial", ({ username, serial }) => ({ username, serial })),
  variant("userId-sn", ({ username, serial }) => ({ userId: username, sn: serial })),
  variant("sn-only", ({ serial }) => ({ sn: serial })),
  variant("empty", () => ({})),
];

const PAGED_BODY_VARIANTS: readonly BodyVariant[] = [
  variant("username-sn-page", ({ username, serial }) => ({
    username,
    sn: serial,
    page: "1",
    pageNo: "1",
    pageNum: "1",
    pageSize: "20",
    limit: "20",
    size: "20",
  })),
  variant("userId-sn-page", ({ username, serial }) => ({
    userId: username,
    sn: serial,
    page: "1",
    pageNo: "1",
    pageNum: "1",
    pageSize: "20",
    limit: "20",
    size: "20",
  })),
  variant("username-page", ({ username }) => ({
    username,
    page: "1",
    pageNo: "1",
    pageNum: "1",
    pageSize: "20",
    limit: "20",
    size: "20",
  })),
  variant("empty", () => ({})),
];

export const ENDPOINT_CANDIDATES: readonly EndpointCandidate[] = [
  ...fixedDeviceCandidates(),
  ...matrixCandidates("maintenance", maintenancePaths(), COMMON_BODY_VARIANTS),
  ...matrixCandidates("messages", messagePaths(), PAGED_BODY_VARIANTS),
  ...matrixCandidates("map", mapPaths(), COMMON_BODY_VARIANTS),
  ...matrixCandidates("rooms", roomPaths(), COMMON_BODY_VARIANTS),
];

export function filterEndpointCandidates(group: string | undefined): EndpointCandidate[] {
  if (!group || group === "all") {
    return [...ENDPOINT_CANDIDATES];
  }
  if (!isEndpointGroup(group)) {
    throw new Error(`Unsupported endpoint group ${group}`);
  }
  return ENDPOINT_CANDIDATES.filter((candidate) => candidate.group === group);
}

function fixedDeviceCandidates(): EndpointCandidate[] {
  return [
    candidate("device.get-equips-path.post.username", "device", "POST", ({ username }) => `/user/getEquips/${encodeURIComponent(username)}`, ({ username }) => ({ username }), false),
    candidate("device.get-equips.post.username", "device", "POST", () => "/user/getEquips", ({ username }) => ({ username }), false),
    ...matrixCandidates("device", [
      "/appInit/getSockAddr",
      "/appInit/getDeviceInfo",
      "/appInit/getDevice",
      "/appInit/deviceInfo",
      "/device/getEquip",
      "/device/getInfo",
      "/device/getDeviceInfo",
      "/device/getStatus",
      "/device/status",
      "/equip/getInfo",
      "/equip/getStatus",
      "/robot/getInfo",
      "/robot/getStatus",
    ], COMMON_BODY_VARIANTS),
  ];
}

function matrixCandidates(
  group: EndpointGroup,
  paths: readonly string[],
  bodyVariants: readonly BodyVariant[],
): EndpointCandidate[] {
  const results: EndpointCandidate[] = [];
  const seen = new Set<string>();
  for (const rawPath of paths) {
    const postPath = (context: EndpointContext): string => fillPath(rawPath, context);
    for (const bodyVariant of bodyVariants) {
      const postId = `${pathId(group, rawPath)}.post.${bodyVariant.id}`;
      if (!seen.has(postId)) {
        seen.add(postId);
        results.push(candidate(postId, group, "POST", postPath, bodyVariant.body, true));
      }
    }

    const getId = `${pathId(group, rawPath)}.get`;
    if (!seen.has(getId)) {
      seen.add(getId);
      results.push(candidate(getId, group, "GET", postPath, undefined, true));
    }
  }
  return results;
}

function maintenancePaths(): string[] {
  const explicit = [
    "/appInit/getPartsLife",
    "/device/getPartsLife",
    "/device/getConsumables",
    "/device/getMaterial",
    "/device/getCaseInfo",
    "/device/getExceptionInfo",
    "/consumable/list",
    "/consumable/get",
    "/consumables/get",
  ];
  const prefixes = ["appInit", "device", "equip", "robot", "maintenance", "consumable"];
  const verbs = ["get", "getInfo", "getList", "list", "query"];
  const nouns = [
    "PartsLife",
    "PartLife",
    "Consumables",
    "Consumable",
    "ConsumableInfo",
    "Maintenance",
    "Material",
    "Materials",
    "Supplies",
    "Accessories",
    "Filter",
    "SideBrush",
    "EdgeBrush",
    "MainBrush",
    "Broom",
    "Sensor",
    "DustBag",
    "DustBox",
    "DustCenter",
    "CaseInfo",
    "ExceptionInfo",
  ];
  return unique([
    ...explicit,
    ...prefixes.flatMap((prefix) => verbs.flatMap((verb) => nouns.map((noun) => `/${prefix}/${verb}${noun}`))),
    ...nouns.map((noun) => `/${decapitalize(noun)}/get`),
    ...nouns.map((noun) => `/${decapitalize(noun)}/list`),
    "/device/{sn}/partsLife",
    "/device/{sn}/consumables",
    "/device/{sn}/maintenance",
  ]);
}

function messagePaths(): string[] {
  const explicit = [
    "/message/list",
    "/message/getMessageList",
    "/message/getMsgList",
    "/notice/list",
    "/notice/getNoticeList",
    "/push/list",
    "/push/getMessageList",
    "/alarm/list",
    "/event/list",
    "/user/getMessage",
    "/user/getMessages",
    "/user/getMsg",
    "/user/getMsgs",
    "/user/getNotice",
    "/user/getNotices",
    "/user/getPushMsg",
    "/user/getPushMsgs",
  ];
  const prefixes = ["user", "app", "appInit", "device", "message", "msg", "notice", "push", "event"];
  const verbs = ["get", "getList", "list", "query", "getMessageList", "getMsgList", "getNoticeList"];
  const nouns = [
    "Message",
    "Messages",
    "Msg",
    "Notice",
    "Notices",
    "Notify",
    "Notification",
    "Notifications",
    "Push",
    "PushMsg",
    "Alarm",
    "Event",
    "Events",
    "Case",
    "Exception",
  ];
  return unique([
    ...explicit,
    ...prefixes.flatMap((prefix) => verbs.flatMap((verb) => nouns.map((noun) => `/${prefix}/${verb}${noun}`))),
    ...nouns.map((noun) => `/${decapitalize(noun)}/list`),
    ...nouns.map((noun) => `/${decapitalize(noun)}/getList`),
    "/message/{sn}/list",
    "/notice/{sn}/list",
    "/push/{sn}/list",
    "/event/{sn}/list",
    "/alarm/{sn}/list",
  ]);
}

function mapPaths(): string[] {
  return [
    "/appInit/getMap",
    "/appInit/getMapInfo",
    "/appInit/getMapData",
    "/map/get",
    "/map/getMap",
    "/map/getInfo",
    "/map/getMapInfo",
    "/map/getData",
    "/map/getMapData",
    "/device/getMap",
    "/device/getMapInfo",
  ];
}

function roomPaths(): string[] {
  return [
    "/appInit/getAreas",
    "/appInit/getArea",
    "/appInit/getRooms",
    "/appInit/getRoom",
    "/area/get",
    "/area/list",
    "/area/getList",
    "/area/getAreas",
    "/area/getAreaList",
    "/room/get",
    "/room/list",
    "/room/getList",
    "/room/getRooms",
    "/room/getRoomList",
    "/zone/get",
    "/zone/list",
    "/zone/getList",
    "/zone/getZones",
    "/zone/getZoneList",
    "/partition/get",
    "/partition/list",
    "/partition/getList",
  ];
}

function candidate(
  id: string,
  group: EndpointGroup,
  method: "GET" | "POST",
  path: EndpointCandidate["path"],
  body: EndpointCandidate["body"],
  token: boolean,
): EndpointCandidate {
  return { id, group, method, path, body, token };
}

function variant(id: string, body: BodyVariant["body"]): BodyVariant {
  return { id, body };
}

function fillPath(path: string, context: EndpointContext): string {
  return path.replaceAll("{sn}", encodeURIComponent(context.serial)).replaceAll("{username}", encodeURIComponent(context.username));
}

function pathId(group: EndpointGroup, path: string): string {
  return `${group}${path.replaceAll("{sn}", "sn").replaceAll("{username}", "username").replaceAll("/", ".").replace(/[^a-z0-9_.-]/giu, "-")}`;
}

function decapitalize(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isEndpointGroup(value: string): value is EndpointGroup {
  return value === "device" || value === "maintenance" || value === "messages" || value === "map" || value === "rooms";
}
