// Wiki 页面树服务：把一次查询得到的扁平页面数组建成树，提供面包屑与防环检测。
// 纯函数，不碰数据库——DB 调用在 controller，避免 N+1（一次 findBySpace 建整棵树）。

// 建树：O(n)。docs 需含 _id/parent/wikiOrder/createTime。
// 孤儿节点（parent 指向不存在的页面）自动提升为根节点，避免整棵子树丢失。
function buildTree(docs) {
    var list = (docs || []).map(function (d) {
        var o = d.toObject ? d.toObject() : Object.assign({}, d);
        o.children = [];
        return o;
    });
    var byId = {};
    list.forEach(function (d) { byId[String(d._id)] = d; });
    var roots = [];
    list.forEach(function (d) {
        var p = d.parent ? byId[String(d.parent)] : null;
        if (p && String(p._id) !== String(d._id)) {
            p.children.push(d);
        } else {
            roots.push(d); // 根页面或孤儿（父不存在/自环）→ 提升为根，保证不丢数据
        }
    });
    sortTree(roots);
    return roots;
}

// 按 wikiOrder 再 createTime 排序，递归
function sortTree(nodes) {
    nodes.sort(function (a, b) {
        var oa = a.wikiOrder || 0, ob = b.wikiOrder || 0;
        if (oa !== ob) return oa - ob;
        var ta = new Date(a.createTime || 0).getTime(), tb = new Date(b.createTime || 0).getTime();
        return ta - tb;
    });
    nodes.forEach(function (n) { if (n.children && n.children.length) sortTree(n.children); });
}

// 面包屑：由目标页面沿 parent 链回溯到根，返回 [{_id,name,slug},...]（根 → 当前）
function breadcrumb(docs, targetId) {
    var byId = {};
    (docs || []).forEach(function (d) { byId[String(d._id)] = d; });
    var chain = [], seen = {}, cur = byId[String(targetId)];
    while (cur) {
        if (seen[String(cur._id)]) break; // 防环：已访问过就停
        seen[String(cur._id)] = 1;
        chain.unshift({_id: cur._id, name: cur.name, slug: cur.slug});
        cur = cur.parent ? byId[String(cur.parent)] : null;
    }
    return chain;
}

// 防环：把 parent 设为 parentId 是否会造成环？写入前调用，避免 A→B→A。
// targetId 为当前页面 id，parentId 为拟设父节点 id。
function wouldCycle(docs, targetId, parentId) {
    if (!parentId) return false;
    if (String(parentId) === String(targetId)) return true;
    var byId = {};
    (docs || []).forEach(function (d) { byId[String(d._id)] = d; });
    var cur = byId[String(parentId)], seen = {};
    while (cur) {
        if (String(cur._id) === String(targetId)) return true;
        if (seen[String(cur._id)]) break;
        seen[String(cur._id)] = 1;
        cur = cur.parent ? byId[String(cur.parent)] : null;
    }
    return false;
}

// 摊平成带缩进层级的可选列表（供 <select> 选父页面用）
function flatten(nodes, depth, out) {
    out = out || [];
    depth = depth || 0;
    (nodes || []).forEach(function (n) {
        out.push({_id: n._id, name: n.name, slug: n.slug, depth: depth});
        if (n.children && n.children.length) flatten(n.children, depth + 1, out);
    });
    return out;
}

exports.buildTree = buildTree;
exports.breadcrumb = breadcrumb;
exports.wouldCycle = wouldCycle;
exports.flatten = flatten;
