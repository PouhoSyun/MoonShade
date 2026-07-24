import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function loadEnvFile(filePath) {
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(join(__dirname, ".env"));

const PUBLIC_DIR = join(__dirname, "public");
const DATA_FILE = process.env.MOONSHADE_DATA_FILE || join(__dirname, "data", "moonshade.json");
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = normalizeEmail(process.env.MOONSHADE_ADMIN_EMAIL || "moodylitchee@stu.pku.edu.cn");
const ADMIN_PASSWORD = process.env.MOONSHADE_ADMIN_PASSWORD || "moodylitchee";
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const REQUIRE_SECURE_ADMIN_PASSWORD = process.env.NODE_ENV === "production" || process.env.MOONSHADE_REQUIRE_SECURE_ADMIN === "1";
const ALLOW_DEV_CODE = envBool(process.env.MOONSHADE_ALLOW_DEV_CODE, IS_DEVELOPMENT);
const DAILY_MATCH_ALGORITHM_VERSION = "daily-weight-v4-soft-gates";
const ALLOWED_SCHOOL_TYPES = ["北京大学", "中国人民大学"];
const ALLOWED_EMAIL_MESSAGE = "仅支持 10 位数字 + @stu.pku.edu.cn、10 位数字 + @pku.edu.cn，或 10 位数字 + @ruc.edu.cn 邮箱。";
const PKU_LOCATIONS = ["燕园", "马池口", "学院路", "大兴", "万柳", "西山口", "统军庄", "医院系统", "深圳", "牛津", "校外"];
const RUC_LOCATIONS = ["海淀", "通州", "苏州"];
const ALLOWED_LOCATIONS = [...PKU_LOCATIONS, ...RUC_LOCATIONS];
const LOCATION_ALIASES = {
  人民医院: "医院系统",
  第一医院: "医院系统",
  第三医院: "医院系统",
  第六医院: "医院系统",
  国际医院: "医院系统"
};

if (REQUIRE_SECURE_ADMIN_PASSWORD && !process.env.MOONSHADE_ADMIN_PASSWORD) {
  throw new Error("生产环境必须设置 MOONSHADE_ADMIN_PASSWORD，不能使用默认管理员密码。");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const rateBuckets = new Map();
const VERIFICATION_WINDOW_MS = 10 * 60_000;
const VERIFICATION_LIMIT = 2;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_FAILURE_LIMIT = 5;
const CHECK_EMAIL_WINDOW_MS = 10 * 60_000;
const CHECK_EMAIL_LIMIT = 20;

function securityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    ...extra
  };
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
}

function rateKey(scope, type, value) {
  return `${scope}:${type}:${String(value || "unknown").toLowerCase()}`;
}

function pruneBucket(key, now, windowMs) {
  const bucket = rateBuckets.get(key) || [];
  const fresh = bucket.filter(item => now - item < windowMs);
  if (fresh.length) {
    rateBuckets.set(key, fresh);
  } else {
    rateBuckets.delete(key);
  }
  return fresh;
}

function rateStatus(keys, windowMs, max, now = Date.now()) {
  let retryAfterMs = 0;
  for (const key of keys) {
    const bucket = pruneBucket(key, now, windowMs);
    if (bucket.length >= max) {
      retryAfterMs = Math.max(retryAfterMs, windowMs - (now - bucket[0]));
    }
  }
  return {
    limited: retryAfterMs > 0,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
  };
}

function recordRate(keys, windowMs, now = Date.now()) {
  for (const key of keys) {
    const bucket = pruneBucket(key, now, windowMs);
    bucket.push(now);
    rateBuckets.set(key, bucket);
  }
}

function clearRate(keys) {
  keys.forEach(key => rateBuckets.delete(key));
}

function authLimiterKeys(req, email, scope) {
  return [
    rateKey(scope, "ip", clientIp(req)),
    rateKey(scope, "email", normalizeEmail(email))
  ];
}

function sendRateLimit(res, status) {
  res.writeHead(429, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(status.retryAfterSeconds)
  }));
  res.end(JSON.stringify({ error: `请求过于频繁，请 ${status.retryAfterSeconds} 秒后再试。` }));
}

const defaultData = {
  profiles: [],
  users: [],
  verifications: [],
  adminSessions: [],
  userSessions: [],
  matches: [],
  settings: {
    matchIntervalDays: 3,
    matchWindowNote: "原则上每三天进行一次匹配；实际频率会受用户画像分布、性别比例与偏好宽窄影响。"
  },
  announcements: [
    {
      id: "welcome",
      title: "MoonShade 内测开放",
      body: "本轮先开放基础问卷与自动匹配。问卷题目会逐步增加，已提交的信息可随时更新。"
    }
  ],
  community: {
    wechatQrImage: "",
    updatedAt: ""
  }
};

async function ensureDataFile() {
  await mkdir(join(__dirname, "data"), { recursive: true });
  try {
    await stat(DATA_FILE);
  } catch {
    await writeJson(DATA_FILE, defaultData);
  }
}

async function readJson(file) {
  const raw = await readFile(file, "utf8");
  return normalizeData(JSON.parse(raw));
}

async function writeJson(file, value) {
  await mkdir(join(file, ".."), { recursive: true }).catch(() => {});
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }));
  res.end(body);
}

function sendJsonDownload(res, payload, filename) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(200, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store"
  }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 3_000_000) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function cleanText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function normalizeDiscipline(value) {
  return cleanText(value, 40) === "经管法" ? "经管" : cleanText(value, 40);
}

function normalizeDisciplineList(value) {
  return cleanList(value).map(normalizeDiscipline).filter(Boolean);
}

function normalizeData(data) {
  const profiles = Array.isArray(data.profiles) ? data.profiles.map(profile => ({
    ...profile,
    matchPaused: profile.matchPaused === true,
    matchPausedAt: cleanText(profile.matchPausedAt, 40),
    discipline: normalizeDiscipline(profile.discipline),
    department: normalizeDiscipline(profile.department),
    idealDisciplines: normalizeDisciplineList(profile.idealDisciplines),
    location: cleanLocationList(profile.location),
    idealLocations: cleanLocationList(profile.idealLocations)
  })) : [];
  return {
    ...defaultData,
    ...data,
    profiles,
    users: Array.isArray(data.users) ? data.users : [],
    verifications: Array.isArray(data.verifications) ? data.verifications : [],
    adminSessions: Array.isArray(data.adminSessions) ? data.adminSessions : [],
    userSessions: Array.isArray(data.userSessions) ? data.userSessions : [],
    matches: Array.isArray(data.matches) ? data.matches : [],
    settings: {
      ...defaultData.settings,
      ...(data.settings && typeof data.settings === "object" ? data.settings : {})
    },
    announcements: Array.isArray(data.announcements) ? data.announcements : defaultData.announcements,
    community: {
      ...defaultData.community,
      ...(data.community && typeof data.community === "object" ? data.community : {})
    }
  };
}

function normalizeEmail(email) {
  return cleanText(email, 120).toLowerCase();
}

function isAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized === ADMIN_EMAIL) return true;
  return /^\d{10}@(stu\.)?pku\.edu\.cn$/.test(normalized) || /^\d{10}@ruc\.edu\.cn$/.test(normalized);
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored = "") {
  const [salt, expected] = String(stored).split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

function envValue(...names) {
  return names.map(name => process.env[name]).find(value => value !== undefined && value !== "");
}

function envBool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf8").toString("base64")}?=`;
}

function formatEmailAddress(email, name = "") {
  return name ? `${encodeMimeHeader(name)} <${email}>` : email;
}

function escapeSmtpDataLine(line) {
  return line.startsWith(".") ? `.${line}` : line;
}

async function sendSmtpMail({ to, subject, text }) {
  const host = envValue("MOONSHADE_SMTP_HOST", "SMTP_HOST");
  const user = envValue("MOONSHADE_SMTP_USER", "SMTP_USER");
  const pass = envValue("MOONSHADE_SMTP_PASS", "SMTP_PASS");
  const from = envValue("MOONSHADE_SMTP_FROM", "SMTP_FROM") || user;
  const fromName = envValue("MOONSHADE_SMTP_FROM_NAME", "SMTP_FROM_NAME") || "MoonShade";
  const secure = envBool(envValue("MOONSHADE_SMTP_SECURE", "SMTP_SECURE"), false);
  const startTls = envBool(envValue("MOONSHADE_SMTP_STARTTLS", "SMTP_STARTTLS"), !secure);
  const port = Number(envValue("MOONSHADE_SMTP_PORT", "SMTP_PORT") || (secure ? 465 : 587));
  const helloName = envValue("MOONSHADE_SMTP_HELO", "SMTP_HELO") || "moonshade.local";

  if (!host || !from) {
    throw new Error("SMTP 未配置：请设置 MOONSHADE_SMTP_HOST 和 MOONSHADE_SMTP_FROM。");
  }

  let socket;
  let buffer = "";
  let closed = false;
  let pendingResponse = null;

  function parseResponses() {
    if (!pendingResponse) return;
    const lines = buffer.split(/\r?\n/);
    if (buffer && !/\r?\n$/.test(buffer)) {
      buffer = lines.pop();
    } else {
      buffer = "";
      if (lines.at(-1) === "") lines.pop();
    }
    if (!lines.length) return;
    pendingResponse.lines.push(...lines);
    const doneIndex = pendingResponse.lines.findIndex(line => /^\d{3} /.test(line));
    if (doneIndex === -1) return;
    const responseLines = pendingResponse.lines.splice(0, doneIndex + 1);
    const code = Number(responseLines.at(-1).slice(0, 3));
    const { resolve } = pendingResponse;
    pendingResponse = null;
    resolve({ code, lines: responseLines });
    if (pendingResponse) parseResponses();
  }

  function attachSocket(nextSocket) {
    socket = nextSocket;
    socket.setEncoding("utf8");
    socket.setTimeout(15_000);
    socket.on("data", chunk => {
      buffer += chunk;
      parseResponses();
    });
    socket.on("error", error => {
      if (pendingResponse) {
        const { reject } = pendingResponse;
        pendingResponse = null;
        reject(error);
      }
    });
    socket.on("timeout", () => socket.destroy(new Error("SMTP 连接超时。")));
    socket.on("close", () => {
      closed = true;
    });
  }

  function readResponse() {
    if (pendingResponse) throw new Error("SMTP 协议状态异常：仍有响应未读取。");
    return new Promise((resolve, reject) => {
      pendingResponse = { lines: [], resolve, reject };
      parseResponses();
    });
  }

  function expect(response, expectedCodes, commandName) {
    const expected = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
    if (!expected.includes(response.code)) {
      throw new Error(`${commandName} 失败：${response.lines.join(" | ")}`);
    }
    return response;
  }

  async function command(line, expectedCodes) {
    if (closed) throw new Error("SMTP 连接已关闭。");
    socket.write(`${line}\r\n`);
    return expect(await readResponse(), expectedCodes, line.split(" ")[0]);
  }

  await new Promise((resolve, reject) => {
    const nextSocket = secure
      ? tls.connect({ host, port, servername: host }, resolve)
      : net.createConnection({ host, port }, resolve);
    nextSocket.on("error", reject);
    attachSocket(nextSocket);
  });

  try {
    expect(await readResponse(), 220, "CONNECT");
    await command(`EHLO ${helloName}`, 250);

    if (!secure && startTls) {
      await command("STARTTLS", 220);
      buffer = "";
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      socket.removeAllListeners("timeout");
      socket.removeAllListeners("close");
      await new Promise((resolve, reject) => {
        const tlsSocket = tls.connect({ socket, servername: host }, resolve);
        tlsSocket.on("error", reject);
        attachSocket(tlsSocket);
      });
      await command(`EHLO ${helloName}`, 250);
    }

    if (user && pass) {
      await command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64")}`, [235, 503]);
    }

    await command(`MAIL FROM:<${from}>`, 250);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", 354);

    const message = [
      `From: ${formatEmailAddress(from, fromName)}`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      ...text.replace(/\r\n/g, "\n").split("\n").map(escapeSmtpDataLine)
    ].join("\r\n");
    socket.write(`${message}\r\n.\r\n`);
    await expect(await readResponse(), 250, "DATA body");
    await command("QUIT", 221).catch(() => {});
  } finally {
    socket.end();
  }
}

async function sendVerificationEmail(email, code) {
  const subject = "MoonShade 校内邮箱验证码";
  const body = `你的 MoonShade 验证码是：${code}\n\n10 分钟内有效。若非本人操作，请忽略这封邮件。`;
  if (process.env.MOONSHADE_MAIL_TRANSPORT === "smtp") {
    await sendSmtpMail({ to: email, subject, text: body });
    return { delivered: true };
  } else if (process.env.MOONSHADE_MAIL_TRANSPORT === "sendmail") {
    const command = process.env.SENDMAIL_PATH || "sendmail";
    await new Promise((resolve, reject) => {
      const child = spawn(command, ["-t"], { stdio: ["pipe", "ignore", "pipe"] });
      let error = "";
      child.stderr.on("data", chunk => { error += chunk; });
      child.on("close", codeValue => codeValue === 0 ? resolve() : reject(new Error(error || `sendmail exited ${codeValue}`)));
      child.stdin.end(`To: ${email}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`);
    });
    return { delivered: true };
  } else {
    if (!ALLOW_DEV_CODE) {
      throw new Error("邮件服务未配置：请设置 SMTP/sendmail，或仅在本地开发时启用 MOONSHADE_ALLOW_DEV_CODE=1。");
    }
    console.log(`[MoonShade verification] ${email}: ${code}`);
    return { delivered: false, devCode: code };
  }
}

function getUserBySession(data, token) {
  const session = data.userSessions.find(item => item.token === token && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  if (session.email === ADMIN_EMAIL) {
    return { id: "admin", email: ADMIN_EMAIL, verifiedAt: new Date().toISOString(), role: "admin" };
  }
  return data.users.find(user => user.email === session.email) || null;
}

function requireAdmin(data, token) {
  return data.adminSessions.some(item => item.token === token && new Date(item.expiresAt) > new Date());
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requestToken(req, url, body = {}, key = "authToken") {
  return bearerToken(req) || body[key] || url.searchParams.get(key) || "";
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = new Set([
    `https://${req.headers.host}`,
    `http://${req.headers.host}`,
    ...(process.env.MOONSHADE_ALLOWED_ORIGINS || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  ]);
  return allowed.has(origin);
}

function cleanList(value, allowed = []) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map(item => String(item || "").trim()).filter(Boolean))]
    .filter(item => allowed.length === 0 || allowed.includes(item));
}

function normalizeLocation(value) {
  const clean = cleanText(value, 40);
  return LOCATION_ALIASES[clean] || clean;
}

function cleanLocationList(value) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map(normalizeLocation).filter(Boolean))]
    .filter(item => ALLOWED_LOCATIONS.includes(item));
}

function cleanMetricMap(value = {}, multi = false) {
  const source = value && typeof value === "object" ? value : {};
  const keys = ["warmth", "ambition", "decision", "novelty", "schedule", "marriage", "fertility"];
  return Object.fromEntries(keys.map(key => {
    if (multi) {
      const numbers = cleanList(source[key]).map(Number).filter(item => Number.isInteger(item) && item >= -3 && item <= 3);
      return [key, [...new Set(numbers)]];
    }
    const number = Number(source[key]);
    return [key, Number.isInteger(number) && number >= -3 && number <= 3 ? number : null];
  }));
}

function cleanHeight(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 140 && number <= 210 ? number : null;
}

function cleanMonthlyExpense(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 1000 && number <= 5000 ? number : null;
}

function cleanMbtiMap(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const keys = ["ei", "sn", "tf", "jp"];
  return Object.fromEntries(keys.map(key => {
    const number = Number(source[key]);
    return [key, Number.isInteger(number) && number >= -3 && number <= 3 ? number : 0];
  }));
}

const provinceRegions = {
  华北: ["北京", "天津", "河北", "山西", "内蒙古"],
  东北: ["辽宁", "吉林", "黑龙江"],
  华东: ["上海", "江苏", "浙江", "安徽", "福建", "江西", "山东"],
  华中: ["河南", "湖北", "湖南"],
  华南: ["广东", "广西", "海南"],
  西南: ["重庆", "四川", "贵州", "云南", "西藏"],
  西北: ["陕西", "甘肃", "青海", "宁夏", "新疆"],
  港澳台: ["香港", "澳门", "台湾"]
};

function regionForProvince(province) {
  return Object.entries(provinceRegions).find(([, provinces]) => provinces.includes(province))?.[0] || "";
}

function cleanSettings(input = {}) {
  const interval = Number.parseInt(input.matchIntervalDays, 10);
  return {
    matchIntervalDays: Number.isInteger(interval) && interval >= 1 && interval <= 14 ? interval : defaultData.settings.matchIntervalDays,
    matchWindowNote: cleanText(input.matchWindowNote || defaultData.settings.matchWindowNote, 240)
  };
}

function cleanAnnouncement(input = {}, existing = {}) {
  return {
    id: existing.id || cleanText(input.id, 80) || crypto.randomUUID(),
    title: cleanText(input.title, 60),
    body: cleanText(input.body, 300)
  };
}

function cleanCommunity(input = {}, existing = defaultData.community) {
  const image = cleanText(input.wechatQrImage, 2_000_000);
  if (image && !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    throw new Error("请上传 PNG、JPG 或 WebP 格式的二维码图片。");
  }
  if (image && image.length > 1_600_000) {
    throw new Error("二维码图片太大，请压缩后再上传。");
  }
  return {
    ...existing,
    wechatQrImage: image,
    updatedAt: image ? new Date().toISOString() : ""
  };
}

function isActiveProfile(profile) {
  return Boolean(profile?.consent) && profile.matchPaused !== true;
}

const currentIntimacyOptions = ["开放态度", "关系决定", "暂无打算", "柏拉图式"];
const currentIntimacyTimingOptions = ["不接受", "婚后", "关系稳定后", "相熟数月后", "可以自然发生"];
const currentSocialBoundaryOptions = ["开放性", "保持现状", "排他性"];
const interestFieldNames = ["sportsInterests", "musicInterests", "movieInterests", "travelInterests", "readingInterests", "skillInterests", "gameInterests", "otherInterests"];

function hasCurrentOption(value, allowed) {
  return allowed.includes(value);
}

function hasCurrentOptionList(value, allowed) {
  const list = Array.isArray(value) ? value : [];
  return list.length > 0 && list.every(item => allowed.includes(item));
}

function cleanInterestList(value) {
  return cleanList(value).map(item => cleanText(item, 40)).filter(Boolean).slice(0, 5);
}

function currentRound(now = new Date(), settings = defaultData.settings) {
  const clean = cleanSettings(settings);
  const intervalMs = clean.matchIntervalDays * 86_400_000;
  const anchor = Date.UTC(2026, 0, 1, 12, 0, 0, 0);
  const currentTime = now.getTime();
  const elapsed = Math.max(0, currentTime - anchor);
  const index = Math.floor(elapsed / intervalMs);
  const open = new Date(anchor + index * intervalMs);
  const next = new Date(open.getTime() + intervalMs);
  if (next <= now) {
    open.setTime(open.getTime() + intervalMs);
    next.setTime(next.getTime() + intervalMs);
  }
  const resultAt = new Date(next);
  resultAt.setHours(20, 0, 0, 0);

  const id = open.toISOString().slice(0, 10);
  return {
    id,
    label: `${open.toISOString().slice(0, 10)} 至 ${next.toISOString().slice(0, 10)}`,
    opensAt: open.toISOString(),
    closesAt: next.toISOString(),
    resultsAt: resultAt.toISOString(),
    intervalDays: clean.matchIntervalDays,
    note: clean.matchWindowNote
  };
}

function sanitizeProfile(input, existing = {}, settings = defaultData.settings) {
  const allowedGenders = ["女", "男", "非二元", "暂不透露"];
  const allowedSeek = ["女", "男", "非二元", "不限"];
  const allowedIdentities = ["本科生", "硕士生", "博士生", "毕业工作", "自由探索"];
  const allowedSchoolTypes = ALLOWED_SCHOOL_TYPES;
  const allowedProvinces = ["北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "香港", "澳门", "台湾", "海外"];
  const allowedRegions = ["华北", "东北", "华东", "华中", "华南", "西南", "西北", "港澳台"];
  const allowedHomeAreas = ["直辖市/省会/首府/计划单列市", "地级市/州府/公署驻地", "其他城市化地区", "乡村", "流动成长"];
  const allowedDisciplines = ["理学", "工学", "人文", "社科", "医学", "经管", "艺术体育", "其他"];
  const allowedIntent = ["快速转进", "认真发展", "先交朋友", "慢慢了解"];
  const allowedTempo = ["高频交流", "日常分享", "低频稳定", "线下优先"];
  const allowedWeekend = ["外出旅行", "散步游览", "朋友聚会", "运动户外", "自习工作", "做饭探店", "球番剧竞"];
  const allowedDietaryPreferences = ["喜辣", "喜甜", "喜咸", "清淡", "清真"];
  const allowedValues = ["坦诚表达", "边界清晰", "共同成长", "情绪稳定", "生活有序", "保持好奇"];
  const allowedStyle = ["清冷", "学院", "运动", "中式", "正式", "休闲", "文艺", "优雅", "性感", "日系", "欧美", "复古", "哥特"];
  const allowedHair = ["短发", "中长发", "长发", "不设偏好"];
  const allowedGlasses = ["常戴", "偶尔戴", "基本不戴", "不设偏好"];
  const allowedAppearanceFeel = ["成熟", "同龄", "少年", "不明显", "不设偏好"];

  return {
    id: existing.id || crypto.randomUUID(),
    token: existing.token || crypto.randomBytes(24).toString("hex"),
    roundId: currentRound(new Date(), settings).id,
    displayName: cleanText(input.displayName, 40),
    email: normalizeEmail(existing.email || input.email),
    birthYear: Number.parseInt(input.birthYear, 10) || null,
    idealBirthYearMin: Number.parseInt(input.idealBirthYearMin, 10) || null,
    idealBirthYearMax: Number.parseInt(input.idealBirthYearMax, 10) || null,
    age: Number.parseInt(input.age, 10) || null,
    gender: allowedGenders.includes(input.gender) ? input.gender : "",
    seeking: cleanList(input.seeking, allowedSeek),
    city: cleanText(input.city || cleanLocationList(input.location).join("、"), 40),
    school: allowedSchoolTypes.includes(input.schoolType) ? input.schoolType : "",
    department: normalizeDiscipline(input.department || input.discipline),
    stage: cleanText(input.stage || input.identity, 40),
    identity: allowedIdentities.includes(input.identity) ? input.identity : "",
    idealIdentities: cleanList(input.idealIdentities, allowedIdentities),
    schoolType: allowedSchoolTypes.includes(input.schoolType) ? input.schoolType : "",
    idealSchoolTypes: cleanList(input.idealSchoolTypes, allowedSchoolTypes),
    location: cleanLocationList(input.location),
    idealLocations: cleanLocationList(input.idealLocations),
    hometownProvince: allowedProvinces.includes(input.hometownProvince) ? input.hometownProvince : "",
    idealHometownRegions: cleanList(input.idealHometownRegions, allowedRegions),
    homeArea: allowedHomeAreas.includes(input.homeArea) ? input.homeArea : "",
    idealHomeAreas: cleanList(input.idealHomeAreas, allowedHomeAreas),
    discipline: allowedDisciplines.includes(normalizeDiscipline(input.discipline)) ? normalizeDiscipline(input.discipline) : "",
    idealDisciplines: normalizeDisciplineList(input.idealDisciplines).filter(item => allowedDisciplines.includes(item)),
    intent: allowedIntent.includes(input.intent) ? input.intent : "",
    idealIntent: cleanList(input.idealIntent, allowedIntent),
    tempo: allowedTempo.includes(input.tempo) ? input.tempo : "",
    idealTempo: cleanList(input.idealTempo, allowedTempo),
    intimacy: currentIntimacyOptions.includes(input.intimacy) ? input.intimacy : "",
    idealIntimacy: cleanList(input.idealIntimacy, currentIntimacyOptions),
    intimacyTiming: currentIntimacyTimingOptions.includes(input.intimacyTiming) ? input.intimacyTiming : "",
    idealIntimacyTiming: cleanList(input.idealIntimacyTiming, currentIntimacyTimingOptions),
    socialBoundary: currentSocialBoundaryOptions.includes(input.socialBoundary) ? input.socialBoundary : (existing.socialBoundary || ""),
    idealSocialBoundary: cleanList(input.idealSocialBoundary || existing.idealSocialBoundary, currentSocialBoundaryOptions),
    weekend: cleanList(input.weekend || input.selfWeekends, allowedWeekend),
    dietaryPreferences: cleanList(input.dietaryPreferences, allowedDietaryPreferences),
    monthlyExpense: cleanMonthlyExpense(input.monthlyExpense),
    ...Object.fromEntries(interestFieldNames.map(field => [field, cleanInterestList(input[field])])),
    otherInterestText: cleanText(input.otherInterestText, 300),
    values: cleanList(input.values || input.selfValues || existing.values || existing.selfValues, allowedValues),
    selfWeekends: cleanList(input.selfWeekends || input.weekend, allowedWeekend),
    idealWeekends: cleanList(input.idealWeekends, allowedWeekend),
    selfValues: cleanList(input.selfValues || input.values || existing.selfValues || existing.values, allowedValues),
    idealValues: cleanList(input.idealValues || existing.idealValues, allowedValues),
    selfStyle: cleanList(input.selfStyle, allowedStyle),
    idealStyle: cleanList(input.idealStyle, allowedStyle),
    hair: allowedHair.includes(input.hair) ? input.hair : "",
    idealHair: cleanList(input.idealHair, allowedHair),
    glasses: allowedGlasses.includes(input.glasses) ? input.glasses : "",
    idealGlasses: cleanList(input.idealGlasses, allowedGlasses),
    appearanceFeel: allowedAppearanceFeel.includes(input.appearanceFeel) ? input.appearanceFeel : "",
    idealAppearanceFeel: cleanList(input.idealAppearanceFeel, allowedAppearanceFeel),
    selfMetrics: cleanMetricMap(input.selfMetrics, false),
    idealMetrics: cleanMetricMap(input.idealMetrics, false),
    mbtiMetrics: cleanMbtiMap(input.mbtiMetrics),
    idealMbtiMetrics: cleanMbtiMap(input.idealMbtiMetrics),
    height: cleanHeight(input.height),
    idealHeight: cleanHeight(input.idealHeight),
    mbti: cleanText(input.mbti, 8).toUpperCase(),
    selfIntro: cleanText(input.selfIntro, 600),
    contactType: "微信",
    contactValue: cleanText(input.contactValue, 120),
    consent: input.consent === true,
    matchPaused: existing.matchPaused === true,
    matchPausedAt: existing.matchPausedAt || "",
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function validateProfile(profile) {
  const missing = [];
  if (!profile.displayName) missing.push("展示名");
  if (!profile.gender) missing.push("我的性别");
  if (profile.seeking.length === 0) missing.push("希望匹配的对象性别");
  if (!profile.birthYear && !profile.age) missing.push("出生年");
  if (!profile.identity && !profile.stage) missing.push("目前身份");
  if (!ALLOWED_SCHOOL_TYPES.includes(profile.schoolType)) missing.push("院校背景");
  if ((!Array.isArray(profile.location) || profile.location.length === 0) && !profile.city) missing.push("所在校区");
  if (!profile.intent) missing.push("匹配期待");
  if (!profile.tempo) missing.push("沟通节奏");
  if (!hasCurrentOption(profile.intimacy, currentIntimacyOptions)) missing.push("恋爱接受程度");
  if (!hasCurrentOptionList(profile.idealIntimacy, currentIntimacyOptions)) missing.push("希望对方的边界");
  if (!hasCurrentOption(profile.intimacyTiming, currentIntimacyTimingOptions)) missing.push("对亲密关系态度");
  if (!hasCurrentOptionList(profile.idealIntimacyTiming, currentIntimacyTimingOptions)) missing.push("可接受发生时间");
  if (!hasCurrentOption(profile.socialBoundary, currentSocialBoundaryOptions)) missing.push("恋爱后交际圈边界");
  if (!hasCurrentOptionList(profile.idealSocialBoundary, currentSocialBoundaryOptions)) missing.push("可接受对方交际圈边界");
  if (!Number.isInteger(profile.selfMetrics?.marriage)) missing.push("我的婚姻意向");
  if (!Number.isInteger(profile.idealMetrics?.marriage)) missing.push("期待对方的婚姻意向");
  if (!Number.isInteger(profile.selfMetrics?.fertility)) missing.push("我的生育意向");
  if (!Number.isInteger(profile.idealMetrics?.fertility)) missing.push("期待对方的生育意向");
  if (!profile.contactValue) missing.push("联系方式");
  if (!profile.consent) missing.push("授权参与本轮匹配");
  return missing;
}

function profileCompleteness(profile) {
  const checks = [
    Boolean(profile.displayName),
    Boolean(profile.gender),
    profile.seeking?.length > 0,
    Boolean(profile.birthYear || profile.age),
    Boolean(profile.identity || profile.stage),
    ALLOWED_SCHOOL_TYPES.includes(profile.schoolType),
    Boolean(profile.location?.length || profile.city),
    Boolean(profile.intent),
    Boolean(profile.tempo),
    hasCurrentOption(profile.intimacy, currentIntimacyOptions),
    hasCurrentOptionList(profile.idealIntimacy, currentIntimacyOptions),
    hasCurrentOption(profile.intimacyTiming, currentIntimacyTimingOptions),
    hasCurrentOptionList(profile.idealIntimacyTiming, currentIntimacyTimingOptions),
    hasCurrentOption(profile.socialBoundary, currentSocialBoundaryOptions),
    hasCurrentOptionList(profile.idealSocialBoundary, currentSocialBoundaryOptions),
    Number.isInteger(profile.selfMetrics?.marriage),
    Number.isInteger(profile.idealMetrics?.marriage),
    Number.isInteger(profile.selfMetrics?.fertility),
    Number.isInteger(profile.idealMetrics?.fertility),
    Boolean(profile.contactValue),
    profile.consent === true
  ];
  const filled = checks.filter(Boolean).length;
  return {
    filled,
    total: checks.length,
    ratio: checks.length ? filled / checks.length : 0
  };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundWeight(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function localDayStartMs(value = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDateKey(value = Date.now()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDaysSince(fromMs, now = Date.now()) {
  const fromStart = localDayStartMs(fromMs);
  const nowStart = localDayStartMs(now);
  if (fromStart === null || nowStart === null) return null;
  return Math.max(0, Math.floor((nowStart - fromStart) / 86_400_000));
}

function remapCoefficient(value) {
  const x = clampNumber(Number(value) || 0, 0, 1);
  return roundWeight(-x * x + 2 * x);
}

const precisionMultiselectFields = [
  { key: "seeking", total: 4 },
  { key: "idealLocations", total: ALLOWED_LOCATIONS.length },
  { key: "idealHometownRegions", total: 8 },
  { key: "idealHomeAreas", total: 5 },
  { key: "idealDisciplines", total: 8 },
  { key: "idealIntent", total: 4 },
  { key: "idealTempo", total: 4 },
  { key: "idealIntimacy", total: currentIntimacyOptions.length },
  { key: "idealIntimacyTiming", total: currentIntimacyTimingOptions.length },
  { key: "idealSocialBoundary", total: currentSocialBoundaryOptions.length },
  { key: "idealWeekends", total: 7 },
  { key: "idealStyle", total: 13 },
  { key: "idealAppearanceFeel", total: 5 },
  { key: "idealHair", total: 4 },
  { key: "idealGlasses", total: 4 }
];

const scarcitySingleFields = [
  "identity",
  "hometownProvince",
  "homeArea",
  "discipline",
  "intent",
  "tempo",
  "intimacy",
  "intimacyTiming",
  "socialBoundary"
];

function multiselectSpecificity(value, total) {
  const list = asList(value);
  if (!list.length || !total) return 0;
  if (list.includes("不限") || list.includes("不设偏好")) return 0.08;
  if (total <= 1) return 1;
  return clampNumber(1 - (Math.min(list.length, total) - 1) / (total - 1), 0, 1);
}

function yearRangeSpecificity(profile) {
  const min = Number.isInteger(profile.idealBirthYearMin) ? profile.idealBirthYearMin : 1990;
  const max = Number.isInteger(profile.idealBirthYearMax) ? profile.idealBirthYearMax : 2010;
  if (!Number.isInteger(profile.idealBirthYearMin) && !Number.isInteger(profile.idealBirthYearMax)) return 0;
  const width = Math.max(1, Math.min(21, Math.abs(max - min) + 1));
  return clampNumber(1 - (width - 1) / 20, 0, 1);
}

function rawPrecisionRatio(profile) {
  const scores = precisionMultiselectFields.map(({ key, total }) => {
    return multiselectSpecificity(profile[key], total);
  });
  scores.push(yearRangeSpecificity(profile));
  const average = scores.length ? scores.reduce((sum, item) => sum + item, 0) / scores.length : 0;
  return roundWeight(average);
}

function gapCoefficient(daysSince) {
  if (daysSince !== null && daysSince !== undefined && daysSince <= 2) return 0;
  const effectiveDays = daysSince === null || daysSince === undefined ? 8 : clampNumber(daysSince, 3, 7);
  return roundWeight(1.15 ** (effectiveDays - 3));
}

function genderRatioCoefficient(profile, profiles = []) {
  const same = profiles.filter(item => item.gender && item.gender === profile.gender).length;
  const compatible = profiles.filter(item => item.id !== profile.id && genderCompatible(profile, item)).length;
  if (!same || !compatible) return 1;
  return roundWeight(clampNumber(compatible / same, 0.55, 1.8));
}

function rawScarcityRatio(profile, profiles = []) {
  const scores = scarcitySingleFields.map(field => {
    const value = profile[field];
    const answered = profiles.filter(item => item[field]).length;
    if (!value || !answered) return null;
    const same = profiles.filter(item => item[field] === value).length;
    return 1 - same / answered;
  }).filter(value => value !== null);
  const average = scores.length ? scores.reduce((sum, item) => sum + item, 0) / scores.length : 0;
  return roundWeight(average);
}

function rankedRatios(entries) {
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const ratios = new Map();
  if (sorted.length <= 1) {
    sorted.forEach(item => ratios.set(item.id, 0.5));
    return ratios;
  }
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].value === sorted[index].value) end += 1;
    const averageIndex = (index + end - 1) / 2;
    const ratio = averageIndex / (sorted.length - 1);
    for (let cursor = index; cursor < end; cursor += 1) {
      ratios.set(sorted[cursor].id, roundWeight(ratio));
    }
    index = end;
  }
  return ratios;
}

function rankedCoefficient(rankRatio) {
  return roundWeight(0.7 + clampNumber(rankRatio, 0, 1) * 0.6);
}

function profileRankContext(profiles = []) {
  const pool = profiles.filter(profile => profile?.id);
  const precisionEntries = pool.map(profile => ({ id: profile.id, value: rawPrecisionRatio(profile) }));
  const scarcityEntries = pool.map(profile => ({ id: profile.id, value: rawScarcityRatio(profile, pool) }));
  const precisionRanks = rankedRatios(precisionEntries);
  const scarcityRanks = rankedRatios(scarcityEntries);
  return {
    precision: new Map(precisionEntries.map(item => {
      const rankRatio = precisionRanks.get(item.id) ?? 0.5;
      return [item.id, { rawRatio: item.value, rankRatio, coefficient: rankedCoefficient(rankRatio) }];
    })),
    scarcity: new Map(scarcityEntries.map(item => {
      const rankRatio = scarcityRanks.get(item.id) ?? 0.5;
      return [item.id, { rawRatio: item.value, rankRatio, coefficient: rankedCoefficient(rankRatio) }];
    }))
  };
}

function profileWeightFactors(profile, profiles, history, now = Date.now(), rankContext = profileRankContext(profiles)) {
  const lastAt = history.lastMatchedAt.get(profile.id) || 0;
  const daysSince = lastAt ? calendarDaysSince(lastAt, now) : null;
  const completeness = profileCompleteness(profile);
  const precisionData = rankContext.precision.get(profile.id) || { rawRatio: rawPrecisionRatio(profile), rankRatio: 0.5, coefficient: 1 };
  const scarcityData = rankContext.scarcity.get(profile.id) || { rawRatio: rawScarcityRatio(profile, profiles), rankRatio: 0.5, coefficient: 1 };
  const clarity = {
    filled: Math.round(precisionData.rawRatio * 100),
    total: 100,
    ratio: precisionData.rankRatio,
    rawRatio: precisionData.rawRatio,
    rankRatio: precisionData.rankRatio
  };
  const completenessCoefficient = remapCoefficient(completeness.ratio);
  const precision = precisionData.coefficient;
  const gap = gapCoefficient(daysSince);
  const genderRatio = genderRatioCoefficient(profile, profiles);
  const scarcity = scarcityData.coefficient;
  const personalWeight = roundWeight(completenessCoefficient * precision * gap * genderRatio * scarcity);
  return {
    daysSince,
    lastAt,
    completeness,
    clarity,
    precisionRawRatio: precisionData.rawRatio,
    precisionRankRatio: precisionData.rankRatio,
    scarcityRawRatio: scarcityData.rawRatio,
    scarcityRankRatio: scarcityData.rankRatio,
    completenessCoefficient,
    precisionCoefficient: precision,
    gapCoefficient: gap,
    genderRatioCoefficient: genderRatio,
    scarcityCoefficient: scarcity,
    personalWeight
  };
}

function genderBaseIntervalDays(profile, profiles = []) {
  const participants = profiles.filter(item => isActiveProfile(item) && item.gender);
  const men = participants.filter(item => item.gender === "男").length;
  const women = participants.filter(item => item.gender === "女").length;
  if (!men || !women || !["男", "女"].includes(profile.gender)) return 5;
  const maleDays = 5 * Math.sqrt(men / women);
  const femaleDays = 5 * Math.sqrt(women / men);
  return profile.gender === "男" ? maleDays : femaleDays;
}

function stableRatio(seed) {
  const hash = crypto.createHash("sha256").update(String(seed)).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

function stableNoiseDays(profile, settings = defaultData.settings) {
  const roundId = currentRound(new Date(), settings).id;
  return roundWeight((stableRatio(`${profile.id}:${roundId}:allocation-noise`) * 2) - 1, 2);
}

function stableReferenceAt(profile, lastAt, now = Date.now()) {
  if (lastAt) return localDayStartMs(lastAt) || lastAt;
  const createdAt = new Date(profile.createdAt || profile.updatedAt || 0).getTime();
  if (createdAt) return localDayStartMs(createdAt) || createdAt;
  return localDayStartMs(now) || now;
}

function expectedAllocationDateMs(profile, profiles, lastAt, personalWeight, settings = defaultData.settings, now = Date.now()) {
  const baseDays = genderBaseIntervalDays(profile, profiles);
  const personalOffset = clampNumber((Number(personalWeight) - 1) * 0.9, -1.25, 1.25);
  const noiseDays = stableNoiseDays(profile, settings);
  const intervalDays = Math.max(2.5, baseDays - personalOffset + noiseDays);
  const referenceAt = stableReferenceAt(profile, lastAt, now);
  return {
    intervalDays: roundWeight(intervalDays, 2),
    expectedAt: referenceAt + intervalDays * 86_400_000,
    baseIntervalDays: roundWeight(baseDays, 2),
    personalOffsetDays: roundWeight(personalOffset, 2),
    noiseDays
  };
}

function publicProfile(profile, context = {}) {
  const frequency = context.frequencyMap?.get(profile.id) || null;
  return {
    id: profile.id,
    displayName: profile.displayName,
    age: profile.age,
    birthYear: profile.birthYear,
    idealBirthYearMin: profile.idealBirthYearMin,
    idealBirthYearMax: profile.idealBirthYearMax,
    gender: profile.gender,
    city: profile.city,
    school: profile.school,
    department: profile.department,
    stage: profile.stage,
    identity: profile.identity,
    schoolType: profile.schoolType,
    location: profile.location,
    hometownProvince: profile.hometownProvince,
    idealHometownRegions: profile.idealHometownRegions,
    homeArea: profile.homeArea,
    discipline: profile.discipline,
    intent: profile.intent,
    tempo: profile.tempo,
    intimacy: profile.intimacy,
    intimacyTiming: profile.intimacyTiming,
    socialBoundary: profile.socialBoundary,
    idealSocialBoundary: profile.idealSocialBoundary,
    weekend: profile.weekend,
    dietaryPreferences: profile.dietaryPreferences,
    monthlyExpense: profile.monthlyExpense,
    ...Object.fromEntries(interestFieldNames.map(field => [field, profile[field] || []])),
    otherInterestText: profile.otherInterestText,
    values: profile.values,
    selfWeekends: profile.selfWeekends,
    selfValues: profile.selfValues,
    selfStyle: profile.selfStyle,
    hair: profile.hair,
    glasses: profile.glasses,
    appearanceFeel: profile.appearanceFeel,
    selfMetrics: profile.selfMetrics,
    idealMetrics: profile.idealMetrics,
    mbtiMetrics: profile.mbtiMetrics,
    idealMbtiMetrics: profile.idealMbtiMetrics,
    height: profile.height,
    idealHeight: profile.idealHeight,
    mbti: profile.mbti,
    selfIntro: profile.selfIntro,
    matchPaused: profile.matchPaused === true,
    matchPausedAt: profile.matchPausedAt || null,
    matchFrequency: frequency ? {
      intervalDays: frequency.intervalDays,
      daysSinceLastMatch: frequency.daysSinceLastMatch,
      completenessRatio: frequency.completenessRatio,
      clarityRatio: frequency.clarityRatio,
      expectedNextAllocationAt: frequency.expectedNextAllocationAt,
      nextEligibleAt: frequency.nextEligibleAt,
      referenceDays: frequency.referenceDays,
      eligible: frequency.eligible,
      genderRank: frequency.genderRank
    } : undefined,
    updatedAt: profile.updatedAt
  };
}

function genderCompatible(a, b) {
  const aSeeking = asList(a.seeking);
  const bSeeking = asList(b.seeking);
  const aOpen = aSeeking.includes("不限");
  const bOpen = bSeeking.includes("不限");
  return (aOpen || aSeeking.includes(b.gender)) && (bOpen || bSeeking.includes(a.gender));
}

function overlapScore(a = [], b = [], weight = 1) {
  const set = new Set(a);
  const hits = b.filter(item => set.has(item)).length;
  return hits * weight;
}

function preferenceScore(actual, acceptable = [], weight = 1) {
  if (!actual || !Array.isArray(acceptable) || acceptable.length === 0) return 0;
  if (acceptable.includes("不设偏好")) return Math.round(weight * 0.6);
  return acceptable.includes(actual) ? weight : 0;
}

function preferenceScoreAny(actual, acceptable = [], weight = 1) {
  const actualList = Array.isArray(actual) ? actual : [actual];
  if (!actualList.filter(Boolean).length || !Array.isArray(acceptable) || acceptable.length === 0) return 0;
  if (acceptable.includes("不设偏好")) return Math.round(weight * 0.6);
  return actualList.some(item => acceptable.includes(item)) ? weight : 0;
}

function mutualPreferenceScore(aActual, aIdeal, bActual, bIdeal, weight = 1) {
  return preferenceScore(bActual, aIdeal, weight) + preferenceScore(aActual, bIdeal, weight);
}

function mutualPreferenceScoreAny(aActual, aIdeal, bActual, bIdeal, weight = 1) {
  return preferenceScoreAny(bActual, aIdeal, weight) + preferenceScoreAny(aActual, bIdeal, weight);
}

function yearInRange(year, min, max) {
  if (!year) return false;
  const lower = Number.isInteger(min) ? min : 1900;
  const upper = Number.isInteger(max) ? max : 2100;
  return year >= Math.min(lower, upper) && year <= Math.max(lower, upper);
}

function mutualYearRangeScore(aYear, aMin, aMax, bYear, bMin, bMax) {
  let score = 0;
  const aHasRange = Number.isInteger(aMin) || Number.isInteger(aMax);
  const bHasRange = Number.isInteger(bMin) || Number.isInteger(bMax);
  if (aHasRange && yearInRange(bYear, aMin, aMax)) score += 3;
  if (bHasRange && yearInRange(aYear, bMin, bMax)) score += 3;
  return score;
}

function profileYear(profile) {
  return profile.birthYear || (profile.age ? new Date().getFullYear() - profile.age : null);
}

function rangeText(min, max) {
  if (!Number.isInteger(min) && !Number.isInteger(max)) return "未设置";
  return `${Number.isInteger(min) ? min : "不限"}-${Number.isInteger(max) ? max : "不限"}`;
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function listText(value) {
  const list = asList(value);
  return list.length ? list.join("、") : "未填写";
}

function locationAccepted(actualLocation, idealLocations) {
  const actual = asList(actualLocation);
  const ideal = asList(idealLocations);
  if (!actual.length || !ideal.length) return true;
  return actual.some(item => ideal.includes(item));
}

function acceptableHit(actualValue, acceptableValues) {
  const actual = asList(actualValue);
  const acceptable = asList(acceptableValues);
  if (!actual.length || !acceptable.length || acceptable.includes("不设偏好") || acceptable.includes("不限")) return true;
  return actual.some(item => acceptable.includes(item));
}

function addAcceptableWarning(warnings, owner, candidate, options) {
  const { field, label, acceptable, actual, actualLabel, strict = false, weight = 0.95 } = options;
  if (acceptableHit(actual, acceptable)) return;
  warnings.push({
    field,
    strict,
    weight,
    label,
    message: `${owner.displayName || "一方"} 可接受 ${listText(acceptable)}，${candidate.displayName || "对方"} 的${actualLabel || label}为 ${listText(actual)}。`
  });
}

function matchBoundaryWarnings(a, b) {
  const warnings = [];
  if (!genderCompatible(a, b)) {
    warnings.push({
      field: "gender",
      strict: true,
      label: "性别边界不符合",
      message: `${a.displayName || "Moon"} 希望认识 ${listText(a.seeking)}，${b.displayName || "Shade"} 性别为 ${b.gender || "未填写"}；${b.displayName || "Shade"} 希望认识 ${listText(b.seeking)}，${a.displayName || "Moon"} 性别为 ${a.gender || "未填写"}。`
    });
  }

  const aYear = profileYear(a);
  const bYear = profileYear(b);
  const aHasRange = Number.isInteger(a.idealBirthYearMin) || Number.isInteger(a.idealBirthYearMax);
  const bHasRange = Number.isInteger(b.idealBirthYearMin) || Number.isInteger(b.idealBirthYearMax);
  if (aHasRange && bYear && !yearInRange(bYear, a.idealBirthYearMin, a.idealBirthYearMax)) {
    warnings.push({
      field: "age",
      strict: true,
      label: "出生年不在 Moon 期待范围",
      message: `${a.displayName || "Moon"} 期待 ${rangeText(a.idealBirthYearMin, a.idealBirthYearMax)}，${b.displayName || "Shade"} 为 ${bYear}。`
    });
  }
  if (bHasRange && aYear && !yearInRange(aYear, b.idealBirthYearMin, b.idealBirthYearMax)) {
    warnings.push({
      field: "age",
      strict: true,
      label: "出生年不在 Shade 期待范围",
      message: `${b.displayName || "Shade"} 期待 ${rangeText(b.idealBirthYearMin, b.idealBirthYearMax)}，${a.displayName || "Moon"} 为 ${aYear}。`
    });
  }

  if (!locationAccepted(b.location || b.city, a.idealLocations)) {
    warnings.push({
      field: "location",
      strict: true,
      label: "校区不在 Moon 可接受范围",
      message: `${a.displayName || "Moon"} 可接受 ${listText(a.idealLocations)}，${b.displayName || "Shade"} 在 ${listText(b.location || b.city)}。`
    });
  }
  if (!locationAccepted(a.location || a.city, b.idealLocations)) {
    warnings.push({
      field: "location",
      strict: true,
      label: "校区不在 Shade 可接受范围",
      message: `${b.displayName || "Shade"} 可接受 ${listText(b.idealLocations)}，${a.displayName || "Moon"} 在 ${listText(a.location || a.city)}。`
    });
  }

  addAcceptableWarning(warnings, a, b, {
    field: "schoolType",
    label: "院校背景不在 Moon 可接受范围",
    acceptable: a.idealSchoolTypes,
    actual: b.schoolType,
    actualLabel: "院校背景",
    strict: true,
    weight: 0
  });
  addAcceptableWarning(warnings, b, a, {
    field: "schoolType",
    label: "院校背景不在 Shade 可接受范围",
    acceptable: b.idealSchoolTypes,
    actual: a.schoolType,
    actualLabel: "院校背景",
    strict: true,
    weight: 0
  });

  const softVolumeChecks = [
    ["hometownRegion", "家乡地区", "家乡地区", "idealHometownRegions", profile => regionForProvince(profile.hometownProvince), 0.88],
    ["homeArea", "成长环境", "成长环境", "idealHomeAreas", profile => profile.homeArea, 0.88],
    ["discipline", "专业方向", "专业方向", "idealDisciplines", profile => profile.discipline || profile.department, 0.86]
  ];
  for (const [field, label, actualLabel, idealKey, actualGetter, weight] of softVolumeChecks) {
    addAcceptableWarning(warnings, a, b, { field, label: `${label}不在 Moon 可接受范围`, acceptable: a[idealKey], actual: actualGetter(b), actualLabel, strict: false, weight });
    addAcceptableWarning(warnings, b, a, { field, label: `${label}不在 Shade 可接受范围`, acceptable: b[idealKey], actual: actualGetter(a), actualLabel, strict: false, weight });
  }

  const otherAcceptableChecks = [
    ["intent", "关系期待", "关系期待", "idealIntent", profile => profile.intent],
    ["tempo", "沟通节奏", "沟通节奏", "idealTempo", profile => profile.tempo],
    ["intimacy", "亲密边界", "亲密边界", "idealIntimacy", profile => profile.intimacy],
    ["intimacyTiming", "亲密关系发生时间", "亲密关系发生时间", "idealIntimacyTiming", profile => profile.intimacyTiming],
    ["socialBoundary", "恋爱后交际圈边界", "交际圈边界", "idealSocialBoundary", profile => profile.socialBoundary],
    ["weekend", "周末偏好", "周末偏好", "idealWeekends", profile => profile.selfWeekends || profile.weekend],
    ["style", "穿着气质", "穿着气质", "idealStyle", profile => profile.selfStyle],
    ["appearanceFeel", "外在年龄感", "外在年龄感", "idealAppearanceFeel", profile => profile.appearanceFeel],
    ["hair", "头发长度", "头发长度", "idealHair", profile => profile.hair],
    ["glasses", "眼镜状态", "眼镜状态", "idealGlasses", profile => profile.glasses]
  ];
  for (const [field, label, actualLabel, idealKey, actualGetter] of otherAcceptableChecks) {
    addAcceptableWarning(warnings, a, b, { field, label: `${label}不在 Moon 可接受范围`, acceptable: a[idealKey], actual: actualGetter(b), actualLabel });
    addAcceptableWarning(warnings, b, a, { field, label: `${label}不在 Shade 可接受范围`, acceptable: b[idealKey], actual: actualGetter(a), actualLabel });
  }
  return warnings;
}

function hardBoundaryCompatible(a, b) {
  return !matchBoundaryWarnings(a, b).some(item => item.strict);
}

function metricScore(a, b) {
  const labels = {
    warmth: "相处气质",
    ambition: "学业事业节奏",
    decision: "决策方式",
    novelty: "新鲜感偏好",
    schedule: "作息节律",
    marriage: "婚姻意向",
    fertility: "生育意向"
  };
  let score = 0;
  const reasons = [];
  for (const key of Object.keys(labels)) {
    const aIdeal = Number.isInteger(a.idealMetrics?.[key]) ? [a.idealMetrics[key]] : (Array.isArray(a.idealMetrics?.[key]) ? a.idealMetrics[key] : []);
    const bIdeal = Number.isInteger(b.idealMetrics?.[key]) ? [b.idealMetrics[key]] : (Array.isArray(b.idealMetrics?.[key]) ? b.idealMetrics[key] : []);
    const aHit = Number.isInteger(b.selfMetrics?.[key]) && aIdeal.includes(b.selfMetrics[key]);
    const bHit = Number.isInteger(a.selfMetrics?.[key]) && bIdeal.includes(a.selfMetrics[key]);
    if (aHit) score += 3;
    if (bHit) score += 3;
    if (aHit && bHit) reasons.push(`${labels[key]}互相落在期待范围`);
  }
  return { score, reasons };
}

function heightScore(a, b) {
  let score = 0;
  if (Number.isInteger(a.idealHeight) && Number.isInteger(b.height)) {
    score += Math.max(0, 4 - Math.floor(Math.abs(a.idealHeight - b.height) / 3));
  }
  if (Number.isInteger(b.idealHeight) && Number.isInteger(a.height)) {
    score += Math.max(0, 4 - Math.floor(Math.abs(b.idealHeight - a.height) / 3));
  }
  return score;
}

function pairKey(leftId, rightId) {
  return [leftId, rightId].sort().join("::");
}

function matchTime(match) {
  return new Date(match.publishedAt || match.updatedAt || match.createdAt || 0).getTime() || 0;
}

function matchHistory(matches = []) {
  const pairCounts = new Map();
  const lastPartners = new Map();
  const lastMatchedAt = new Map();
  const proposals = matches
    .filter(match => match.status === "published")
    .sort((a, b) => matchTime(a) - matchTime(b));
  for (const match of proposals) {
    const key = pairKey(match.leftId, match.rightId);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    const at = matchTime(match);
    lastPartners.set(match.leftId, match.rightId);
    lastPartners.set(match.rightId, match.leftId);
    if (match.status === "published") {
      lastMatchedAt.set(match.leftId, at);
      lastMatchedAt.set(match.rightId, at);
    }
  }
  return { pairCounts, lastPartners, lastMatchedAt };
}

function profileFrequency(profile, profiles, history, settings = defaultData.settings, now = Date.now(), genderRanks = new Map(), rankContext = profileRankContext(profiles)) {
  const factors = profileWeightFactors(profile, profiles, history, now, rankContext);
  const { lastAt, daysSince, clarity, completeness, personalWeight } = factors;
  const allocation = expectedAllocationDateMs(profile, profiles, lastAt, personalWeight, settings, now);
  const interval = allocation.intervalDays;
  const remainingMs = allocation.expectedAt - now;
  const referenceDays = Math.max(0, Math.ceil(remainingMs / 86_400_000));
  const nextEligibleAtMs = allocation.expectedAt;
  const eligible = nextEligibleAtMs <= now;
  const genderRank = genderRanks.get(profile.id) || null;
  const label = personalWeight >= 1.2 ? "优先候选" : personalWeight >= 0.7 ? "标准候选" : "待补充画像";
  const reason = [
    daysSince === null ? "尚无成功匹配记录" : `距上次成功匹配 ${daysSince} 天`,
    `问卷完整度 ${Math.round(completeness.ratio * 100)}%`,
    `问卷精准度 ${Math.round(clarity.ratio * 100)}%`,
    `性别比例基准 ${allocation.baseIntervalDays} 天`,
    `个人权重偏移 ${allocation.personalOffsetDays >= 0 ? "-" : "+"}${Math.abs(allocation.personalOffsetDays)} 天`,
    `稳定浮动 ${allocation.noiseDays >= 0 ? "+" : ""}${allocation.noiseDays} 天`,
    genderRank ? `同性别排序第 ${genderRank}` : ""
  ].filter(Boolean).join("；");
  return {
    label,
    intervalDays: interval,
    daysSinceLastMatch: daysSince,
    lastSuccessfulMatchAt: lastAt ? new Date(lastAt).toISOString() : null,
    expectedNextAllocationAt: new Date(nextEligibleAtMs).toISOString(),
    nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
    referenceDays,
    baseIntervalDays: allocation.baseIntervalDays,
    personalOffsetDays: allocation.personalOffsetDays,
    noiseDays: allocation.noiseDays,
    eligible,
    timeWeight: factors.gapCoefficient,
    clarityWeight: factors.precisionCoefficient,
    clarityRatio: Number(clarity.ratio.toFixed(3)),
    clarityFilled: clarity.filled,
    clarityTotal: clarity.total,
    precisionRawRatio: factors.precisionRawRatio,
    precisionRankRatio: factors.precisionRankRatio,
    scarcityRawRatio: factors.scarcityRawRatio,
    scarcityRankRatio: factors.scarcityRankRatio,
    completenessRatio: Number(completeness.ratio.toFixed(3)),
    completenessFilled: completeness.filled,
    completenessTotal: completeness.total,
    completenessCoefficient: factors.completenessCoefficient,
    precisionCoefficient: factors.precisionCoefficient,
    gapCoefficient: factors.gapCoefficient,
    genderRatioCoefficient: factors.genderRatioCoefficient,
    scarcityCoefficient: factors.scarcityCoefficient,
    personalWeight,
    genderRank,
    priority: personalWeight,
    reason
  };
}

function genderRanksFor(profiles, history, settings, now = Date.now(), rankContext = profileRankContext(profiles)) {
  const preliminary = profiles.map(profile => {
    const factors = profileWeightFactors(profile, profiles, history, now, rankContext);
    return { id: profile.id, gender: profile.gender || "未填写", personalWeight: factors.personalWeight };
  });
  const ranks = new Map();
  for (const gender of [...new Set(preliminary.map(item => item.gender))]) {
    preliminary
      .filter(item => item.gender === gender)
      .sort((a, b) => b.personalWeight - a.personalWeight)
      .forEach((item, index) => ranks.set(item.id, index + 1));
  }
  return ranks;
}

function frequencyMapFor(profiles, matches, settings) {
  const history = matchHistory(matches);
  const now = Date.now();
  const rankContext = profileRankContext(profiles);
  const ranks = genderRanksFor(profiles, history, settings, now, rankContext);
  return new Map(profiles.map(profile => [profile.id, profileFrequency(profile, profiles, history, settings, now, ranks, rankContext)]));
}

function mbtiMetricScore(a, b) {
  const keys = ["ei", "sn", "tf", "jp"];
  let score = 0;
  for (const key of keys) {
    const aIdeal = Number(a.idealMbtiMetrics?.[key]);
    const bIdeal = Number(b.idealMbtiMetrics?.[key]);
    const aActual = Number(a.mbtiMetrics?.[key]);
    const bActual = Number(b.mbtiMetrics?.[key]);
    if (Number.isInteger(aIdeal) && Number.isInteger(bActual) && Math.abs(aIdeal - bActual) <= 1) score += 1;
    if (Number.isInteger(bIdeal) && Number.isInteger(aActual) && Math.abs(bIdeal - aActual) <= 1) score += 1;
  }
  return score;
}

function boundaryGateForPair(a, b) {
  const warnings = matchBoundaryWarnings(a, b);
  if (warnings.some(item => item.strict)) {
    return {
      hardBlocked: true,
      booleanGate: 0,
      softViolationCount: warnings.filter(item => !item.strict).length,
      warnings
    };
  }
  const softWarnings = warnings.filter(item => !item.strict);
  const booleanGate = softWarnings.reduce((weight, item) => weight * clampNumber(Number(item.weight) || 0.95, 0.1, 1), 1);
  return {
    hardBlocked: false,
    booleanGate: roundWeight(booleanGate),
    softViolationCount: softWarnings.length,
    warnings
  };
}

function sharedInterestCount(a, b) {
  return interestFieldNames.reduce((count, field) => {
    const left = new Set(asList(a[field]));
    return count + asList(b[field]).filter(item => left.has(item)).length;
  }, 0);
}

function textTokens(value) {
  return cleanText(value, 300)
    .split(/[\s,，、;；.。!！?？/]+/)
    .map(item => item.trim())
    .filter(item => item.length >= 2);
}

function freeTextInterestHits(a, b) {
  const left = new Set(textTokens(a.otherInterestText));
  return textTokens(b.otherInterestText).filter(item => left.has(item)).length;
}

function orientationWeightForPair(a, b) {
  const interestMatches = sharedInterestCount(a, b);
  const interestBonus = Math.floor(Math.max(0, interestMatches - 7) / 2) * 0.1;
  const freeTextHits = freeTextInterestHits(a, b);
  const freeTextBonus = freeTextHits * 0.07;
  return {
    orientationWeight: roundWeight(1 + interestBonus + freeTextBonus),
    interestMatches,
    freeTextHits
  };
}

function scorePair(a, b) {
  if (a.id === b.id) return null;
  const gate = boundaryGateForPair(a, b);
  const orientation = orientationWeightForPair(a, b);
  const basis = roundWeight(gate.booleanGate * orientation.orientationWeight);
  const reasons = [
    gate.hardBlocked ? "布尔门槛为 0，存在硬性不符合项" : (gate.softViolationCount ? `存在 ${gate.softViolationCount} 项软性违例` : "布尔门槛完全通过"),
    orientation.interestMatches >= 7 ? `共同兴趣 ${orientation.interestMatches} 项` : `共同兴趣 ${orientation.interestMatches} 项，未达到加权门槛`,
    orientation.freeTextHits ? `未涉及爱好命中 ${orientation.freeTextHits} 项` : ""
  ].filter(Boolean);

  return {
    score: basis,
    booleanGate: gate.booleanGate,
    orientationWeight: orientation.orientationWeight,
    interestMatchCount: orientation.interestMatches,
    freeTextInterestHits: orientation.freeTextHits,
    softViolationCount: gate.softViolationCount,
    hardBlocked: gate.hardBlocked,
    reasons: reasons.slice(0, 4)
  };
}

function bestMatchesFor(profile, profiles) {
  return profiles
    .map(candidate => {
      const result = scorePair(profile, candidate);
      return result ? { profile: candidate, ...result } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => ({
      score: item.score,
      reasons: item.reasons,
      profile: publicProfile(item.profile),
      contact: item.score > 0 ? {
        type: item.profile.contactType,
        value: item.profile.contactValue
      } : null
    }));
}

function selectedCandidateMatches(candidates, targetCount = 6) {
  const selected = [];
  const selectedKeys = new Set();
  const addCandidate = candidate => {
    if (!candidate) return;
    const key = pairKey(candidate.left.id, candidate.right.id);
    if (selectedKeys.has(key)) return;
    selected.push(candidate);
    selectedKeys.add(key);
  };
  candidates.slice(0, targetCount).forEach(addCandidate);
  return selected.sort((a, b) => (b.crossWeight - a.crossWeight) || (b.adjustedScore - a.adjustedScore));
}

function generateRoundMatches(profiles, roundId, matches = [], settings = defaultData.settings) {
  const history = matchHistory(matches);
  const activeProfiles = profiles.filter(isActiveProfile);
  const frequencies = frequencyMapFor(activeProfiles, matches, settings);
  const publishedParticipantIds = new Set(matches
    .filter(match => match.roundId === roundId && match.status === "published")
    .flatMap(match => [match.leftId, match.rightId]));
  const pool = activeProfiles.filter(profile =>
    (frequencies.get(profile.id)?.gapCoefficient || 0) > 0
    && !publishedParticipantIds.has(profile.id)
  );
  const activePool = [...pool].sort((a, b) => {
    const left = frequencies.get(a.id)?.genderRank || 999;
    const right = frequencies.get(b.id)?.genderRank || 999;
    return left - right;
  });
  const candidates = [];
  const pairs = [];
  const today = localDateKey();
  const batchId = `${roundId}-${today}`;
  for (let i = 0; i < activePool.length; i += 1) {
    for (let j = i + 1; j < activePool.length; j += 1) {
      const scored = scorePair(activePool[i], activePool[j]);
      if (!scored || scored.hardBlocked) continue;
      const key = pairKey(activePool[i].id, activePool[j].id);
      const repeatedCount = history.pairCounts.get(key) || 0;
      const lastRepeat = history.lastPartners.get(activePool[i].id) === activePool[j].id || history.lastPartners.get(activePool[j].id) === activePool[i].id;
      const leftFrequency = frequencies.get(activePool[i].id) || { personalWeight: 0 };
      const rightFrequency = frequencies.get(activePool[j].id) || { personalWeight: 0 };
      const personalWeight = roundWeight((leftFrequency.personalWeight || 0) * (rightFrequency.personalWeight || 0));
      const crossWeight = roundWeight(personalWeight * scored.booleanGate * scored.orientationWeight);
      const repeatFactor = roundWeight((0.72 ** repeatedCount) * (lastRepeat ? 0.65 : 1));
      const adjustedScore = roundWeight(crossWeight * repeatFactor);
      candidates.push({ left: activePool[i], right: activePool[j], adjustedScore, personalWeight, crossWeight, repeatedCount, lastRepeat, repeatFactor, ...scored });
    }
  }
  candidates.sort((a, b) => (b.crossWeight - a.crossWeight) || (b.adjustedScore - a.adjustedScore));
  for (const best of selectedCandidateMatches(candidates, 6)) {
    const leftFrequency = frequencies.get(best.left.id);
    const rightFrequency = frequencies.get(best.right.id);
    const boundaryWarnings = matchBoundaryWarnings(best.left, best.right);
    pairs.push({
      id: crypto.randomUUID(),
      roundId,
      batchId,
      generatedFor: today,
      algorithmVersion: DAILY_MATCH_ALGORITHM_VERSION,
      leftId: best.left.id,
      rightId: best.right.id,
      score: best.crossWeight,
      adjustedScore: best.adjustedScore,
      crossWeight: best.crossWeight,
      personalWeight: best.personalWeight,
      booleanGate: best.booleanGate,
      orientationWeight: best.orientationWeight,
      interestMatchCount: best.interestMatchCount,
      freeTextInterestHits: best.freeTextInterestHits,
      softViolationCount: best.softViolationCount,
      hardBlocked: best.hardBlocked,
      weightBreakdown: {
        left: {
          completenessCoefficient: leftFrequency?.completenessCoefficient || 0,
          precisionCoefficient: leftFrequency?.precisionCoefficient || 0,
          gapCoefficient: leftFrequency?.gapCoefficient || 0,
          genderRatioCoefficient: leftFrequency?.genderRatioCoefficient || 0,
          scarcityCoefficient: leftFrequency?.scarcityCoefficient || 0,
          personalWeight: leftFrequency?.personalWeight || 0,
          genderRank: leftFrequency?.genderRank || null
        },
        right: {
          completenessCoefficient: rightFrequency?.completenessCoefficient || 0,
          precisionCoefficient: rightFrequency?.precisionCoefficient || 0,
          gapCoefficient: rightFrequency?.gapCoefficient || 0,
          genderRatioCoefficient: rightFrequency?.genderRatioCoefficient || 0,
          scarcityCoefficient: rightFrequency?.scarcityCoefficient || 0,
          personalWeight: rightFrequency?.personalWeight || 0,
          genderRank: rightFrequency?.genderRank || null
        },
        crossWeight: best.crossWeight,
        booleanGate: best.booleanGate,
        orientationWeight: best.orientationWeight,
        repeatFactor: best.repeatFactor,
        finalWeight: best.adjustedScore
      },
      reasons: [
        ...best.reasons,
        `个人权重乘积 ${best.personalWeight}`,
        `布尔门槛 ${best.booleanGate}`,
        `取向权重 ${best.orientationWeight}`,
        `交叉权重 ${best.crossWeight}`,
        best.hardBlocked ? "硬性不符合，保留为 0 权重候选" : (boundaryWarnings.length ? `存在 ${boundaryWarnings.length} 项可接受范围提醒` : "可接受范围检查通过"),
        best.repeatedCount ? `重复降权系数 ${best.repeatFactor}` : "无历史重复降权"
      ].slice(0, 8),
      status: "draft",
      notes: "",
      frequency: {
        [best.left.id]: leftFrequency,
        [best.right.id]: rightFrequency
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  return pairs;
}

function ensureDailyDraftMatches(data) {
  const roundId = currentRound(new Date(), data.settings).id;
  const today = localDateKey();
  const activeProfiles = data.profiles.filter(isActiveProfile);
  const activeIds = new Set(activeProfiles.map(profile => profile.id));
  const byId = new Map(data.profiles.map(profile => [profile.id, profile]));
  const publishedIds = new Set(data.matches
    .filter(match => match.roundId === roundId && match.status === "published")
    .flatMap(match => [match.leftId, match.rightId]));
  const frequencyMap = frequencyMapFor(activeProfiles, data.matches, data.settings);
  const coolingIds = new Set([...frequencyMap.entries()]
    .filter(([, frequency]) => (frequency.gapCoefficient || 0) <= 0)
    .map(([id]) => id));
  const hasInvalidDraft = data.matches.some(match =>
    match.roundId === roundId
    && match.status === "draft"
    && (
      !activeIds.has(match.leftId)
      || !activeIds.has(match.rightId)
      || publishedIds.has(match.leftId)
      || publishedIds.has(match.rightId)
      || coolingIds.has(match.leftId)
      || coolingIds.has(match.rightId)
      || !hardBoundaryCompatible(byId.get(match.leftId), byId.get(match.rightId))
    )
  );
  if (hasInvalidDraft) {
    const generated = replaceRoundDraftMatches(data, roundId);
    return generated.length > 0;
  }
  const hasTodayDraft = data.matches.some(match => match.roundId === roundId && match.status === "draft" && match.generatedFor === today && match.algorithmVersion === DAILY_MATCH_ALGORITHM_VERSION);
  if (hasTodayDraft) return false;
  const generated = replaceRoundDraftMatches(data, roundId);
  return generated.length > 0;
}

function replaceRoundDraftMatches(data, roundId) {
  const generated = generateRoundMatches(data.profiles, roundId, data.matches, data.settings);
  data.matches = data.matches
    .filter(match => !(match.roundId === roundId && match.status === "draft"))
    .concat(generated);
  return generated;
}

function matchPreview(left, right, matches, settings, profiles = [left, right]) {
  if (!left || !right) return null;
  const frequencyPool = profiles.filter(profile => isActiveProfile(profile));
  const frequencies = frequencyMapFor(frequencyPool.length ? frequencyPool : [left, right], matches, settings);
  const leftFrequency = frequencies.get(left.id);
  const rightFrequency = frequencies.get(right.id);
  const boundaryWarnings = matchBoundaryWarnings(left, right);
  const scored = scorePair(left, right);
  const hardBlocked = scored?.hardBlocked || false;
  const personalWeight = roundWeight((leftFrequency?.personalWeight || 0) * (rightFrequency?.personalWeight || 0));
  const crossWeight = roundWeight(personalWeight * (scored?.booleanGate || 0) * (scored?.orientationWeight || 0));
  const key = pairKey(left.id, right.id);
  const history = matchHistory(matches);
  const repeatedCount = history.pairCounts.get(key) || 0;
  const lastRepeat = history.lastPartners.get(left.id) === right.id || history.lastPartners.get(right.id) === left.id;
  const repeatFactor = roundWeight((0.72 ** repeatedCount) * (lastRepeat ? 0.65 : 1));
  const finalWeight = roundWeight(crossWeight * repeatFactor);
  return {
    hardBlocked,
    score: crossWeight,
    crossWeight,
    personalWeight,
    adjustedScore: finalWeight,
    booleanGate: scored?.booleanGate || 0,
    orientationWeight: scored?.orientationWeight || 0,
    interestMatchCount: scored?.interestMatchCount || 0,
    freeTextInterestHits: scored?.freeTextInterestHits || 0,
    softViolationCount: scored?.softViolationCount || 0,
    reasons: scored?.reasons || [],
    boundaryWarnings,
    weightBreakdown: {
      left: {
        completenessCoefficient: leftFrequency?.completenessCoefficient || 0,
        precisionCoefficient: leftFrequency?.precisionCoefficient || 0,
        gapCoefficient: leftFrequency?.gapCoefficient || 0,
        genderRatioCoefficient: leftFrequency?.genderRatioCoefficient || 0,
        scarcityCoefficient: leftFrequency?.scarcityCoefficient || 0,
        personalWeight: leftFrequency?.personalWeight || 0,
        genderRank: leftFrequency?.genderRank || null
      },
      right: {
        completenessCoefficient: rightFrequency?.completenessCoefficient || 0,
        precisionCoefficient: rightFrequency?.precisionCoefficient || 0,
        gapCoefficient: rightFrequency?.gapCoefficient || 0,
        genderRatioCoefficient: rightFrequency?.genderRatioCoefficient || 0,
        scarcityCoefficient: rightFrequency?.scarcityCoefficient || 0,
        personalWeight: rightFrequency?.personalWeight || 0,
        genderRank: rightFrequency?.genderRank || null
      },
      crossWeight,
      booleanGate: scored?.booleanGate || 0,
      orientationWeight: scored?.orientationWeight || 0,
      repeatFactor,
      finalWeight
    },
    left: adminMatchProfile(left, { frequencyMap: frequencies }),
    right: adminMatchProfile(right, { frequencyMap: frequencies })
  };
}

function bestCrossWeightMatchFor(profile, profiles, matches, settings = defaultData.settings) {
  if (!profile || !isActiveProfile(profile)) return null;
  const activeProfiles = profiles.filter(item => isActiveProfile(item));
  const historyMatches = matches.filter(item => item.status === "published");
  return activeProfiles
    .filter(candidate => candidate.id !== profile.id)
    .map(candidate => matchPreview(profile, candidate, historyMatches, settings, activeProfiles))
    .filter(Boolean)
    .filter(preview => !preview.hardBlocked)
    .sort((a, b) =>
      (b.crossWeight - a.crossWeight)
      || ((b.adjustedScore || 0) - (a.adjustedScore || 0))
      || ((b.orientationWeight || 0) - (a.orientationWeight || 0))
    )[0] || null;
}

function publishedMatchesFor(profile, profiles, matches) {
  const byId = new Map(profiles.map(item => [item.id, item]));
  return matches
    .filter(match => match.status === "published" && (match.leftId === profile.id || match.rightId === profile.id))
    .sort((a, b) => matchTime(b) - matchTime(a))
    .slice(0, 2)
    .map(match => {
      const otherId = match.leftId === profile.id ? match.rightId : match.leftId;
      const other = byId.get(otherId);
      if (!other) return null;
      return {
        score: match.score,
        reasons: match.reasons || [],
        pushedAt: match.publishedAt || match.updatedAt || match.createdAt,
        profile: publicProfile(other),
        contact: {
          type: other.contactType,
          value: other.contactValue
        }
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function demoProfile(overrides) {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    token: overrides.token || crypto.randomBytes(24).toString("hex"),
    roundId: overrides.roundId,
    displayName: overrides.displayName,
    email: overrides.email,
    birthYear: overrides.birthYear,
    idealBirthYearMin: overrides.idealBirthYearMin || 1996,
    idealBirthYearMax: overrides.idealBirthYearMax || 2005,
    age: null,
    gender: overrides.gender,
    seeking: overrides.seeking,
    city: (overrides.location || []).join("、"),
    school: "北京大学",
    department: overrides.discipline,
    stage: overrides.identity,
    identity: overrides.identity,
    idealIdentities: overrides.idealIdentities || ["本科生", "硕士生", "博士生"],
    schoolType: "北京大学",
    idealSchoolTypes: [],
    location: overrides.location,
    idealLocations: overrides.idealLocations || ["燕园", "万柳", "学院路"],
    hometownProvince: overrides.hometownProvince,
    idealHometownRegions: overrides.idealHometownRegions || ["华北", "华东", "华中", "华南"],
    homeArea: overrides.homeArea || "直辖市/省会/首府/计划单列市",
    idealHomeAreas: overrides.idealHomeAreas || ["直辖市/省会/首府/计划单列市", "地级市/州府/公署驻地", "其他城市化地区"],
    discipline: overrides.discipline,
    idealDisciplines: overrides.idealDisciplines || ["理学", "工学", "人文", "社科", "经管"],
    intent: overrides.intent,
    idealIntent: overrides.idealIntent || ["认真发展", "慢慢了解", overrides.intent].filter(Boolean),
    tempo: overrides.tempo,
    idealTempo: overrides.idealTempo || ["高频交流", "日常分享", "线下优先"],
    intimacy: overrides.intimacy || "关系决定",
    idealIntimacy: overrides.idealIntimacy || ["开放态度", "关系决定"],
    intimacyTiming: overrides.intimacyTiming || "关系稳定后",
    idealIntimacyTiming: overrides.idealIntimacyTiming || ["婚后", "关系稳定后", "相熟数月后"],
    socialBoundary: overrides.socialBoundary || "保持现状",
    idealSocialBoundary: overrides.idealSocialBoundary || ["开放性", "保持现状"],
    weekend: overrides.selfWeekends,
    dietaryPreferences: overrides.dietaryPreferences || ["清淡"],
    monthlyExpense: overrides.monthlyExpense || 3000,
    sportsInterests: overrides.sportsInterests || ["跑步", "羽毛球"],
    musicInterests: overrides.musicInterests || ["流行", "民谣"],
    movieInterests: overrides.movieInterests || ["剧情", "纪录"],
    travelInterests: overrides.travelInterests || ["自由行", "山水"],
    readingInterests: overrides.readingInterests || ["小说", "纪实"],
    skillInterests: overrides.skillInterests || ["摄影", "烹饪"],
    gameInterests: overrides.gameInterests || ["桌游"],
    otherInterests: overrides.otherInterests || ["探店"],
    otherInterestText: overrides.otherInterestText || "也喜欢逛展和找安静的小店。",
    values: overrides.selfValues,
    selfWeekends: overrides.selfWeekends,
    idealWeekends: overrides.idealWeekends || ["散步游览", "运动户外", "做饭探店", "自习工作"],
    selfValues: overrides.selfValues,
    idealValues: overrides.idealValues || ["坦诚表达", "情绪稳定", "共同成长", "边界清晰"],
    selfStyle: overrides.selfStyle,
    idealStyle: overrides.idealStyle || ["清冷", "学院", "正式", "随性"],
    hair: overrides.hair || "中长发",
    idealHair: overrides.idealHair || ["短发", "中长发", "长发"],
    glasses: overrides.glasses || "偶尔戴",
    idealGlasses: overrides.idealGlasses || ["不设偏好"],
    appearanceFeel: overrides.appearanceFeel || "同龄",
    idealAppearanceFeel: overrides.idealAppearanceFeel || ["不设偏好"],
    selfMetrics: overrides.selfMetrics || { warmth: 3, ambition: 1, decision: 1, novelty: 1, schedule: 1, marriage: 3, fertility: 1 },
    idealMetrics: overrides.idealMetrics || { warmth: 3, ambition: 3, decision: 3, novelty: 3, schedule: 3, marriage: 3, fertility: 3 },
    mbtiMetrics: overrides.mbtiMetrics || { ei: -1, sn: 1, tf: 1, jp: 1 },
    idealMbtiMetrics: overrides.idealMbtiMetrics || { ei: -1, sn: 1, tf: 1, jp: 1 },
    height: overrides.height,
    idealHeight: overrides.idealHeight,
    mbti: "",
    selfIntro: overrides.selfIntro || "MoonShade 本地测试用户。",
    contactType: "微信",
    contactValue: overrides.contactValue,
    consent: true,
    isDemo: true,
    updatedAt: now,
    createdAt: overrides.createdAt || now
  };
}

function seedDemoProfiles(data) {
  const roundId = currentRound(new Date(), data.settings).id;
  const demos = [
    demoProfile({ id: "demo-lina", roundId, displayName: "林夏", email: "2400000001@stu.pku.edu.cn", birthYear: 2002, gender: "女", seeking: ["男"], identity: "本科生", location: ["燕园"], hometownProvince: "北京", discipline: "人文", intent: "认真发展", tempo: "日常分享", selfWeekends: ["散步游览", "自习工作"], selfValues: ["坦诚表达", "情绪稳定"], selfStyle: ["学院", "清冷"], height: 165, idealHeight: 178, contactValue: "demo_linxia" }),
    demoProfile({ id: "demo-mingyuan", roundId, displayName: "明远", email: "2400000002@pku.edu.cn", birthYear: 1999, gender: "男", seeking: ["女"], identity: "硕士生", location: ["燕园"], hometownProvince: "河北", discipline: "工学", intent: "认真发展", tempo: "日常分享", selfWeekends: ["运动户外", "散步游览"], selfValues: ["坦诚表达", "共同成长"], selfStyle: ["学院", "运动"], height: 180, idealHeight: 166, contactValue: "demo_mingyuan" })
  ];
  const demoIds = new Set(demos.map(profile => profile.id));
  const staleDemoIds = new Set(data.profiles.filter(profile => profile.isDemo && !demoIds.has(profile.id)).map(profile => profile.id));
  data.profiles = data.profiles.filter(profile => !profile.isDemo || demoIds.has(profile.id));
  if (staleDemoIds.size) {
    data.matches = data.matches.filter(match => !staleDemoIds.has(match.leftId) && !staleDemoIds.has(match.rightId));
  }
  const existing = new Map(data.profiles.map(profile => [profile.id, profile]));
  let added = 0;
  let updated = 0;
  for (const profile of demos) {
    if (existing.has(profile.id)) {
      Object.assign(existing.get(profile.id), profile, { createdAt: existing.get(profile.id).createdAt || profile.createdAt });
      updated += 1;
    } else {
      data.profiles.push(profile);
      added += 1;
    }
  }
  return { added, updated, totalDemo: demos.length };
}

function deleteDemoProfiles(data) {
  const demoIds = new Set(data.profiles.filter(profile => profile.isDemo).map(profile => profile.id));
  const demoEmails = new Set(data.profiles.filter(profile => profile.isDemo).map(profile => profile.email));
  const beforeProfiles = data.profiles.length;
  const beforeMatches = data.matches.length;
  data.profiles = data.profiles.filter(profile => !profile.isDemo);
  data.users = data.users.filter(user => !demoEmails.has(user.email));
  data.userSessions = data.userSessions.filter(session => !demoEmails.has(session.email));
  data.verifications = data.verifications.filter(record => !demoEmails.has(record.email));
  data.matches = data.matches.filter(match => !demoIds.has(match.leftId) && !demoIds.has(match.rightId));
  return {
    profilesDeleted: beforeProfiles - data.profiles.length,
    matchesDeleted: beforeMatches - data.matches.length
  };
}

function deleteAccountForUser(data, user) {
  const profile = data.profiles.find(item => item.email === user.email);
  const beforeMatches = data.matches.length;
  data.users = data.users.filter(item => item.email !== user.email);
  data.profiles = data.profiles.filter(item => item.email !== user.email);
  data.verifications = data.verifications.filter(item => item.email !== user.email);
  data.userSessions = data.userSessions.filter(item => item.email !== user.email);
  if (profile) {
    data.matches = data.matches.filter(match => match.leftId !== profile.id && match.rightId !== profile.id);
  }
  return {
    profileDeleted: Boolean(profile),
    matchesDeleted: beforeMatches - data.matches.length
  };
}

function adminProfile(profile, context = {}) {
  const frequency = context.frequencyMap?.get(profile.id) || null;
  return {
    ...profile,
    matchFrequency: frequency,
    token: undefined
  };
}

function adminMatchProfile(profile, context = {}) {
  return adminProfile(profile, context);
}

function serializeAdminMatches(matches, profiles, settings = defaultData.settings, historyMatches = matches) {
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const frequencies = frequencyMapFor(profiles.filter(isActiveProfile), historyMatches, settings);
  return [...matches].sort((a, b) => {
    if (a.status === "draft" && b.status === "draft") return (b.adjustedScore || 0) - (a.adjustedScore || 0);
    return matchTime(b) - matchTime(a);
  }).map(match => {
    const leftProfile = byId.get(match.leftId);
    const rightProfile = byId.get(match.rightId);
    return {
      ...match,
      boundaryWarnings: leftProfile && rightProfile ? matchBoundaryWarnings(leftProfile, rightProfile) : [],
      left: leftProfile ? adminMatchProfile(leftProfile, { frequencyMap: frequencies }) : null,
      right: rightProfile ? adminMatchProfile(rightProfile, { frequencyMap: frequencies }) : null
    };
  });
}

async function handleApi(req, res, url) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !isAllowedOrigin(req)) {
    return sendJson(res, 403, { error: "请求来源不被允许。" });
  }

  const data = await readJson(DATA_FILE);

  if (req.method === "POST" && url.pathname === "/api/auth/request-code") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    if (body.sliderPassed !== true) {
      return sendJson(res, 400, { error: "请先完成滑动安全验证。" });
    }
    if (!isAllowedEmail(email)) {
      return sendJson(res, 400, { error: ALLOWED_EMAIL_MESSAGE });
    }
    if (email === ADMIN_EMAIL || data.users.some(user => user.email === email && user.passwordHash)) {
      return sendJson(res, 409, { error: "该邮箱已注册，请使用密码登录。" });
    }
    const keys = authLimiterKeys(req, email, "verification");
    const status = rateStatus(keys, VERIFICATION_WINDOW_MS, VERIFICATION_LIMIT);
    if (status.limited) return sendRateLimit(res, status);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    data.verifications = data.verifications.filter(item => item.email !== email);
    data.verifications.push({
      email,
      purpose: "register",
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      attempts: 0
    });
    recordRate(keys, VERIFICATION_WINDOW_MS);
    const delivery = await sendVerificationEmail(email, code);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, {
      ok: true,
      message: delivery.delivered ? "验证码已发送，请查收邮箱。" : "本地开发模式：验证码已显示在页面上。",
      devCode: delivery.devCode
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/request-reset-code") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    if (body.sliderPassed !== true) {
      return sendJson(res, 400, { error: "请先完成滑动安全验证。" });
    }
    if (!isAllowedEmail(email)) {
      return sendJson(res, 400, { error: ALLOWED_EMAIL_MESSAGE });
    }
    if (email === ADMIN_EMAIL) {
      return sendJson(res, 400, { error: "管理员密码请在服务器环境变量中修改。" });
    }
    if (!data.users.some(user => user.email === email && user.passwordHash)) {
      return sendJson(res, 404, { error: "该邮箱还没有注册账号。" });
    }
    const keys = authLimiterKeys(req, email, "verification");
    const status = rateStatus(keys, VERIFICATION_WINDOW_MS, VERIFICATION_LIMIT);
    if (status.limited) return sendRateLimit(res, status);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    data.verifications = data.verifications.filter(item => item.email !== email);
    data.verifications.push({
      email,
      purpose: "reset",
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      attempts: 0
    });
    recordRate(keys, VERIFICATION_WINDOW_MS);
    const delivery = await sendVerificationEmail(email, code);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, {
      ok: true,
      message: delivery.delivered ? "重置密码验证码已发送，请查收邮箱。" : "本地开发模式：验证码已显示在页面上。",
      devCode: delivery.devCode
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/check-email") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    if (body.sliderPassed !== true) return sendJson(res, 400, { error: "请先完成滑动安全验证。" });
    if (!isAllowedEmail(email)) {
      return sendJson(res, 400, { error: ALLOWED_EMAIL_MESSAGE });
    }
    const keys = authLimiterKeys(req, email, "check-email");
    const status = rateStatus(keys, CHECK_EMAIL_WINDOW_MS, CHECK_EMAIL_LIMIT);
    if (status.limited) return sendRateLimit(res, status);
    recordRate(keys, CHECK_EMAIL_WINDOW_MS);
    const exists = email === ADMIN_EMAIL || data.users.some(user => user.email === email && user.passwordHash);
    return sendJson(res, 200, { email, exists });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    const loginKeys = authLimiterKeys(req, email, "login");
    const loginStatus = rateStatus(loginKeys, LOGIN_WINDOW_MS, LOGIN_FAILURE_LIMIT);
    if (loginStatus.limited) return sendRateLimit(res, loginStatus);
    if (email === ADMIN_EMAIL && body.password === ADMIN_PASSWORD) {
      const token = makeToken();
      const adminToken = makeToken();
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 12 * 60 * 60_000).toISOString();
      data.userSessions.push({ token, email, createdAt: now, expiresAt });
      data.adminSessions.push({ token: adminToken, email, createdAt: now, expiresAt });
      clearRate(loginKeys);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { token, adminToken, email, role: "admin" });
    }
    const user = data.users.find(item => item.email === email && item.passwordHash);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      recordRate(loginKeys, LOGIN_WINDOW_MS);
      return sendJson(res, 401, { error: "邮箱或密码不正确。" });
    }
    const token = makeToken();
    data.userSessions.push({
      token,
      email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
    });
    clearRate(loginKeys);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { token, email });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/verify") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    const code = cleanText(body.code, 12);
    const password = String(body.password || "");
    if (password.length < 8) {
      return sendJson(res, 400, { error: "请设置至少 8 位密码。" });
    }
    const record = data.verifications.find(item => item.email === email);
    if (!record || new Date(record.expiresAt) <= new Date()) {
      return sendJson(res, 400, { error: "验证码不存在或已过期。" });
    }
    if ((record.purpose || "register") !== "register") {
      return sendJson(res, 400, { error: "请使用注册验证码完成注册。" });
    }
    record.attempts += 1;
    if (record.attempts > 5 || record.codeHash !== hashCode(code)) {
      await writeJson(DATA_FILE, data);
      return sendJson(res, 400, { error: "验证码不正确。" });
    }
    const user = data.users.find(item => item.email === email) || { id: crypto.randomUUID(), email, createdAt: new Date().toISOString() };
    user.verifiedAt = new Date().toISOString();
    user.passwordHash = hashPassword(password);
    if (!data.users.some(item => item.email === email)) data.users.push(user);
    const token = makeToken();
    data.userSessions.push({
      token,
      email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
    });
    data.verifications = data.verifications.filter(item => item.email !== email);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { token, email });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/reset-password") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    const code = cleanText(body.code, 12);
    const password = String(body.password || "");
    if (password.length < 8) {
      return sendJson(res, 400, { error: "请设置至少 8 位新密码。" });
    }
    const user = data.users.find(item => item.email === email && item.passwordHash);
    if (!user) return sendJson(res, 404, { error: "该邮箱还没有注册账号。" });
    const record = data.verifications.find(item => item.email === email);
    if (!record || (record.purpose || "register") !== "reset" || new Date(record.expiresAt) <= new Date()) {
      return sendJson(res, 400, { error: "重置验证码不存在或已过期。" });
    }
    record.attempts += 1;
    if (record.attempts > 5 || record.codeHash !== hashCode(code)) {
      await writeJson(DATA_FILE, data);
      return sendJson(res, 400, { error: "验证码不正确。" });
    }
    user.passwordHash = hashPassword(password);
    user.verifiedAt = user.verifiedAt || new Date().toISOString();
    data.verifications = data.verifications.filter(item => item.email !== email);
    const token = makeToken();
    data.userSessions.push({
      token,
      email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
    });
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { token, email });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getUserBySession(data, requestToken(req, url));
    return sendJson(res, 200, { user: user ? { email: user.email, verifiedAt: user.verifiedAt } : null });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/delete-account") {
    const body = JSON.parse(await readBody(req) || "{}");
    const user = getUserBySession(data, requestToken(req, url, body));
    if (!user) return sendJson(res, 401, { error: "请先登录后再注销账户。" });
    const result = deleteAccountForUser(data, user);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = JSON.parse(await readBody(req) || "{}");
    const email = normalizeEmail(body.email);
    const loginKeys = authLimiterKeys(req, email, "login");
    const loginStatus = rateStatus(loginKeys, LOGIN_WINDOW_MS, LOGIN_FAILURE_LIMIT);
    if (loginStatus.limited) return sendRateLimit(res, loginStatus);
    if (normalizeEmail(body.email) !== ADMIN_EMAIL || body.password !== ADMIN_PASSWORD) {
      recordRate(loginKeys, LOGIN_WINDOW_MS);
      return sendJson(res, 401, { error: "管理员账号或密码不正确。" });
    }
    const token = makeToken();
    data.adminSessions.push({
      token,
      email: ADMIN_EMAIL,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString()
    });
    clearRate(loginKeys);
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { token, email: ADMIN_EMAIL });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const adminBody = req.method === "GET" ? {} : JSON.parse(await readBody(req) || "{}");
    const token = requestToken(req, url, adminBody, "adminToken");
    if (!requireAdmin(data, token)) return sendJson(res, 401, { error: "需要管理员登录。" });

    if (req.method === "GET" && url.pathname === "/api/admin/backup") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      return sendJsonDownload(res, data, `moonshade-backup-${timestamp}.json`);
    }
    if (req.method === "GET" && url.pathname === "/api/admin/profiles") {
      const frequencyMap = frequencyMapFor(data.profiles.filter(isActiveProfile), data.matches, data.settings);
      return sendJson(res, 200, { profiles: data.profiles.map(profile => adminProfile(profile, { frequencyMap })), users: data.users });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/matches") {
      const changed = ensureDailyDraftMatches(data);
      if (changed) await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { matches: serializeAdminMatches(data.matches, data.profiles, data.settings), profiles: data.profiles.map(publicProfile) });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/settings") {
      return sendJson(res, 200, { settings: cleanSettings(data.settings), round: currentRound(new Date(), data.settings) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/settings") {
      data.settings = cleanSettings(adminBody.settings || adminBody);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { settings: data.settings, round: currentRound(new Date(), data.settings) });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/announcements") {
      return sendJson(res, 200, { announcements: data.announcements || [] });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/community") {
      return sendJson(res, 200, { community: data.community || defaultData.community });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/community/save") {
      try {
        data.community = cleanCommunity(adminBody.community || adminBody, data.community || defaultData.community);
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { community: data.community });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/community/delete") {
      data.community = { ...defaultData.community };
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { community: data.community });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/announcements/save") {
      const source = adminBody.announcement || adminBody;
      const existing = (data.announcements || []).find(item => item.id === cleanText(source.id, 80));
      const announcement = cleanAnnouncement(source, existing);
      if (!announcement.title || !announcement.body) return sendJson(res, 400, { error: "公告标题和正文不能为空。" });
      data.announcements = existing
        ? data.announcements.map(item => item.id === existing.id ? announcement : item)
        : [announcement, ...(data.announcements || [])];
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { announcements: data.announcements });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/announcements/delete") {
      const id = cleanText(adminBody.id, 80);
      data.announcements = (data.announcements || []).filter(item => item.id !== id);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { announcements: data.announcements });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/generate") {
      const roundId = currentRound(new Date(), data.settings).id;
      const generated = replaceRoundDraftMatches(data, roundId);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { matches: serializeAdminMatches(generated, data.profiles, data.settings, data.matches) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/publish") {
      const roundId = currentRound(new Date(), data.settings).id;
      const byId = new Map(data.profiles.map(profile => [profile.id, profile]));
      let published = 0;
      data.matches.forEach(match => {
        if (match.roundId === roundId && match.status === "draft") {
          const left = byId.get(match.leftId);
          const right = byId.get(match.rightId);
          if (!isActiveProfile(left) || !isActiveProfile(right) || !hardBoundaryCompatible(left, right)) return;
          match.status = "published";
          match.publishedAt = new Date().toISOString();
          match.updatedAt = new Date().toISOString();
          published += 1;
        }
      });
      if (published > 0) replaceRoundDraftMatches(data, roundId);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { published, matches: serializeAdminMatches(data.matches, data.profiles, data.settings) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/preview") {
      const left = data.profiles.find(item => item.id === cleanText(adminBody.leftId, 80));
      const right = data.profiles.find(item => item.id === cleanText(adminBody.rightId, 80));
      if (!left || !right) return sendJson(res, 404, { error: "候选用户不存在。" });
      if (!isActiveProfile(left) || !isActiveProfile(right)) return sendJson(res, 400, { error: "暂停匹配或未授权用户不能进入候选。" });
      if (!hardBoundaryCompatible(left, right)) return sendJson(res, 400, { error: "性别、学校、校区或年龄不符合硬性条件。" });
      return sendJson(res, 200, { preview: matchPreview(left, right, data.matches.filter(item => item.status === "published"), data.settings, data.profiles) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/best-for") {
      const profile = data.profiles.find(item => item.id === cleanText(adminBody.profileId, 80));
      if (!profile) return sendJson(res, 404, { error: "用户不存在。" });
      if (!isActiveProfile(profile)) return sendJson(res, 400, { error: "该用户暂停匹配或未授权参与匹配。" });
      const preview = bestCrossWeightMatchFor(profile, data.profiles, data.matches, data.settings);
      if (!preview) return sendJson(res, 404, { error: "暂时没有可计算的匹配对象。" });
      return sendJson(res, 200, {
        target: preview.left,
        best: preview.right,
        preview
      });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/delete") {
      const matchId = cleanText(adminBody.matchId, 80);
      const before = data.matches.length;
      data.matches = data.matches.filter(item => item.id !== matchId);
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { deleted: before - data.matches.length, matches: serializeAdminMatches(data.matches, data.profiles, data.settings) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/demo-users") {
      const result = seedDemoProfiles(data);
      await writeJson(DATA_FILE, data);
      const frequencyMap = frequencyMapFor(data.profiles.filter(isActiveProfile), data.matches, data.settings);
      return sendJson(res, 200, { ...result, profiles: data.profiles.map(profile => adminProfile(profile, { frequencyMap })) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/demo-users/delete") {
      const result = deleteDemoProfiles(data);
      await writeJson(DATA_FILE, data);
      const frequencyMap = frequencyMapFor(data.profiles.filter(isActiveProfile), data.matches, data.settings);
      return sendJson(res, 200, { ...result, profiles: data.profiles.map(profile => adminProfile(profile, { frequencyMap })) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/matches/update") {
      const body = adminBody;
      const match = data.matches.find(item => item.id === body.matchId);
      if (!match) return sendJson(res, 404, { error: "匹配记录不存在。" });
      if (body.leftId) match.leftId = cleanText(body.leftId, 80);
      if (body.rightId) match.rightId = cleanText(body.rightId, 80);
      const left = data.profiles.find(item => item.id === match.leftId);
      const right = data.profiles.find(item => item.id === match.rightId);
      if (!isActiveProfile(left) || !isActiveProfile(right)) return sendJson(res, 400, { error: "暂停匹配或未授权用户不能被推送匹配。" });
      if (!hardBoundaryCompatible(left, right)) return sendJson(res, 400, { error: "性别、学校、校区或年龄不符合硬性条件。" });
      const historyMatches = data.matches.filter(item => item.status === "published" && item.id !== match.id);
      const preview = left && right ? matchPreview(left, right, historyMatches, data.settings, data.profiles) : null;
      if (preview) {
        match.score = preview.score;
        delete match.rawScore;
        delete match.maxScore;
        match.crossWeight = preview.crossWeight;
        match.personalWeight = preview.personalWeight;
        match.adjustedScore = preview.adjustedScore;
        match.weightBreakdown = preview.weightBreakdown;
        match.reasons = preview.reasons;
        match.booleanGate = preview.booleanGate;
        match.orientationWeight = preview.orientationWeight;
        match.interestMatchCount = preview.interestMatchCount;
        match.freeTextInterestHits = preview.freeTextInterestHits;
        match.softViolationCount = preview.softViolationCount;
        match.hardBlocked = preview.hardBlocked;
      }
      if (body.status) {
        const nextStatus = cleanText(body.status, 30);
        if (nextStatus === "published" && match.status !== "published") match.publishedAt = new Date().toISOString();
        match.status = nextStatus;
      }
      match.notes = cleanText(body.notes, 500);
      match.updatedAt = new Date().toISOString();
      if (match.status === "published") {
        const blockedIds = new Set([match.leftId, match.rightId]);
        data.matches = data.matches.filter(item =>
          item.id === match.id
          || item.status !== "draft"
          || (!blockedIds.has(item.leftId) && !blockedIds.has(item.rightId))
        );
        replaceRoundDraftMatches(data, match.roundId || currentRound(new Date(), data.settings).id);
      }
      await writeJson(DATA_FILE, data);
      return sendJson(res, 200, { match: serializeAdminMatches([match], data.profiles, data.settings, data.matches)[0] });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/round") {
    const round = currentRound(new Date(), data.settings);
    const roundProfiles = data.profiles.filter(isActiveProfile);
    const publishedMatchCount = data.matches.filter(match => match.status === "published").length;
    return sendJson(res, 200, {
      round,
      settings: cleanSettings(data.settings),
      stats: {
        participants: roundProfiles.length,
        women: roundProfiles.filter(profile => profile.gender === "女").length,
        men: roundProfiles.filter(profile => profile.gender === "男").length,
        publishedMatches: publishedMatchCount,
        matchedPeople: publishedMatchCount * 2
      },
      announcements: data.announcements || [],
      community: data.community || defaultData.community
    });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const token = url.searchParams.get("token");
    const authUser = getUserBySession(data, requestToken(req, url));
    const profile = authUser
      ? data.profiles.find(item => item.email === authUser.email)
      : data.profiles.find(item => item.token === token);
    const activeProfiles = data.profiles.filter(isActiveProfile);
    const frequencyMap = frequencyMapFor(activeProfiles, data.matches, data.settings);
    return sendJson(res, 200, {
      profile: profile ? {
        ...profile,
        matchFrequency: frequencyMap.get(profile.id) || null
      } : null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/profile") {
    const body = JSON.parse(await readBody(req) || "{}");
    const authUser = getUserBySession(data, requestToken(req, url, body));
    if (!authUser) return sendJson(res, 401, { error: "请先完成校内邮箱验证。" });
    const existing = data.profiles.find(item => item.email === authUser.email);
    const profile = sanitizeProfile({ ...body, email: authUser.email }, existing, data.settings);
    const missing = validateProfile(profile);
    if (missing.length) {
      return sendJson(res, 400, { error: "问卷还没填完整", missing });
    }
    if (existing) {
      Object.assign(existing, profile);
    } else {
      data.profiles.push(profile);
    }
    await writeJson(DATA_FILE, data);
    return sendJson(res, 200, { profile });
  }

  if (req.method === "POST" && url.pathname === "/api/profile/match-paused") {
    const body = JSON.parse(await readBody(req) || "{}");
    const authUser = getUserBySession(data, requestToken(req, url, body));
    if (!authUser) return sendJson(res, 401, { error: "请先完成校内邮箱验证。" });
    const profile = data.profiles.find(item => item.email === authUser.email);
    if (!profile) return sendJson(res, 404, { error: "还没有找到你的问卷，请先提交。" });
    const paused = body.paused === true;
    profile.matchPaused = paused;
    profile.matchPausedAt = paused ? new Date().toISOString() : "";
    profile.updatedAt = new Date().toISOString();
    const roundId = currentRound(new Date(), data.settings).id;
    if (paused) {
      data.matches = data.matches.filter(match =>
        match.status !== "draft"
        || (match.leftId !== profile.id && match.rightId !== profile.id)
      );
    }
    replaceRoundDraftMatches(data, roundId);
    await writeJson(DATA_FILE, data);
    const activeProfiles = data.profiles.filter(isActiveProfile);
    const frequencyMap = frequencyMapFor(activeProfiles, data.matches, data.settings);
    return sendJson(res, 200, {
      profile: publicProfile(profile, { frequencyMap })
    });
  }

  if (req.method === "GET" && url.pathname === "/api/matches") {
    const token = url.searchParams.get("token");
    const authUser = getUserBySession(data, requestToken(req, url));
    const profile = authUser
      ? data.profiles.find(item => item.email === authUser.email)
      : data.profiles.find(item => item.token === token);
    if (!profile) return sendJson(res, 404, { error: "还没有找到你的问卷，请先提交。" });
    const activeProfiles = data.profiles.filter(isActiveProfile);
    const frequencyMap = frequencyMapFor(activeProfiles, data.matches, data.settings);
    const matches = publishedMatchesFor(profile, data.profiles.filter(item => item.consent), data.matches);
    return sendJson(res, 200, { profile: publicProfile(profile, { frequencyMap }), matches });
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    return res.end("Forbidden");
  }
  try {
    await stat(filePath);
    const ext = extname(filePath);
    res.writeHead(200, securityHeaders({
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    }));
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Not found");
  }
}

await ensureDataFile();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器错误" });
  }
});

server.listen(PORT, () => {
  console.log(`MoonShade is running at http://localhost:${PORT}`);
});
