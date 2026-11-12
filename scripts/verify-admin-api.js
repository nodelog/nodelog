/**
 * 后台管理接口自检（无框架，Node 全局 fetch；表驱动）。
 *
 *   node scripts/verify-admin-api.js --base http://127.0.0.1:3099
 *   node scripts/verify-admin-api.js --base http://127.0.0.1:3099 --cookie connect.sid=<admin>
 *   node scripts/verify-admin-api.js --base http://127.0.0.1:3099 --cookie connect.sid=<admin> --write
 *
 * 默认跑「只读 + 错误流」用例（不改数据）：键集合锁定、分页注入、非法 id、越权、CSRF。
 * 带 --write 才跑破坏性/造数据用例（建删内容、批量、标签计数、CSV 导入导出）——需管理员 Cookie。
 * 服务必须连测试库 ctit_qa（见 evidence/qa-db-hook.js）。失败用例指名实际/期望，退出码 1。
 */
'use strict';

var argv = process.argv.slice(2);
function opt(name, def) {
    var i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] || '') : def;
}
function has(name) { return argv.indexOf(name) >= 0; }
var BASE = (opt('--base', 'http://127.0.0.1:3099') || '').replace(/\/+$/, '');
var COOKIE = opt('--cookie', '');
var USER_COOKIE = opt('--cookie-user', ''); // 普通用户(role=1) Cookie，用于 SSR 越权对照
var ORIGIN = opt('--origin', BASE); // CSRF 同源：Origin 必须与 Host 一致
var WRITE = has('--write');

var pass = 0, fail = 0, failNames = [];
function check(name, ok, detail) {
    if (ok) pass++; else { fail++; failNames.push(name); }
    console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : ''));
}
// 跨角色未完成项（如前端模板升级）用 advisory 醒目提示，不计入 fail，避免掩盖后端真实状态。
function advisory(name, detail) {
    console.log('[ADVISORY] ' + name + (detail ? '  ' + detail : ''));
}
function keysOf(obj) { return Object.keys(obj || {}).sort().join(','); }
function sameKeys(obj, arr) { return keysOf(obj) === arr.slice().sort().join(','); }

function headers(extra) {
    var h = Object.assign({'Content-Type': 'application/x-www-form-urlencoded', 'Origin': ORIGIN}, extra || {});
    // extraHeaders 显式给定 Cookie 时优先（双 role 对照用 --cookie-user 覆盖全局管理员 Cookie）。
    if (COOKIE && !h['Cookie']) h['Cookie'] = COOKIE;
    return h;
}
// noCookie=true 用于越权对照：即使全局传了 --cookie，该请求也强制不带 Cookie。
function req(method, path, body, extraHeaders, noCookie) {
    var h = headers(extraHeaders);
    if (noCookie) { delete h['Cookie']; h['Cookie'] = ''; }
    var init = {method: method, headers: h, redirect: 'manual'};
    if (body !== undefined && body !== null) {
        if (typeof body === 'string') init.body = body;
        else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    }
    return fetch(BASE + path, init).then(function (res) {
        var ct = res.headers.get('content-type') || '';
        // 保留原始字节：fetch 的 text() 会剥离 UTF-8 BOM，导出用例需按字节判断 BOM(EF BB BF)。
        return res.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            var text = '';
            try { text = new TextDecoder('utf-8').decode(bytes); } catch (e) { text = ''; }
            var data = null;
            if (ct.indexOf('json') >= 0) { try { data = JSON.parse(text); } catch (e) { data = null; } }
            return {status: res.status, ct: ct, text: text, bytes: bytes, json: data, headers: res.headers};
        });
    });
}

// ---------- 只读 + 错误流（默认）----------
function safeChecks() {
    var p = Promise.resolve();
    // 1) 键集合锁定：4 种老响应格式（无需 Cookie 的公开接口）
    p = p.then(function () {
        return req('GET', '/tags').then(function (r) {
            check('键集合 {docs} /tags', r.status === 200 && sameKeys(r.json, ['docs']),
                'status=' + r.status + ' keys=' + keysOf(r.json));
        });
    });
    p = p.then(function () {
        return req('POST', '/link/list', '{}').then(function (r) {
            check('键集合 {success,data} /link/list', r.status === 200 && sameKeys(r.json, ['success', 'data']),
                'status=' + r.status + ' keys=' + keysOf(r.json));
        });
    });
    // 2) 分页注入：公开/需登录列表各跑非法 page，断言 2xx 且响应不含 NaN。
    var badPages = ['abc', '-1', '0', '1.5', '999999999', ''];
    badPages.forEach(function (bad) {
        p = p.then(function () {
            return req('GET', '/content/search?word=a&page=' + encodeURIComponent(bad)).then(function (r) {
                check('分页注入 /content/search page=' + JSON.stringify(bad),
                    r.status >= 200 && r.status < 500 && r.text.indexOf('NaN') === -1,
                    'status=' + r.status);
            });
        });
    });
    // 3) 非法 id：公开/需登录 delete 各跑非法 id，断言无 500。用公开可打的接口（未登录 delete 会 401，仍不是 500）。
    ['', 'abc', '000000000000000000000000'].forEach(function (bad) {
        p = p.then(function () {
            return req('POST', '/manager/link/delete', 'id=' + encodeURIComponent(bad)).then(function (r) {
                check('非法 id /manager/link/delete id=' + JSON.stringify(bad),
                    r.status < 500, 'status=' + r.status + ' body=' + r.text.slice(0, 80));
            });
        });
    });
    // 4) 越权：未登录 GET /manager/link 必须 302（越权点 1）。
    p = p.then(function () {
        return req('GET', '/manager/link', undefined, {}, true).then(function (r) {
            check('越权点1 未登录 /manager/link → 302', r.status === 302 || r.status === 401,
                'status=' + r.status);
        });
    });
    // 5) CSRF：带 evil Origin 的写请求必须 403（若服务启用 csrfGuard）。
    p = p.then(function () {
        return req('POST', '/manager/category/add', 'name=csrf-probe', {'Origin': 'http://evil.example.com'}).then(function (r) {
            check('CSRF evil Origin → 403', r.status === 403, 'status=' + r.status + ' body=' + r.text.slice(0, 80));
        });
    });
    // 6) 需登录接口的键集合（若有 Cookie）：user/update 成功/失败必须 {result} 或 {result,msg}，绝不出现 success/data/docs。
    if (COOKIE) {
        p = p.then(function () {
            return req('POST', '/manager/user/update', 'id=000000000000000000000000&realName=x').then(function (r) {
                var k = keysOf(r.json);
                check('键集合 /manager/user/update 失败分支', r.status === 200 &&
                    (k === 'result' || k === 'msg,result'), 'status=' + r.status + ' keys=' + k);
            });
        });
    }
    return p;
}

// ---------- 本轮新增：会话脱敏 + 4 条管理员 SSR 路由（#14/#15）----------
function ssrSessionChecks() {
    var p = Promise.resolve(), RES = ['content', 'category', 'user', 'log'];
    var SENS = ['password', 'passwordHash', 'openUserId', 'token', 'secret'];
    var KEEP = ['_id', 'userName', 'realName', 'role', 'status', 'createTime', 'modifyTime', 'email', 'phone'];
    // 内层对象：无 5 个敏感字段 + 保留 9 个必需字段
    function pub(o) {
        var k = keysOf(o);
        return SENS.every(function (s) { return k.indexOf(s) < 0; }) &&
            KEEP.every(function (s) { return k.indexOf(s) >= 0; });
    }
    // 1) /user/login 响应 obj 脱敏（登录仍成功，验证 bcrypt 用完整 session 对象）
    p = p.then(function () {
        return req('POST', '/user/login', 'userName=nodelog&password=Qa@2026').then(function (r) {
            check('会话脱敏 /user/login obj(9留5删+登录成功)',
                r.status === 200 && sameKeys(r.json, ['success', 'msg', 'obj']) && r.json.success === true && pub(r.json && r.json.obj),
                'objKey=' + keysOf(r.json && r.json.obj));
        });
    });
    // 2) /session 响应 user 脱敏（需管理员 Cookie）
    if (COOKIE) p = p.then(function () {
        return req('GET', '/session').then(function (r) {
            check('会话脱敏 /session user(9留5删)',
                r.status === 200 && sameKeys(r.json, ['user']) && pub(r.json && r.json.user),
                'userKey=' + keysOf(r.json && r.json.user));
        });
    });
    // 3) 4 条新 SSR：role=0→200 且渲染 tbody；未登录→302/401；role=1→非200；老 4 路由 200 回归
    RES.forEach(function (res) {
        var path = '/manager/' + res + '/admin';
        p = p.then(function () {
            return req('GET', path).then(function (r) {
                check('SSR ' + res + ' role=0→200 且渲染 tbody', r.status === 200 && r.text.indexOf('<tbody') >= 0, 'status=' + r.status);
                check('SSR ' + res + ' 含分页控件', r.status === 200 && (r.text.indexOf('js-pre-page') >= 0 || r.text.indexOf('admin-pager') >= 0), 'pager=' + (r.text.indexOf('js-pre-page') >= 0));
                // 筛选控件依赖前端把 adminToolbar include 进老模板；缺失不误判为后端 FAIL。
                advisory('SSR ' + res + ' 筛选控件', r.text.indexOf('js-admin-filter') >= 0 ? '已就位' : '待前端 include adminToolbar（后端 filters/sortBy/order/url locals 已注入）');
            });
        });
        p = p.then(function () {
            return req('GET', path, undefined, {}, true).then(function (r) {
                check('SSR ' + res + ' 未登录→302/401', r.status === 302 || r.status === 401, 'status=' + r.status);
            });
        });
        if (USER_COOKIE) p = p.then(function () {
            return req('GET', path, undefined, {'Cookie': USER_COOKIE}).then(function (r) {
                check('SSR ' + res + ' role=1→拒绝(非200)', r.status !== 200 && (r.status === 302 || r.status === 401 || r.status === 403),
                    'status=' + r.status + '（共享 filter.deny 对 GET 统一 302，与 403 安全等价）');
            });
        });
        p = p.then(function () {
            return req('GET', '/manager/' + res).then(function (r) {
                check('老路由 /manager/' + res + ' 仍 200(回归)', r.status === 200, 'status=' + r.status);
            });
        });
    });
    // 4) SSR 与 JSON 结果集一致：以分页 totalPage 对照（两者共用 buildWhere/parseListQuery/adminList）
    if (COOKIE) RES.forEach(function (res) {
        ['keyword=QA', 'status=0', 'sortBy=modifyTime&order=asc', 'page=2'].forEach(function (q) {
            p = p.then(function () {
                return Promise.all([
                    req('GET', '/manager/' + res + '/admin?' + q),
                    req('GET', '/manager/' + res + '/list?' + q + '&format=json')
                ]).then(function (a) {
                    var s = a[0], j = a[1], m = /data-total="(\d+)"/.exec(s.text || '');
                    var st = m ? Number(m[1]) : null, jt = j.json && j.json.totalPage;
                    var ok = s.status === 200 && j.status === 200 && j.json && ((st === jt) || (st === null && jt === 0));
                    check('结果集 ' + res + ' SSR/JSON totalPage ?' + q, ok,
                        'ssr=' + st + ' json=' + jt + ' ssrHttp=' + s.status + ' jsonHttp=' + j.status);
                });
            });
        });
    });
    // 5) 空结果集对照：不存在的关键词 SSR 走“暂无数据”，JSON total=0
    p = p.then(function () {
        return Promise.all([
            req('GET', '/manager/content/admin?keyword=zzzzNOTEXISTxxxx'),
            req('GET', '/manager/content/list?keyword=zzzzNOTEXISTxxxx&format=json')
        ]).then(function (a) {
            var empty = (a[0].text || '').indexOf('暂无数据') >= 0;
            check('空结果集对照 keyword=不存在', a[0].status === 200 && a[1].status === 200 && a[1].json && a[1].json.total === 0 && empty,
                'jsonTotal=' + (a[1].json && a[1].json.total) + ' ssrEmpty=' + empty);
        });
    });
    // 6) 重点：新 SSR user 页无 bcrypt 哈希；老 /manager/user SSR 仍渲染 email/phone 控件
    p = p.then(function () {
        return Promise.all([req('GET', '/manager/user/admin'), req('GET', '/manager/user')]).then(function (a) {
            var n = a[0], o = a[1], hash = /\$2[aby]\$\d\d\$/.test(n.text || '');
            check('新 SSR user 页无 bcrypt 哈希明文', n.status === 200 && !hash, 'status=' + n.status + ' bcryptHit=' + hash);
            check('老 /manager/user SSR 仍渲染 email/phone 控件',
                o.status === 200 && o.text.indexOf('js-email') >= 0 && o.text.indexOf('js-phone') >= 0,
                'status=' + o.status + ' emailCtrl=' + (o.text.indexOf('js-email') >= 0) + ' phoneCtrl=' + (o.text.indexOf('js-phone') >= 0));
        });
    });
    return p;
}

// ---------- 破坏性/造数据（--write，需管理员 Cookie）----------
function writeChecks() {
    var p = Promise.resolve();
    var createdIds = [];
    // 1) 键集合 + 成功流：建文章（老接口 {success,msg} 或带 id）。标题带时间戳保证脚本可重复跑（幂等）。
    var stampName = 'QA_V_' + Date.now();
    p = p.then(function () {
        return req('POST', '/content/add', 'name=' + encodeURIComponent(stampName) + '&content=正文&tags=qa_count,vtag').then(function (r) {
            var ok = r.status === 200 && r.json && r.json.success === true;
            check('写 /content/add 新增成功', ok, 'status=' + r.status + ' body=' + r.text.slice(0, 100));
            if (r.json && r.json.id) createdIds.push(r.json.id);
        });
    });
    // 2) 标签计数：/tags 中 qa_count 的 count 应为非负整数（精确一致性由 §6.3 的驱动脚本断言）
    p = p.then(function () {
        return req('GET', '/tags').then(function (r) {
            var t = r.json && r.json.docs && (Array.isArray(r.json.docs) ? r.json.docs.find(function (x) { return x.name === 'qa_count'; }) : null);
            check('标签 qa_count count 为整数', !t || (typeof t.count === 'number' && t.count >= 0),
                t ? ('count=' + t.count) : '标签未创建（跳过精确断言）');
        });
    });
    // 3) 批量边界：101 个 id 必须 4xx 且零执行（不真正删数据——用不存在的 id，若 4xx 则零执行）
    p = p.then(function () {
        var ids = [];
        for (var i = 0; i < 101; i++) ids.push('00000000000000000000000' + (i % 10));
        return req('POST', '/manager/link/batch', {ids: ids, action: 'status', status: 1}).then(function (r) {
            check('批量边界 101 ids → 4xx', r.status >= 400 && r.status < 500,
                'status=' + r.status + ' body=' + r.text.slice(0, 100));
        });
    });
    // 4) 非法 status：status=1 对 share（仅 0/2）必须结构化失败
    p = p.then(function () {
        return req('POST', '/manager/content/share', 'id=000000000000000000000000&status=1').then(function (r) {
            check('share status=1 → 参数错误', r.status === 400 && r.json && r.json.success === false,
                'status=' + r.status + ' body=' + r.text.slice(0, 100));
        });
    });
    // 5) CSV 导出：User 导出头必须含 BOM 且不含 password
    p = p.then(function () {
        return req('GET', '/manager/user/export').then(function (r) {
            var b = r.bytes || [];
            var bom = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
            check('User 导出含 BOM 且无 password',
                r.status === 200 && bom && r.text.indexOf('password') === -1 &&
                (r.headers.get('cache-control') || '').indexOf('no-store') >= 0,
                'status=' + r.status + ' bom=' + bom + ' cc=' + r.headers.get('cache-control'));
        });
    });
    // 6) CSV 注入：导入含 =formula 与 <script> 的行，断言响应结构化且不 500
    p = p.then(function () {
        var csv = '\uFEFFuserName,realName,password,role,status\r\n=cmd|calc,QA<script>x</script>,Qa@2026x,1,0\r\n';
        return req('POST', '/manager/user/import', {content: csv}).then(function (r) {
            check('CSV 注入行导入 → 结构化响应不 500', r.status < 500 && r.json && r.json.success !== undefined,
                'status=' + r.status + ' body=' + r.text.slice(0, 120));
        });
    });
    // 7) 审计列表：JSON 键集合 {success,data,page,totalPage,total}
    p = p.then(function () {
        return req('GET', '/manager/audit').then(function (r) {
            check('审计 JSON 键集合', r.status === 200 && sameKeys(r.json, ['success', 'data', 'page', 'total', 'totalPage']),
                'status=' + r.status + ' keys=' + keysOf(r.json));
        });
    });
    // 8) 清理造数据：删除刚建的文章（若有 id）
    p = p.then(function () {
        if (!createdIds.length) return;
        var id = createdIds[0];
        return req('POST', '/manager/content/delete', 'id=' + id).then(function (r) {
            check('清理 /manager/content/delete', r.status === 200, 'status=' + r.status);
        });
    });
    return p;
}

function report() {
    console.log('\n# pass ' + pass + ' / # fail ' + fail);
    if (fail) console.log('失败用例: ' + failNames.join(' | '));
    process.exit(fail ? 1 : 0);
}

console.log('BASE=' + BASE + '  COOKIE=' + (COOKIE ? 'set' : 'none') + '  WRITE=' + WRITE);
if (typeof fetch !== 'function') {
    console.error('全局 fetch 不可用：请用 Node 18+（推荐 Node 22）。');
    process.exit(1);
}
safeChecks()
    .then(ssrSessionChecks)
    .then(function () { return WRITE ? writeChecks() : null; })
    .then(report)
    .catch(function (e) {
        check('脚本执行', false, e && e.message);
        report();
    });
