/**
 * WhosTV 自动签到
 * 适配：Egern / Loon 兼容 [Argument] 模板参数
 *
 * 插件参数：
 * - http-request: argument=[{ENABLE_CAPTURE},{WHOSTV_COOKIE}]
 * - cron:         argument=[{TG_BOT_TOKEN},{TG_USER_ID},{TG_NOTIFY_ONLY_FAIL}]
 */

const SCRIPT_NAME = "WhosTV 自动签到";
const COOKIE_KEY = "WHOSTV_COOKIE";

const API = {
  signin: "https://whos.tv/api/user/tasks/signin",
  statistics: "https://whos.tv/api/user/statistics",
  todayPoints: "https://whos.tv/api/user/tasks/today-points",
};

let enableCapture = true;
let manualCookie = "";
let tgToken = "";
let tgUserId = "";
let notifyOnlyFail = false;

parseArguments();

const isRequest = typeof $request !== "undefined";

(async () => {
  try {
    if (isRequest) {
      handleCaptureCookie();
    } else {
      await handleSignin();
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.log(`[${SCRIPT_NAME}] 异常：${msg}`);
    await sendTelegram(`❌ ${SCRIPT_NAME}异常\n\n${msg}`, true);
  }
})().finally(() => {
  if (typeof $done !== "undefined") $done({});
});

function parseArguments() {
  console.log(`[${SCRIPT_NAME}] typeof $argument = ${typeof $argument}`);

  if (typeof $argument !== "object" || $argument === null) {
    console.log(`[${SCRIPT_NAME}] 未检测到对象形式 $argument，跳过模板参数解析`);
    return;
  }

  if ($argument.ENABLE_CAPTURE !== undefined) {
    enableCapture = $argument.ENABLE_CAPTURE === true || String($argument.ENABLE_CAPTURE) === "true";
  }

  if (isValid($argument.WHOSTV_COOKIE)) {
    manualCookie = String($argument.WHOSTV_COOKIE).trim();
    writeStore(COOKIE_KEY, manualCookie);
    console.log(`[${SCRIPT_NAME}] 手动 Cookie 已写入本地存储`);
  }

  if (isValid($argument.TG_BOT_TOKEN)) {
    tgToken = String($argument.TG_BOT_TOKEN).trim();
  }

  if (isValid($argument.TG_USER_ID)) {
    tgUserId = String($argument.TG_USER_ID).trim();
  }

  if ($argument.TG_NOTIFY_ONLY_FAIL !== undefined) {
    notifyOnlyFail = $argument.TG_NOTIFY_ONLY_FAIL === true || String($argument.TG_NOTIFY_ONLY_FAIL) === "true";
  }

  console.log(
    `[${SCRIPT_NAME}] 参数解析完成：` +
    ` enableCapture=${enableCapture}` +
    ` | tgToken=${tgToken ? "已配置" : "未配置"}` +
    ` | tgUserId=${tgUserId ? "已配置" : "未配置"}` +
    ` | notifyOnlyFail=${notifyOnlyFail}`
  );
}

function handleCaptureCookie() {
  if (!enableCapture) {
    console.log(`[${SCRIPT_NAME}] Cookie 抓取开关已关闭`);
    return;
  }

  const headers = $request.headers || {};
  const cookie = getHeader(headers, "Cookie");

  if (!cookie) {
    console.log(`[${SCRIPT_NAME}] 未从请求中获取到 Cookie`);
    notifyLocal("WhosTV Cookie 获取失败", "未在请求头中找到 Cookie");
    return;
  }

  const ok = writeStore(COOKIE_KEY, cookie);

  if (ok) {
    const url = ($request.url || "").replace(/\?.*$/, "");
    console.log(`[${SCRIPT_NAME}] Cookie 保存成功，来源：${url}`);
    notifyLocal("WhosTV Cookie 获取成功", "Cookie 已保存，可关闭抓取开关");
  } else {
    console.log(`[${SCRIPT_NAME}] Cookie 写入失败`);
    notifyLocal("WhosTV Cookie 保存失败", "写入本地存储失败");
  }
}

async function handleSignin() {
  const cookie = readStore(COOKIE_KEY);

  if (!cookie) {
    const msg = "未检测到 WhosTV Cookie，请开启 Cookie 抓取后登录 whos.tv 或访问积分任务页。";
    notifyLocal("WhosTV 签到失败", msg);
    await sendTelegram(`❌ WhosTV 签到失败\n\n${msg}`, true);
    return;
  }

  const headers = buildHeaders(cookie);

  const signResp = await fetchPromise({
    url: API.signin,
    method: "POST",
    headers,
    body: "",
  });

  const signData = parseJson(signResp.body);

  let statData = {};
  let todayData = {};

  try {
    const statResp = await fetchPromise({
      url: API.statistics,
      method: "GET",
      headers: buildHeaders(cookie),
    });
    statData = parseJson(statResp.body);
  } catch (e) {
    console.log(`[${SCRIPT_NAME}] 查询积分余额失败：${e.message || e}`);
  }

  try {
    const todayResp = await fetchPromise({
      url: API.todayPoints,
      method: "GET",
      headers: buildHeaders(cookie),
    });
    todayData = parseJson(todayResp.body);
  } catch (e) {
    console.log(`[${SCRIPT_NAME}] 查询今日积分失败：${e.message || e}`);
  }

  const success = isSigninSuccess(signResp.status, signData);
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

function isSigninSuccess(status, data) {
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

  const balance =
    statData?.data?.points_balance ??
    statData?.data?.points ??
    statData?.data?.balance ??
    "未知";

  const todayPoints =
    todayData?.data?.today_points ??
    todayData?.data?.points ??
    "未知";

  const icon = success ? "✅" : "❌";

  return `${icon} WhosTV 签到结果

状态：${signMsg}
代码：${code}
本次获得：${earned} 积分
连续签到：${days} 天
连续奖励：${bonus} 积分
今日积分：${todayPoints}
当前余额：${balance}`;
}

async function sendTelegram(text, isFail) {
  if (notifyOnlyFail && !isFail) {
    console.log(`[${SCRIPT_NAME}] 仅失败通知已开启，本次成功不推送 TG`);
    return;
  }

  if (!tgToken || !tgUserId) {
    console.log(`[${SCRIPT_NAME}] TG 参数未配置，跳过 TG 推送`);
    return;
  }

  const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;

  await fetchPromise({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: tgUserId,
      text,
      disable_web_page_preview: true,
    }),
  });
}

function fetchPromise(options) {
  return new Promise((resolve, reject) => {
    const method = String(options.method || "GET").toUpperCase();

    if (typeof $task !== "undefined") {
      $task.fetch(options).then(
        (resp) => resolve({
          status: resp.statusCode,
          headers: resp.headers || {},
          body: resp.body || "",
        }),
        reject
      );
      return;
    }

    if (typeof $httpClient !== "undefined") {
      const callback = (error, response, body) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          status: response.status || response.statusCode,
          headers: response.headers || {},
          body: body || "",
        });
      };

      if (method === "GET") {
        $httpClient.get(options, callback);
      } else {
        $httpClient.post(options, callback);
      }
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
  if (typeof $notification !== "undefined") {
    $notification.post(title, "", body);
  } else if (typeof $notify !== "undefined") {
    $notify(title, "", body);
  } else {
    console.log(`[${SCRIPT_NAME}] ${title}: ${body}`);
  }
}

function parseJson(body) {
  try {
    return JSON.parse(body || "{}");
  } catch (e) {
    return {
      message: body || "非 JSON 返回",
      data: {},
    };
  }
}

function isValid(val) {
  if (val === undefined || val === null) return false;
  const s = String(val).trim();
  return s !== "" && s !== "xxx" && s !== "无" && s.toLowerCase() !== "none";
}

function valueOrUnknown(v) {
  return v === undefined || v === null || v === "" ? "未知" : v;
}

function valueOrDefault(v, d) {
  return v === undefined || v === null || v === "" ? d : v;
}
