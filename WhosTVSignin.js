// 2026/06/27
/*
@Name: WhosTV 自动签到
@Author: Ray
@Description: 自动抓取 whos.tv Cookie，每日签到，并通过 Telegram Bot 推送结果。

[rewrite_local]
^https:\/\/whos\.tv\/api\/(login|user\/profile|user\/statistics|user\/tasks\/today-points|user\/tasks\/signin) url script-request-header https://raw.githubusercontent.com/imzwr214/whos/main/WhosTVSignin.js

[task_local]
30 8 * * * https://raw.githubusercontent.com/imzwr214/whos/main/WhosTVSignin.js, tag=WhosTV 自动签到, enabled=true

[MITM]
hostname = whos.tv
*/

var SCRIPT_NAME = "WhosTV 自动签到";
var COOKIE_KEY = "WHOSTV_COOKIE";

var API = {
  signin: "https://whos.tv/api/user/tasks/signin",
  statistics: "https://whos.tv/api/user/statistics",
  todayPoints: "https://whos.tv/api/user/tasks/today-points"
};

var ENV = getEnv();
var enableCapture = toBool(readConfig("ENABLE_CAPTURE", "true"));
var manualCookie = readConfig("WHOSTV_COOKIE", "");
var tgToken = readConfig("TG_BOT_TOKEN", "");
var tgUserId = readConfig("TG_USER_ID", "");
var notifyOnlyFail = toBool(readConfig("TG_NOTIFY_ONLY_FAIL", "false"));

if (manualCookie) writeStore(COOKIE_KEY, manualCookie);

var isRequest = typeof $request !== "undefined";

main()
  .catch(function (e) {
    var msg = e && e.message ? e.message : String(e);
    console.log("[" + SCRIPT_NAME + "] 异常：" + msg);
    return sendTelegram("❌ " + SCRIPT_NAME + "异常\n\n" + msg, true);
  })
  .finally(function () {
    if (typeof $done !== "undefined") $done({});
  });

async function main() {
  if (isRequest) {
    captureCookie();
  } else {
    await signin();
  }
}

function getEnv() {
  if (typeof ctx !== "undefined" && ctx && ctx.env) return ctx.env;
  if (typeof $argument === "object" && $argument !== null) return $argument;
  return {};
}

function readConfig(key, defaultValue) {
  var v = ENV[key];
  if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();

  var stored = readStore(key);
  if (stored !== undefined && stored !== null && String(stored).trim() !== "") return String(stored).trim();

  return defaultValue;
}

function captureCookie() {
  if (!enableCapture) {
    console.log("[" + SCRIPT_NAME + "] 已关闭自动抓取");
    return;
  }

  var headers = $request.headers || {};
  var cookie = getHeader(headers, "Cookie");

  if (!cookie) {
    notifyLocal("WhosTV Cookie 获取失败", "没有在请求头中找到 Cookie");
    return;
  }

  var ok = writeStore(COOKIE_KEY, cookie);
  var url = String($request.url || "").replace(/\?.*$/, "");

  if (ok) {
    console.log("[" + SCRIPT_NAME + "] Cookie 保存成功：" + url);
    notifyLocal("WhosTV Cookie 获取成功", "已保存，成功后可关闭抓取");
  } else {
    notifyLocal("WhosTV Cookie 保存失败", "写入本地存储失败");
  }
}

async function signin() {
  var cookie = readStore(COOKIE_KEY) || manualCookie;

  if (!cookie) {
    var noCookieMsg = "没有 Cookie。请开启抓取后登录 whos.tv 并访问任务页。";
    notifyLocal("WhosTV 签到失败", noCookieMsg);
    await sendTelegram("❌ WhosTV 签到失败\n\n" + noCookieMsg, true);
    return;
  }

  var headers = buildHeaders(cookie);

  var signResp = await request({
    url: API.signin,
    method: "POST",
    headers: headers,
    body: ""
  });

  var signData = parseJson(signResp.body);
  var statData = {};
  var todayData = {};

  try {
    var statResp = await request({ url: API.statistics, method: "GET", headers: headers });
    statData = parseJson(statResp.body);
  } catch (e) {
    console.log("[" + SCRIPT_NAME + "] 查询余额失败：" + (e.message || e));
  }

  try {
    var todayResp = await request({ url: API.todayPoints, method: "GET", headers: headers });
    todayData = parseJson(todayResp.body);
  } catch (e) {
    console.log("[" + SCRIPT_NAME + "] 查询今日积分失败：" + (e.message || e));
  }

  var success = isSuccess(signResp.status, signData);
  var msg = buildMessage(signResp.status, signData, statData, todayData, success);

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
    "Referer": "https://whos.tv/points-center/tasks"
  };
}

function isSuccess(status, data) {
  var code = data && data.code;
  var msg = String((data && data.message) || "");
  if (status >= 200 && status < 300 && code === 200000) return true;
  if (msg.indexOf("成功") >= 0 || msg.indexOf("已签到") >= 0 || msg.toLowerCase().indexOf("already") >= 0) return true;
  return false;
}

function buildMessage(status, signData, statData, todayData, success) {
  var signMsg = signData.message || "未知返回";
  var code = signData.code || status || "未知";
  var data = signData.data || {};

  var earned = valueOrUnknown(data.points_earned);
  var days = valueOrUnknown(data.consecutive_days);
  var bonus = valueOrDefault(data.streak_bonus, 0);

  var statInner = statData && statData.data ? statData.data : {};
  var todayInner = todayData && todayData.data ? todayData.data : {};

  var balance = valueOrUnknown(
    statInner.points_balance !== undefined ? statInner.points_balance :
    statInner.points !== undefined ? statInner.points :
    statInner.balance
  );

  var todayPoints = valueOrUnknown(
    todayInner.today_points !== undefined ? todayInner.today_points : todayInner.points
  );

  var icon = success ? "✅" : "❌";

  return icon + " WhosTV 签到结果\n\n" +
    "状态：" + signMsg + "\n" +
    "代码：" + code + "\n" +
    "本次获得：" + earned + " 积分\n" +
    "连续签到：" + days + " 天\n" +
    "连续奖励：" + bonus + " 积分\n" +
    "今日积分：" + todayPoints + "\n" +
    "当前余额：" + balance;
}

async function sendTelegram(text, isFail) {
  if (notifyOnlyFail && !isFail) return;
  if (!tgToken || !tgUserId) {
    console.log("[" + SCRIPT_NAME + "] 未配置 TG_BOT_TOKEN 或 TG_USER_ID，跳过 Telegram 推送");
    return;
  }

  await request({
    url: "https://api.telegram.org/bot" + tgToken + "/sendMessage",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: tgUserId,
      text: text,
      disable_web_page_preview: true
    })
  });
}

function request(options) {
  return new Promise(function (resolve, reject) {
    var method = String(options.method || "GET").toUpperCase();

    if (typeof $task !== "undefined") {
      $task.fetch(options).then(
        function (resp) {
          resolve({ status: resp.statusCode, headers: resp.headers || {}, body: resp.body || "" });
        },
        reject
      );
      return;
    }

    if (typeof $httpClient !== "undefined") {
      var cb = function (error, response, body) {
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
  if (typeof $prefs !== "undefined") return $prefs.valueForKey(key);
  if (typeof $persistentStore !== "undefined") return $persistentStore.read(key);
  return "";
}

function writeStore(key, value) {
  if (typeof $prefs !== "undefined") return $prefs.setValueForKey(value, key);
  if (typeof $persistentStore !== "undefined") return $persistentStore.write(value, key);
  return false;
}

function notifyLocal(title, body) {
  if (typeof $notify !== "undefined") $notify(title, "", body);
  else if (typeof $notification !== "undefined") $notification.post(title, "", body);
  else console.log("[" + SCRIPT_NAME + "] " + title + ": " + body);
}

function parseJson(body) {
  try { return JSON.parse(body || "{}"); }
  catch (e) { return { message: body || "非 JSON 返回", data: {} }; }
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
