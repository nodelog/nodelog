/*
 * 分类重构核心服务（CLI 脚本与后台接口共用，单一事实来源）。
 *
 * 设计：
 *   - run(apply, cb)：单一代码路径。apply=false 仅产出计划(只读)；apply=true 执行写入。
 *   - 标准分类只设一/二级两层；细分技术词降级为子分类的触发词 keywords（方案 B 自动匹配）。
 *   - 旧分类命中映射则把文章改挂目标并软删（status=1，可恢复）；未命中映射的归入「其他」。
 *
 * 注意：本模块【不关闭】数据库连接（后台进程需要长连接）；仅 CLI 包装器负责收尾。
 */
'use strict';
var mongodb = require('../models/mongodb');
var mongoose = mongodb.mongoose;
require('../models/Category');
require('../models/Content');
var CategoryModel = mongoose.model('Category');
var ContentModel = mongoose.model('Content');

/* ---------------- 标准分类（与 scripts/refactor-categories.js 同源） ---------------- */
var STANDARD = [
  { name: '后端开发', slug: 'backend', parent: null, keywords: '', description: '服务端语言、框架与后端工程实践' },
  { name: '前端开发', slug: 'frontend', parent: null, keywords: '', description: 'Web 前端、JS 生态与界面工程' },
  { name: '数据库', slug: 'database', parent: null, keywords: '', description: '关系型、文档型与缓存数据库' },
  { name: '运维与架构', slug: 'ops', parent: null, keywords: '', description: '服务器、部署、DevOps 与基础设施' },
  { name: '人工智能', slug: 'ai', parent: null, keywords: '', description: '大模型、AI 编程与 AR/VR' },
  { name: '产品与设计', slug: 'product-design', parent: null, keywords: '', description: 'UI、视觉与产品方法论' },
  { name: '移动开发', slug: 'mobile', parent: null, keywords: '', description: '小程序、iOS、Android 与移动设备' },
  { name: '生活随笔', slug: 'life', parent: null, keywords: '', description: '咖啡、饮食、阅读与心智' },
  { name: '商业与合规', slug: 'business', parent: null, keywords: '', description: '商业分析、商标、等保与支付' },
  { name: '其他', slug: 'other', parent: null, keywords: '', description: '未归类杂项' },
  { name: 'Java', slug: 'java', parent: '后端开发', keywords: 'java,groovy,jvm,mybatis,设计模式,并发', description: '' },
  { name: 'PHP', slug: 'php', parent: '后端开发', keywords: 'php,yii,yii1,yii2', description: '' },
  { name: 'Node.js', slug: 'nodejs', parent: '后端开发', keywords: 'node.js,node,npm,express', description: '' },
  { name: '后端工程', slug: 'backend-eng', parent: '后端开发', keywords: 'mvc,模板引擎,集成开发环境,ide,gradle', description: '' },
  { name: 'JavaScript', slug: 'javascript', parent: '前端开发', keywords: 'js,javascript,jquery,require.js,requirejs,html5,css样式,css,bootstrap,正则表达式,正则,regexp', description: '' },
  { name: 'Vue', slug: 'vue', parent: '前端开发', keywords: 'vue,vuejs', description: '' },
  { name: '前端工程', slug: 'frontend-eng', parent: '前端开发', keywords: '网站,http', description: '' },
  { name: 'MySQL', slug: 'mysql', parent: '数据库', keywords: 'mysql,sql', description: '' },
  { name: 'MongoDB', slug: 'mongodb', parent: '数据库', keywords: 'mongodb,mongoose', description: '' },
  { name: 'Redis', slug: 'redis', parent: '数据库', keywords: 'redis,缓存', description: '' },
  { name: 'NoSQL', slug: 'nosql', parent: '数据库', keywords: 'nosql', description: '' },
  { name: 'Linux', slug: 'linux', parent: '运维与架构', keywords: 'linux,ssh,windows', description: '' },
  { name: 'Web服务器', slug: 'web-server', parent: '运维与架构', keywords: 'nginx,apache,tomcat,http', description: '' },
  { name: '云服务', slug: 'cloud', parent: '运维与架构', keywords: '云服务器,云工作,cdn,负载均衡', description: '' },
  { name: '版本控制', slug: 'vcs', parent: '运维与架构', keywords: 'git,svn,代码仓库', description: '' },
  { name: 'DevOps', slug: 'devops', parent: '运维与架构', keywords: 'devops,ci,cd,itil,cmdb', description: '' },
  { name: '效率工具', slug: 'tools', parent: '运维与架构', keywords: '工具,cli', description: '' },
  { name: '大模型', slug: 'llm', parent: '人工智能', keywords: '大模型,llm,ai,gpt', description: '' },
  { name: 'Vibe Coding', slug: 'vibe-coding', parent: '人工智能', keywords: 'vibe coding,ai coding', description: '' },
  { name: 'AR/VR', slug: 'ar-vr', parent: '人工智能', keywords: 'ar,vr,虚拟现实', description: '' },
  { name: 'UI', slug: 'ui', parent: '产品与设计', keywords: 'ui,界面,交互,用户体验,ux,原型,视觉', description: '' },
  { name: '设计', slug: 'design', parent: '产品与设计', keywords: '设计', description: '' },
  { name: '产品经理', slug: 'pm', parent: '产品与设计', keywords: '产品经理,pm,okr', description: '' },
  { name: '小程序', slug: 'miniprogram', parent: '移动开发', keywords: '小程序,微信小程序', description: '' },
  { name: 'iOS', slug: 'ios', parent: '移动开发', keywords: 'ios,苹果ios', description: '' },
  { name: 'Android', slug: 'android', parent: '移动开发', keywords: 'android,安卓', description: '' },
  { name: '移动设备', slug: 'mobile-device', parent: '移动开发', keywords: '手机,nfc', description: '' },
  { name: '咖啡', slug: 'coffee', parent: '生活随笔', keywords: '咖啡,coffee', description: '' },
  { name: '酒', slug: 'liquor', parent: '生活随笔', keywords: '酒,whiskey,whisky', description: '' },
  { name: '饮食', slug: 'diet', parent: '生活随笔', keywords: '健康饮食', description: '' },
  { name: '阅读', slug: 'reading', parent: '生活随笔', keywords: '阅读', description: '' },
  { name: '心智', slug: 'mind', parent: '生活随笔', keywords: '正念,心流,记忆', description: '' },
  { name: '商业分析', slug: 'biz-analysis', parent: '商业与合规', keywords: '商业分析', description: '' },
  { name: '商标', slug: 'trademark', parent: '商业与合规', keywords: '注册商标', description: '' },
  { name: '等保合规', slug: 'compliance', parent: '商业与合规', keywords: '三级等保,等保,安全,合规', description: '' },
  { name: '支付', slug: 'payment', parent: '商业与合规', keywords: 'link pay,linkpay,支付', description: '' }
];

/* 旧分类名(小写) → 标准分类名 */
var MAP = {
  'ai': '大模型', 'link pay': '支付', 'nfc': '移动设备', '大模型': '大模型',
  '商业分析': '商业分析', '三级等保': '等保合规', '健康饮食': '饮食', '注册商标': '商标',
  '酒': '酒', 'vue': 'Vue', 'cdn加速': '云服务', 'it基础架构库': 'DevOps',
  '配置管理数据库': 'DevOps', 'devops': 'DevOps', 'ui': 'UI', 'okr': '产品经理',
  '手机': '移动设备', '正念': '心智', '心流': '心智', 'whiskey': '酒', '咖啡': '咖啡',
  '记忆': '心智', '设计': '设计', '阅读': '阅读', 'mybatis': 'Java', 'bug': '其他',
  '云工作': '云服务', 'ar虚拟现实': 'AR/VR', '负载均衡': '云服务', '工具': '效率工具',
  'yii2': 'PHP', '设计模式': 'Java', '并发': 'Java', 'git代码仓库': '版本控制',
  'nginx': 'Web服务器', 'apache': 'Web服务器', 'yii1': 'PHP', 'tomcat汤姆猫': 'Web服务器',
  'mysql': 'MySQL', 'gradle': '后端工程', 'groovy': 'Java', '集成开发环境ide': '后端工程',
  '云服务器': '云服务', 'regexp正则表达式': 'JavaScript', 'redis缓存': 'Redis',
  '产品经理': '产品经理', 'linux': 'Linux', 'windows': 'Linux', '其他': '其他',
  'svn版本管理': '版本控制', 'mvc': '后端工程', '苹果ios': 'iOS', '安卓': 'Android',
  'ssh': 'Linux', 'php': 'PHP', 'java': 'Java', 'http': '前端工程', '网站': '前端工程',
  'require.js': 'JavaScript', '还是git代码仓库': '版本控制', 'nosql': 'NoSQL',
  'html5': 'JavaScript', 'css样式': 'JavaScript', 'js': 'JavaScript', 'bootstrap': 'JavaScript',
  'mongoose': 'MongoDB', 'mongodb': 'MongoDB', '模板引擎': '后端工程', 'jquery': 'JavaScript',
  'node.js': 'Node.js'
};

function lower(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

/**
 * 执行或预览分类重构。
 * @param {boolean} apply true=写入；false=仅产出计划
 * @param {Function} cb (err, plan)
 */
function run(apply, cb) {
  CategoryModel.find({}, function (err, docs) {
    if (err) return cb(err);
    var current = docs || [];
    var stdByName = {};                       // lower(标准名) -> { def, _id }
    var plan = { create: [], update: [], reassign: [], deleteCount: 0, articleTotal: 0, result: null };

    // 1) 确保标准分类存在（创建缺失 / 更新已存在的规范化名称·父级·触发词）
    var queue = STANDARD.slice();
    var qi = 0;
    function stepStandard() {
      if (qi >= queue.length) return afterStandard();
      var def = queue[qi++];
      var lk = lower(def.name);
      if (stdByName[lk]) return stepStandard();
      var parentId = def.parent ? (stdByName[lower(def.parent)] && stdByName[lower(def.parent)]._id) : null;
      if (def.parent && !parentId) { queue.push(def); return stepStandard(); }   // 父级未就绪，推迟（防御）
      var existing = current.filter(function (c) { return lower(c.name) === lk; })[0];
      var setDoc = { name: def.name, slug: def.slug, parent: parentId, keywords: def.keywords, description: def.description, modifyTime: new Date() };
      if (existing) {
        stdByName[lk] = { def: def, _id: String(existing._id) };
        plan.update.push(def.name);
        if (apply) CategoryModel.update({ _id: existing._id }, { $set: setDoc }, function () { stepStandard(); });
        else stepStandard();
      } else if (apply) {
        var newDoc = { name: def.name, slug: def.slug, parent: parentId, keywords: def.keywords, description: def.description, order: 0, status: 0, createTime: new Date(), modifyTime: new Date() };
        CategoryModel.create(newDoc, function (e, saved) {
          if (e) { console.log('创建失败 ' + def.name + ': ' + e.message); return stepStandard(); }
          stdByName[lk] = { def: def, _id: String(saved._id) };
          plan.create.push(def.name);
          stepStandard();
        });
      } else {
        stdByName[lk] = { def: def, _id: 'NEW:' + def.slug };
        plan.create.push(def.name);
        stepStandard();
      }
    }

    function afterStandard() {
      // 2) 旧分类改挂计划（命中的并入目标，未命中的归入「其他」）
      var pending = [];
      current.forEach(function (c) {
        var lk = lower(c.name);
        if (stdByName[lk]) return;             // 本身是标准分类，保留
        var targetName = MAP[lk] || '其他';
        var target = stdByName[lower(targetName)] || stdByName['其他'];
        if (target) pending.push({ from: c.name, fromId: String(c._id), to: target.def.name, toId: target._id });
      });

      if (!pending.length) return finish();
      var done = 0;
      pending.forEach(function (p) {
        ContentModel.count({ category: p.fromId, status: { $ne: 1 } }, function (e, n) {
          p.articles = e ? 0 : n;
          plan.reassign.push(p);
          if (++done === pending.length) finish();
        });
      });

      function finish() {
        plan.articleTotal = plan.reassign.reduce(function (s, p) { return s + (p.articles || 0); }, 0);
        plan.deleteCount = plan.reassign.length;
        if (!apply) return cb(null, plan);
        // 执行：先改挂文章，再软删已清空的旧分类
        var rp = plan.reassign.slice(), moved = 0, delOK = 0, delFail = 0;
        (function reassignStep() {
          if (!rp.length) return deleteStep();
          var p = rp.shift();
          ContentModel.updateMany({ category: p.fromId }, { $set: { category: p.toId, modifyTime: new Date() } }, function (e, r) {
            if (e) console.log('改挂失败 ' + p.from + ': ' + e.message);
            else moved += (r && r.modifiedCount) || 0;
            reassignStep();
          });
        })();
        function deleteStep() {
          var dp = plan.reassign.slice();
          (function dstep() {
            if (!dp.length) { plan.result = { moved: moved, deleted: delOK, failed: delFail }; return cb(null, plan); }
            var p = dp.shift();
            ContentModel.count({ category: p.fromId, status: { $ne: 1 } }, function (e, n) {
              if (!e && n === 0) {
                CategoryModel.update({ _id: p.fromId }, { $set: { status: 1, modifyTime: new Date() } }, function (e2) {
                  if (e2) { delFail++; console.log('软删失败 ' + p.from + ': ' + e2.message); }
                  else delOK++;
                  dstep();
                });
              } else {
                if (e) console.log('计数失败 ' + p.from + ': ' + e.message);
                else console.log('跳过软删 ' + p.from + '（仍有 ' + n + ' 篇未改挂）');
                dstep();
              }
            });
          })();
        }
      }
    }
    stepStandard();
  });
}

module.exports = { STANDARD: STANDARD, MAP: MAP, run: run };
