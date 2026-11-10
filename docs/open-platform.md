# NODELOG 对接 LINK ONE 开放平台

范围：**开放平台除「扫码支付」外的全部对外接口**；登录改为微信扫码登录；前端所有页面支持微信 JS-SDK 自定义分享。

契约来源：`https://jiangzi.xin/open-platform.html`、开放平台服务端源码实读（`D:/code/LINKONE/server/app/api/`）、线上接口 curl 实测；分享避坑依据 `https://jiangzi.xin/wechat-share-pitfalls.html` 与已真机双端验证的 `方案报价/assets/wechat-share.js` v4。

---

## 一、接口清单与本站映射

上游 API 域名 `https://ai.jiangzi.xin`。AppID / AppSecret 只在服务端出现，前端一律不接触。

| # | 开放平台接口 | 本站路由 | 用途 |
|---|---|---|---|
| 1 | `GET /api/auth/createToken?app_id={AppID}` | `GET /open/qrcode` | 生成扫码 token + 小程序码（base64 data URI），token 有效期 300 秒 |
| 2 | `GET /api/auth/status?token={token}` | `GET /open/status` | 轮询 `pending / expired / confirmed`；confirmed 时返回 JWT，本站验签后建立会话 |
| 3 | `GET /api/wechat/jsConfig?url={当前页URL}` | `GET /open/jsConfig` | 公众号 JS-SDK 签名，返回 `wx.config` 所需 4 要素 |
| 4 | `HS256({AppSecret})` JWT 验签 | `services/openJwt.js` | 本地校验登录凭证，实现 30 天免登录 |

**按需求排除**：`/api/pay/create`、`/api/pay/info`、`/api/pay/status`（扫码支付）。

**不属于网站侧接口，无需对接**：`POST /api/auth/confirm`（LINK ONE 小程序端调用）、`/api/wechat/index`（公众号服务器回调）。开放平台标注「规划中」的用户头像/昵称授权目前无接口，因此没有对应代码。

### 上游返回结构（实读，实现按此写）

```
createToken 成功  {"code":1,"data":{"token":"<32位md5>","qrcodeUrl":"data:image/png;base64,..."}}
createToken 失败  {"code":0,"msg":"应用不存在或已被禁用","data":[]}
status 待扫码     {"code":1,"data":{"status":"pending"}}
status 已过期     {"code":1,"data":{"status":"expired"}}
status 已确认     {"code":1,"data":{"status":"confirmed","token":"<JWT>","userId":"123","phone":"138...","isWhitelist":false}}
jsConfig          {"code":1,"data":{"config":{"appId","timestamp","nonceStr","signature","jsApiList","debug","beta","url","openTagList"}}}
JWT               HS256 / header {"alg":"HS256","typ":"JWT"} / payload {userId,phone,isWhitelist,iat,exp} / exp = iat+2592000
```

---

## 二、配置

`settings.js` 已被 `.gitignore` 忽略，生产环境用环境变量注入密钥：

```bash
OPEN_APP_ID=你的AppID \
OPEN_APP_SECRET=你的AppSecret \
OPEN_ADMIN_PHONES=13800138000 \
SESSION_SECRET=随机长字符串 \
NODE_ENV=production \
npm start
```

| 变量 | 说明 |
|---|---|
| `OPEN_APP_ID` | 开放平台应用 AppID（商家后台 → 开放平台 → 立即申请） |
| `OPEN_APP_SECRET` | 同页获取的 AppSecret，**仅服务端用于 HS256 验签** |
| `OPEN_ADMIN_PHONES` | 逗号分隔；命中的手机号扫码后授予管理员 `role=0`，留空则全部为普通用户 `role=1` |
| `OPEN_API_BASE` | 上游域名，默认 `https://ai.jiangzi.xin` |
| `OPEN_SHARE_COVER` | 分享封面绝对 HTTPS 地址，默认 `https://blog.jiangzi.xin/images/share-cover.png`（项目内 480×480 PNG） |
| `SITE_HOST` | 生成 `og:url` 的域名，反代场景优先取 `X-Forwarded-Host` |

未配置 AppID / AppSecret 时，扫码接口返回明确提示而不是报错或打上游。

---

## 三、扫码登录链路

```
用户点「扫码登录」
  → GET /open/qrcode        本站服务端带 AppID 请求上游 createToken
  → 拿到 token + 小程序码 base64，弹层展示
  → 每 1.5s GET /open/status?token=...  轮询（上限 300 秒）
  → 用户在 LINK ONE 小程序内授权手机号，小程序调上游 auth/confirm
  → 本站轮询拿到 status=confirmed + JWT
  → 用 AppSecret 做 HS256 验签（常量时间比较 + exp 校验）
  → 按 payload.userId 找/建本地 user（openUserId 唯一键）
  → 写 req.session.user + httpOnly cookie nl_open_jwt（30 天）
  → 前端 location.reload()
```

- 新用户：`wx_{userId}` 为用户名，昵称取脱敏手机号，密码为随机串的 bcrypt 哈希（仅满足旧 Schema 的 required 约束，不可用于登录），`role` 由 `OPEN_ADMIN_PHONES` 决定。
- 免登录：`app.js` 的 `restoreUser` 中间件在无 session 但 cookie 有效时自动恢复登录态；退出登录同时清 session 与 cookie。
- 原有账号密码登录保留作为管理员应急入口（`/user/login` 仍限制 `nodelog` 账号），扫码是默认主入口。

---

## 四、全站微信分享

### 覆盖路径

所有 34 个 EJS 页面都经过 `views/header.ejs`（前台）/ `views/manager/header.ejs`（后台），以及 `views/footer.ejs` / `views/manager/footer.ejs`。因此只在公共 head/footer 注入即覆盖全站，包括 404/500 的 `error.ejs`、`clock.ejs`、后台各页，无需逐页改模板。

**注意：head 模板有两份，改分享逻辑必须同步两份。** 接入期间并行的「前台设计改造」把 `views/header.ejs` 的 include 从 `common/meta` 换成了 `common/meta-front`（前台精简 CSS 的新版 head），后台 `views/manager/header.ejs` 仍用 `common/meta`。目前 `meta-front.ejs` 与 `meta.ejs` 都含有完全一致的 OG/Twitter 标签、`WX_SHARE_CONFIG` 安全注入与 `wechat-share.js` 引用；`footer.ejs` 与 `manager/footer.ejs` 都含有 `qr-login.js` 引用。后续若调整分享参数或封面，请两份一起改（更彻底的做法是抽成 `common/wechat-share-meta.ejs` 由两份 head 共同 include）。

### 关键实现（对应避坑指南的 P0/P1）

| 坑 | 本项目的做法 |
|---|---|
| 入口白名单（P0） | 代码无法绕过；对外分发用二维码或公众号菜单，见第六节 |
| `imgUrl` 为空降级（P0） | 默认封面 `public/images/share-cover.png`（480×480、2.2KB、HTTPS 静态直链），EJS 输出 `og:image` |
| `link ≠ 当前页 URL`（P0） | `shareLink = signUrl = location.href.split('#')[0]`，不剥离任何 query |
| 多个分享接口同步连调（P1） | 单一策略 + 350ms 错峰串行，支持 `?mode=new\|legacy\|both` 真机切换 |
| `jsApiList` 混入未授权接口（P1） | **不使用上游返回的 jsApiList**（实测含 `chooseWXPay`/`getLocation`/`openAddress`），只声明 4 个分享接口 |
| 缺 OG 标签（P1） | `meta.ejs` 补齐 og:type/locale/title/description/image/url/site_name + twitter:card |
| 签名 URL 带 hash（P1） | 前端去 `#`，本站代理原样透传已解码 URL 再编码给上游（上游内部 `urldecode`） |
| `location.origin` 在部分 WebView 为 undefined | 用 `location.protocol + '//' + location.host` 拼绝对地址 |
| 缓存 | 脚本带 `?v=` 版本号；HTML 已全局 `Cache-Control: no-cache` |
| 调试参数外发 | `?debug=1` 才开面板与 `wx.config({debug:true})`，对外链接保持干净 |

微信 JS-SDK（`public/js/jweixin-1.6.0.js`）已**本地自托管**，不依赖任何外部 CDN。

---

## 五、文件清单

**新增**：`services/openPlatform.js`（上游 3 接口封装，内置 https，无新依赖）、`services/openJwt.js`（HS256 验签）、`controllers/openAuth.js`（4 个 handler + 免登录中间件）、`public/js/wechat-share.js`、`public/js/qr-login.js`、`public/js/jweixin-1.6.0.js`、`public/images/share-cover.png`、`docs/open-platform.md`。

**修改**：`models/User.js`（openUserId/phone/loginType + 两个 DAO 方法）、`controllers/user.js`（logout 清免登录 cookie）、`routes/index.js`（挂载 `/open/*` 并限流）、`app.js`（免登录恢复 + 分享元数据）、`settings.js` / `settings.example.js`、`views/common/meta.ejs`、`views/header.ejs`、`views/footer.ejs`、`views/manager/footer.ejs`。

---

## 六、上线前 Checklist

1. 公众号后台把 `blog.jiangzi.xin` 加入「JS 接口安全域名」（主域配置可覆盖子域）。
2. 商家后台申请开放平台应用，把 AppID / AppSecret 用环境变量注入并重启。
3. 需要用扫码账号进后台时，把该手机号写入 `OPEN_ADMIN_PHONES`。
4. **可信入口验证**：把链接发到公众号消息或扫码进入后再点「···」分享；从聊天窗口直接点开的链接会被微信主动降级为纯文本链接，代码无法绕过。
5. iOS + Android 真机各验一次；异常时 URL 加 `?debug=1` 看脚本版本、签名结果、`checkJsApi`、每个分享接口的 ok/fail。
6. 确认封面 `https://blog.jiangzi.xin/images/share-cover.png` 可直连 GET；如需换成品牌图，改 `OPEN_SHARE_COVER` 即可。
7. 同 URL 的分享元信息微信会强缓存，改标题/封面后可加 `?v=日期` 强制重爬（该参数不参与签名比对以外的逻辑）。

---

## 七、本地验证命令

```bash
cd D:/code/NODELOG
node --check app.js && node --check routes/index.js
node --check services/openPlatform.js && node --check services/openJwt.js
node --check controllers/openAuth.js && node --check models/User.js
node --check public/js/wechat-share.js && node --check public/js/qr-login.js

# 起服务后（无需 AppID 即可验签名代理）
curl "http://127.0.0.1:3000/open/jsConfig?url=https%3A%2F%2Fblog.jiangzi.xin%2F"
curl -i "http://127.0.0.1:3000/" | grep -iE "og:title|og:image|wechat-share|jweixin|qr-login"

# 一键自检（16 项，含真实上游签名服务 + HTTP 层集成，不需要 MongoDB / AppID）
node scripts/verify-open-platform.js
```

---

## 八、限流与降级

| 路由 | 阈值 | 依据 |
|---|---|---|
| `/open/qrcode` | 15 次/分钟/IP | 一次扫码只需 1 个二维码，留足刷新余量 |
| `/open/status` | 90 次/分钟/IP | 前端每 1.5s 轮询 ≈ 40 次/分钟，需容纳多标签与重试；低于 40 会把正常扫码打回 429 |
| `/open/jsConfig` | 60 次/分钟/IP | 每页一次签名 |

上游请求统一 8 秒整体 + socket 空闲双超时、响应体封顶 1MB（小程序码是 base64 data URI）、`code!==1` 视为失败；错误信息经 AppSecret 脱敏并截断 200 字，只留一条带关联 ID 的纯文本简报。未配置 AppID/AppSecret 时扫码接口直接返回明确提示，不打上游。

**装配侧输入净化**：`shareCover` 会进入内联 `<script>` 与 OG 属性，`X-Forwarded-Host` / `X-Forwarded-Proto` 又可被客户端伪造。`app.js` 在写入 `res.locals` 前拒绝引号、反斜杠、尖括号、空白与控制字符，封面只接受 `https://` 绝对地址，Host 不匹配域名形态时回退到 `settings.openPlatform.siteHost`，非法封面回退到项目自带封面；前端 `WX_SHARE_CONFIG` 再用 `JSON.stringify` + `<` → `\u003c` 做第二层转义。恶意值注入测试已验证不会破坏脚本或标签。

**二维码 src 白名单**：后端 `/open/qrcode` 校验上游返回的 `token` 必须是 32 位 md5、`qrcodeUrl` 只允许 `data:image/` 或 `https://` 且不含引号/尖括号/空白；前端 `qr-login.js` 赋值前二次校验，拒绝 `javascript:` 与 `data:text/html`。

**非微信浏览器不请求签名服务**：jweixin-1.6.0.js 在非微信环境也会定义 `wx`，若只判断 `typeof wx` 会让全站每个页面白打一次签名请求，因此 `wechat-share.js` 额外加了 `MicroMessenger` UA 门控；微信内行为完全不变。

**登录弹层接管**：`public/js/common.js` 有 6+ 处 `$('.js-login-btn').click()` 程序化触发，jQuery 1.10.2 对 `<a>` 的 `trigger('click')` 不产生原生 click 事件，捕获阶段监听收不到。因此 `qr-login.js` 除捕获阶段拦截外，还用 MutationObserver 精确识别「含 `.js-signIn-btn` 的 layer 登录弹层」并改开二维码弹层；注册弹层（`.js-signUp-btn`）与提示层不匹配，不会被误伤。全程未改 941 行的 `common.js`。

---

## 九、验证记录（本次实跑）

`node scripts/verify-open-platform.js` → **16 项通过 / 0 失败**：

- JWT：正确密钥、错误密钥、过期、格式错误、空值；
- 配置：字段齐全、未配置时降级、不外泄 AppSecret；
- 上游签名服务（真实联网）：拿到 signature / timestamp、带 query 的 URL 原样回显；实测上游 `jsApiList` 共 11 条且含 `chooseWXPay`/`getLocation` 等未授权接口，印证前端必须自行收敛到 4 条；
- HTTP 层集成（真实 Express 路由）：`/open/qrcode` 降级、`/open/status` 非法 token 400、`/open/jsConfig` 返回签名且 URL 未二次编码、`/open/logout` 清除 30 天 cookie。

另跑：12 个 JS 文件 `node --check` 全通过；`require('./app')` 模块加载通过；EJS 双数据集渲染冒烟（完整 / 缺变量）无 500、无 undefined；恶意 `shareCover` 注入测试确认 `<` 被转成 `\u003c`、单引号不破坏 JS 字符串、OG 属性被 HTML 转义。

**未做（环境限制，上线前需补）**：本机无 MongoDB 与浏览器，未做真浏览器渲染截图、未做微信 iOS/Android 真机分享验证；`createToken` 与 `auth/status` 的 confirmed 分支需要商家后台真实 AppID + 小程序授权才能走通，本次只验了参数校验、错误路径、JWT 验签单元与真实签名代理。界面门禁中 `design_presence_check.py` 在本 EJS 项目上因「无 HTML 节」除零报错（不适用），`layout_variety_check.py` 通过，`visual_metrics_check.py` 报的是既有站点历史样式项且 10 项需浏览器实测，均非本次接入引入。

---

## 十、上线前请你确认的三件事

前端第一版在此暂停，确认后再进真机验证 / 上线：

1. 扫码登录弹层的整体方向（自建 overlay，沿用站点 theme.css 令牌，深浅主题自适应）；
2. 有无一眼别扭之处（二维码尺寸、弹层文案、导航「扫码登录」措辞、分享封面是否为默认几何图）；
3. 功能范围是否合适（保留原有账号密码登录作为管理员应急入口，注册入口未动，未接支付）。
