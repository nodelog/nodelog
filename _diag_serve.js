/* 生产服务器诊断 v3：找出真正在接流量的 node 进程、它跑的是哪个目录的代码、
 * 那个目录的 models/Content.js 有没有我推的修复（tagRegex）。
 * 用法：在服务器上 `node _diag_serve.js`
 * 不需要连数据库，纯文件系统 + ps 检查，秒出结果。
 */
var { execSync } = require('child_process');
var fs = require('fs');
var path = require('path');

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8' }); } catch (e) { return ''; }
}

console.log('===== 1) 所有 node 进程 + 启动目录(cwd) =====');
var ps = run("ps -e -o pid=,cmd= 2>/dev/null | grep -E 'node ' | grep -v grep") ||
         run("ps aux 2>/dev/null | grep -E 'node ' | grep -v grep");
console.log(ps || '(未找到 node 进程)');

// 解析出 node 进程 PID 列表 + PID→命令行映射（兼容两种 ps 格式）
var pids = [];
var cmdByPid = {};
ps.split('\n').forEach(function (line) {
  var parts = line.trim().split(/\s+/);
  var pid = /^\d+$/.test(parts[0]) ? parts[0] : parts[1];
  if (pid && /^\d+$/.test(pid)) {
    if (pids.indexOf(pid) === -1) pids.push(pid);
    cmdByPid[pid] = line;
  }
});

console.log('\n===== 2) 各 node 进程的 cwd 与「是否含我的修复」=====');
var serving = [];
pids.forEach(function (pid) {
  var cwd = '';
  try { cwd = fs.readlinkSync('/proc/' + pid + '/cwd'); } catch (e) { cwd = '(无法读取cwd)'; }
  var contentFile = path.join(cwd, 'models/Content.js');
  var hasFix = false;
  try { hasFix = fs.readFileSync(contentFile, 'utf8').indexOf('tagRegex') !== -1; } catch (e) {}
  var isApp = /app\.js/.test(cmdByPid[pid] || '');
  console.log('PID ' + pid + '  cwd=' + cwd + '  含修复(tagRegex)=' + hasFix + (isApp ? '  [app.js 主进程]' : ''));
  if (isApp) serving.push({ pid: pid, cwd: cwd, hasFix: hasFix });
});

console.log('\n===== 3) 监听网站端口的进程（真正接流量的）=====');
var portInfo = run("ss -ltnp 2>/dev/null | grep -E ':(80|443|3000|8080)'") ||
               run("netstat -ltnp 2>/dev/null | grep -E ':(80|443|3000|8080)'");
console.log(portInfo || '(无 ss/netstat 或无监听)');
// 从端口信息里提取 PID
var portPids = [];
(portInfo.match(/pid=(\d+)/g) || []).forEach(function (s) { portPids.push(s.replace('pid=', '')); });
(portInfo.match(/(\d+)\/node/g) || []).forEach(function (s) { portPids.push(s.replace('/node', '')); });

console.log('\n===== 4) 当前目录（你执行本命令的目录）=====');
console.log('cwd=' + process.cwd() + '  含修复(tagRegex)=' +
  (function () { try { return fs.readFileSync(path.join(process.cwd(), 'models/Content.js'), 'utf8').indexOf('tagRegex') !== -1; } catch (e) { return false; } })());

console.log('\n===== 结论与建议 =====');
if (serving.length === 0) {
  console.log('未检测到 node app.js 主进程。请确认站点进程是怎么起的（pm2 / docker / nohup）。');
} else if (serving.length > 1) {
  console.log('检测到多个 node app.js 进程（可能旧进程没死/多实例）。需要全部杀掉再统一从含修复的目录重启。');
  serving.forEach(function (s) {
    console.log('  → ' + (s.hasFix ? 'OK ' : '旧 ') + 'PID ' + s.pid + ' cwd=' + s.cwd);
  });
}
var good = serving.filter(function (s) { return s.hasFix; });
var stale = serving.filter(function (s) { return !s.hasFix; });
if (stale.length) {
  console.log('\n❌ 发现「不含修复」的服务进程（这就是线上仍 0 篇的根因）：');
  stale.forEach(function (s) { console.log('   PID ' + s.pid + ' cwd=' + s.cwd); });
  console.log('   这些进程的目录里 models/Content.js 还是旧代码（可能没 git pull，或目录根本不是你 pull 的那个）。');
}
if (good.length) {
  console.log('\n✅ 含修复的进程在：');
  good.forEach(function (s) { console.log('   PID ' + s.pid + ' cwd=' + s.cwd); });
  console.log('   如果线上仍 0 篇，说明这些进程是「pull 之前」就启动的旧实例 → 重启它们即可：');
}
// 给出统一重启命令（优先用含修复的目录）
var target = (good[0] || serving[0] || {}).cwd || '<含修复的目录>';
console.log('\n----- 推荐执行的重启命令（按实际情况调整）-----');
console.log('pkill -f "node app.js"');
console.log('cd ' + target + ' && git pull origin master && node app.js &');
console.log('（若用 pm2：在 ' + target + ' 下 `pm2 restart <app名>` 或 `pm2 restart all`）');
console.log('（若在 docker：到宿主机 `docker restart <容器名>` 或 `docker compose restart`）');
