/* =========================================================================
   NODELOG · 导航单一配置源（single source of truth）
   -------------------------------------------------------------------------
   目的：消除散落在 15+ 个 controller / route 里的 currentMenu 字符串与
   两个 header 中各自硬编码的菜单项、链接、权限判断和高亮规则。

   约定：
   1. 每一项 { key, label, href, roles, group, ... }。key 沿用既有
      currentMenu 取值，controller 无需改动；别名用 aliases 兼容历史写法。
   2. roles: undefined / 'all' = 所有登录用户；'admin' = 仅管理员
      （session.user.role === 0）。这里只控制「是否渲染入口」，不替代、
      不修改任何路由鉴权（routes/index.js 的 authorize / authorizeAdmin）。
   3. hrefByRole / labelByRole 用于同一入口按角色指向不同落地页
      （历史行为：管理员走 /manager/<模块>/admin，普通用户走 /manager/<模块>）。
   4. helper 均为纯函数，供 EJS 直接调用；不依赖 express / 请求上下文。
   5. 搜索框、主题切换、账号/退出属于功能控件而非导航项，不纳入本配置。
   ========================================================================= */
'use strict';

var ROLE_ADMIN = 0;

function isAdmin(user) {
    return !!user && Number(user.role) === ROLE_ADMIN;
}

/* ---------------- 前台：主导航 / 创作动作 / 账号域 三区 ----------------
   zone 决定界面归属，不再把三种语义混在同一排平铺链接里：
   primary = 内容目的地；cta = 创作动作按钮；account = 与当前身份相关的操作。 */
var frontGroups = [
    {
        id: 'browse', zone: 'primary', label: '主导航',
        items: [
            {
                key: 'home', label: '首页', title: '首页', href: '/',
                className: 'js-home-menu',
                defaultCurrent: true       // 首页未传 currentMenu 时也应高亮
            },
            {
                key: 'category', label: '分类', title: '按分类浏览',
                type: 'dropdown', className: 'js-category-content'
            },
            {
                key: 'log', label: '公告', title: '系统公告',
                href: '/log?view=log&page=1',
                className: 'js-log badge-father', badge: true
            }
        ]
    },
    {
        id: 'create', zone: 'cta', label: '创作动作',
        items: [
            {
                key: 'content', label: '写文章', title: '写文章',
                href: '/content/addPage', className: 'js-post-log',
                requiresLogin: true
            }
        ]
    },
    {
        id: 'account', zone: 'account', label: '账号域',
        items: [
            {
                key: 'mycontent', label: '我的文章', title: '我发表的文章',
                href: '/content/user?page=1', className: 'js-my-content-menu',
                requiresLogin: true
            },
            { key: 'admin', label: '管理后台', title: '进入管理后台', href: '/manager' },
            { key: 'logout', label: '退出登录', type: 'action', className: 'js-logout-btn' }
        ]
    }
];

/* 按 zone 预索引，EJS 不必重复遍历；仍是同一份配置的派生，不产生第二真源。 */
var frontZones = { primary: [], cta: [], account: [] };
frontGroups.forEach(function (g) {
    (g.items || []).forEach(function (item) { frontZones[g.zone].push(item); });
});

/* 后台账号域：用户名只作身份标识与菜单触发器，退出是菜单内的会话操作。 */
var adminAccount = {
    logout: { label: '退出登录', type: 'action', className: 'js-logout-btn' }
};

/* ---------------- 后台：概览 / 内容 / 社区 / 治理 四组 ---------------- */
var adminGroups = [
    {
        id: 'overview', label: '概览',
        items: [
            { key: 'home', label: '概览', href: '/manager' }
        ]
    },
    {
        id: 'content', label: '内容',
        items: [
            {
                key: 'content', label: '文章',
                hrefByRole: {
                    admin: '/manager/content/admin?page=1',
                    user: '/manager/content?manager=true&page=1'
                }
            },
            { key: 'category', label: '分类', href: '/manager/category/admin?page=1', roles: 'admin' },
            { key: 'tag', label: '标签', href: '/manager/tag?page=1', roles: 'admin' },
            { key: 'log', label: '公告', href: '/manager/log/admin?page=1', roles: 'admin' },
            { key: 'link', label: '链接', href: '/manager/link', roles: 'admin' }
        ]
    },
    {
        id: 'community', label: '社区',
        items: [
            {
                key: 'user', label: '用户',
                labelByRole: { user: '我的资料' },
                hrefByRole: {
                    admin: '/manager/user/admin?page=1',
                    user: '/manager/user?page=1'
                }
            },
            { key: 'comment', label: '评论', href: '/manager/comment?page=1', roles: 'admin' }
        ]
    },
    {
        id: 'governance', label: '治理与系统',
        items: [
            { key: 'audit', label: '操作日志', href: '/manager/audit/page', roles: 'admin' },
            {
                key: 'sensitiveWord', label: '敏感词', href: '/manager/sensitive-word',
                roles: 'admin', aliases: ['sensitive-word']
            },
            { key: 'violation', label: '违规记录', href: '/manager/violation', roles: 'admin' },
            { key: 'setting', label: '设置', href: '/manager/setting', roles: 'admin' }
        ]
    }
];

/* ---------------- 纯函数 helper（EJS 直接调用） ---------------- */

/** 当前项是否命中：兼容别名、兼容首页缺省 currentMenu。 */
function isCurrent(item, currentMenu) {
    var cur = (currentMenu == null) ? '' : String(currentMenu);
    if (!cur) return !!item.defaultCurrent;
    if (cur === item.key) return true;
    return (item.aliases || []).indexOf(cur) !== -1;
}

/** 是否渲染该入口。仅控制可见性，不承担鉴权。 */
function visible(item, user) {
    if (!item.roles || item.roles === 'all') return true;
    if (item.roles === 'admin') return isAdmin(user);
    if (item.roles === 'user') return !isAdmin(user);
    return (item.roles instanceof Array) ? item.roles.some(function (r) {
        return r === 'admin' ? isAdmin(user) : r === 'user' ? !isAdmin(user) : false;
    }) : true;
}

/** 按角色取链接；未分角色时返回 href。 */
function hrefFor(item, user) {
    if (!item.hrefByRole) return item.href || '';
    return item.hrefByRole[isAdmin(user) ? 'admin' : 'user'] || item.href || '';
}

/** 按角色取文案（普通用户的「用户」→「我的资料」，语义与落地页一致）。 */
function labelFor(item, user) {
    if (!item.labelByRole) return item.label;
    return item.labelByRole[isAdmin(user) ? 'admin' : 'user'] || item.label;
}

/** 取 currentMenu 所属分组，供后台侧栏面包屑 / 展开态使用。 */
function groupOf(groups, currentMenu) {
    var hit = null;
    (groups || []).forEach(function (g) {
        if (hit) return;
        (g.items || []).forEach(function (item) {
            if (!hit && isCurrent(item, currentMenu)) hit = g;
        });
    });
    return hit || (groups && groups[0]) || null;
}

module.exports = {
    ROLE_ADMIN: ROLE_ADMIN,
    front: { groups: frontGroups, zones: frontZones },
    admin: {
        groups: adminGroups,
        backToSite: { label: '返回前台', href: '/' },
        account: adminAccount
    },
    isCurrent: isCurrent,
    visible: visible,
    hrefFor: hrefFor,
    labelFor: labelFor,
    groupOf: groupOf
};
