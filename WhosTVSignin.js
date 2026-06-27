/**
 * WhosTV 自动签到
 * 适配：Egern 模块环境变量 + QX/Surge/Loon 脚本环境
 *
 * Egern 模块环境变量建议：
 * TG_BOT_TOKEN=你的 Telegram Bot Token
 * TG_USER_ID=你的 Telegram User ID / Chat ID
 * ENABLE_CAPTURE=true
 * TG_NOTIFY_ONLY_FAIL=false
 * WHOSTV_COOKIE=可选，自动抓取失败时手动填写
 */

const SCRIPT_NAME = "WhosTV 自动签到";
const COOKIE_KEY = "WHOSTV_COOKIE";

const API = {
  signin: "https://whos.tv/api/user/tasks/signin",
  statistics: "https://whos.tv/api/user/statistics",
  todayPoints: "https://whos.tv/api/user/tasks/today-points",
};

const ENV = getEnv();

const enableCapture = toBool(readConfig("ENABLE_CAPTURE", "true"));
const manualCookie = readConfig("WHOSTV_COOKIE", "");
const tgToken = readConfig("TG_BOT_TOKEN", "");
const tgUserId = readConfig("TG_USER_ID", "");
const notifyOnlyFail = toBool(readConfig("TG_NOTIFY_ONLY_FAIL", "false"));

if (manualCookie) writeStore(COOKIE_KEY, manualCookie);

const isRequest = typeof $request !== "undefined";

(async () => {
  try {
    if (isRequest) {
      captureCookie();
    } else {
      await signin();
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.log(`[${SCRIPT_NAME}] 异常：${msg}`);
    await sendTelegram(`❌ ${SCRIPT_NAME}异常\n\n${msg}`, true);
  }
})().finally(() => {
  if (typeof $done !== "undefined") $done({});
});

function getEnv() {
  if (typeof ctx !== "undefined" && ctx && ctx.env) return ctx.env;
  if (typeof $argument === "object" && $argument !== null) return $argument;
  return {};
}

function readConfig(key, defaultValue) {
  const v = ENV[key];
  if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  return defaultValue;
}

function captureCookie() {
  if (!enableCapture) {
    console.log(`[${SCRIPT_NAME}] 已关闭自动抓取`);
    return;
  }

  const headers = $request.headers || {};
  const cookie = getHeader(headers, "Cookie");

  if (!cookie) {
    notifyLocal("WhosTV Cookie 获取失败", "没有在请求头中找到 Cookie");
    return;
  }

  const ok = writeStore(COOKIE_KEY, cookie);
  const url = String($request.url || "").replace(/\?.*$/, "");

  if (ok) {
    console.log(`[${SCRIPT_NAME}] Cookie 保存成功：${url}`);
    notifyLocal("WhosTV Cookie 获取成功", "已保存，成功后可把 ENABLE_CAPTURE 改为 false");
  } else {
    notifyLocal("WhosTV Cookie 保存失败", "写入本地存储失败");
  }
}

async function signin() {
  const cookie = readStore(COOKIE_KEY) || manualCookie;

  if (!cookie) {
    const msg = "没有 Cookie。请把 ENABLE_CAPTURE 设为 true，然后登录 whos.tv 并访问任务页。";
    notifyLocal("WhosTV 签到失败", msg);
    await sendTelegram(`❌ WhosTV 签到失败\n\n${msg}`, true);
    return;
  }

  const headers = buildHeaders(cookie);

  const signResp = await request({
    url: API.signin,
    method: "POST",
    headers,
    body: "",
  });

  const signData = parseJson(signResp.body);

  let statData = {};
  let todayData = {};

  try {
    const statResp = await request({ url: API.statistics, method: "GET", headers });
    statData = parseJson(statResp.body);
  } catch (e) {
    console.log(`[${SCRIPT_NAME}] 查询余额失败：${e.message || e}`);
  }

  try {
    const todayResp = await request({ url: API.todayPoints, method: "GET", headers });
    todayData = parseJson(todayResp.body);
  } catch (e) {
    console.log(`[${SCRIPT_NAME}] 查询今日积分失败：${e.message || e}`);
  }

  const success = isSuccess(signResp.status, signData);
  const msg = buildMessage(signResp.status, signData, statData, todayData, success);

  notifyLocal("WhosTV 签到结果", msg.replace(/\n/g, " | "));
  await sendTelegram(msg, !success);
}

function buildHeaders(cookie) {
  return {
    "Cookie": cookie,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "Origin": "https://whos.tv",
    "Referer": "https://whos.tv/points-center/tasks",
  };
}

function isSuccess(status, data) {
  const code = data && data.code;
  const msg = String((data && data.message) || "");
  if (status >= 200 && status < 300 && code === 200000) return true;
  if (msg.includes("成功") || msg.includes("已签到") || msg.toLowerCase().includes("already")) return true;
  return false;
}

function buildMessage(status, signData, statData, todayData, success) {
  const signMsg = signData.message || "未知返回";
  const code = signData.code || status || "未知";
  const data = signData.data || {};

  const earned = valueOrUnknown(data.points_earned);
  const days = valueOrUnknown(data.consecutive_days);
  const bonus = valueOrDefault(data.streak_bonus, 0);

  const balance = statData?.data?.points_balance ?? statData?.data?.points ?? statData?.data?.balance ?? "未知";
  const todayPoints = todayData?.data?.today_points ?? todayData?.data?.points ?? "未知";

  const icon = success ? "✅" : "❌";

  return `${icon} WhosTV 签到结果\n\n状态：${signMsg}\n代码：${code}\n本次获得：${earned} 积分\n连续签到：${days} 天\n连续奖励：${bonus} 积分\n今日积分：${todayPoints}\n当前余额：${balance}`;
}

async function sendTelegram(text, isFail) {
  if (notifyOnlyFail && !isFail) return;
  if (!tgToken || !tgUserId) {
    console.log(`[${SCRIPT_NAME}] 未配置 TG_BOT_TOKEN 或 TG_USER_ID，跳过 Telegram 推送`);
    return;
  }

  await request({
    url: `https://api.telegram.org/bot${tgToken}/sendMessage`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: tgUserId,
      text,
      disable_web_page_preview: true,
    }),
  });
}

function request(options) {
  return new Promise((resolve, reject) => {
    const method = String(options.method || "GET").toUpperCase();

    if (typeof $task !== "undefined") {
      $task.fetch(options).then(
        (resp) => resolve({ status: resp.statusCode, headers: resp.headers || {}, body: resp.body || "" }),
        reject
      );
      return;
    }

    if (typeof $httpClient !== "undefined") {
      const cb = (error, response, body) => {
        if (error) return reject(error);
        resolve({ status: response.status || response.statusCode, headers: response.headers || {}, body: body || "" });
      };
      if (method === "GET") $httpClient.get(options, cb);
      else $httpClient.post(options, cb);
      return;
    }

    reject(new Error("当前环境不支持网络请求"));
  });
}

function getHeader(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function readStore(key) {
  if (typeof $persistentStore !== "undefined") return $persistentStore.read(key);
  if (typeof $prefs !== "undefined") return $prefs.valueForKey(key);
  return "";
}

function writeStore(key, value) {
  if (typeof $persistentStore !== "undefined") return $persistentStore.write(value, key);
  if (typeof $prefs !== "undefined") return $prefs.setValueForKey(value, key);
  return false;
}

function notifyLocal(title, body) {
  if (typeof $notification !== "undefined") $notification.post(title, "", body);
  else if (typeof $notify !== "undefined") $notify(title, "", body);
  else console.log(`[${SCRIPT_NAME}] ${title}: ${body}`);
}

function parseJson(body) {
  try { return JSON.parse(body || "{}"); }
  catch { return { message: body || "非 JSON 返回", data: {} }; }
}

function toBool(v) {
  return v === true || String(v).trim().toLowerCase() === "true" || String(v).trim() === "1";
}

function valueOrUnknown(v) {
  return v === undefined || v === null || v === "" ? "未知" : v;
}

function valueOrDefault(v, d) {
  return v === undefined || v === null || v === "" ? d : v;
}
