// 后台 CSV 导入导出（SPEC §3.6 / D4）。复用 adminCrud 的查询解析与错误归一化，
// 保持单一口径；独立成文件以满足单文件 ≤300 行与单一职责。
var kit = require('./adminKit');
var cfgConst = require('./adminConfig');
var internal = require('./adminCrud')._internal;
var parseOf = internal.parseOf;
var sortOf = internal.sortOf;
var sendErr = internal.sendErr;
var userErrMsg = internal.userErrMsg;
var buildWhere = require('./adminCrud').buildWhere;
var async = require('async');

function importFail(res, status, msg, failed) {
    return res.status(status).json({success: false, created: 0, failed: failed || 0, results: [], msg: msg});
}

// 导入：先全量校验（大小/行数/表头/逐行字段）再写入，超限/校验失败零部分写入。
// cfgItem = {Model, columns, rowToDoc(cells,ctx), insertDoc(doc,cb), target, maxRows?}
exports.import = function (cfgItem) {
    return function (req, res) {
        var raw = req.body && (req.body.csv != null ? req.body.csv : req.body.content);
        if (typeof raw !== 'string' || !raw.trim()) return importFail(res, 400, 'CSV 内容不能为空');
        // 文案由配置值派生，避免环境变量改了阈值但提示仍是写死的「2MB / 1000 行」（第二真源）。
        var maxRows = cfgItem.maxRows || cfgConst.IMPORT_MAX_ROWS;
        var maxMB = Math.round(cfgConst.IMPORT_MAX_BYTES / (1024 * 1024) * 10) / 10;
        if (Buffer.byteLength(raw, 'utf8') > cfgConst.IMPORT_MAX_BYTES) {
            return importFail(res, 413, '文件超过 ' + maxMB + 'MB');
        }
        var rows = kit.csv.decode(raw);
        var dataRows = rows.slice(1);
        if (dataRows.length > maxRows) return importFail(res, 413, '超过 ' + maxRows + ' 行');
        if (!rows.length || JSON.stringify(rows[0]) !== JSON.stringify(cfgItem.columns)) {
            return importFail(res, 400, '表头不匹配');
        }
        // Pass 1：全量逐行字段校验（纯函数、无 DB 写入），任一行失败则零写入。
        var docs = [], badRow = 0;
        for (var i = 0; i < dataRows.length; i++) {
            try {
                var doc = cfgItem.rowToDoc(dataRows[i], {row: i + 2, req: req});
                if (!doc) throw new Error('字段不完整');
                docs.push(doc);
            } catch (e) {
                badRow = i + 2;
                break;
            }
        }
        if (badRow) return importFail(res, 400, '第 ' + badRow + ' 行数据不合法，已取消全部导入', dataRows.length);
        // Pass 2：逐条写入，重复名等单条规则失败记 failed++ 不入库（零部分写入只约束校验阶段）。
        var results = [], created = 0, failed = 0, createdIds = [];
        async.eachSeries(docs, function (doc, cb) {
            cfgItem.insertDoc(doc, function (err, id) {
                if (err) {
                    failed++;
                    results.push({row: doc.__row, ok: false, msg: userErrMsg(err, 'import')});
                } else {
                    created++;
                    if (id) createdIds.push(String(id));
                    results.push({row: doc.__row, ok: true, msg: '成功'});
                }
                cb(null); // 一条失败不影响后续
            });
        }, function () {
            kit.audit(req, {action: 'import', target: cfgItem.target, objectId: createdIds,
                detail: 'created=' + created + ',failed=' + failed, result: created > 0}, function () {
                res.json({success: true, created: created, failed: failed, results: results});
            });
        });
    };
};

// 导出：字段白名单由 columns/docToRow 决定（User 传脱敏版）；必带 BOM + Content-Disposition + no-store。
exports.export = function (cfgItem) {
    return function (req, res) {
        var parsed = parseOf(cfgItem, req.query);
        if (parsed.error) return res.status(400).json({success: false, msg: parsed.error});
        var where = buildWhere(cfgItem.desc, parsed.filters, req);
        cfgItem.Model.adminList(where, {
            page: 1, pageSize: cfgConst.IMPORT_MAX_ROWS, sort: sortOf(parsed)
        }, function (err, result) {
            if (err) return sendErr(res, err, 'export', 'success', false);
            var rows = (result.docs || []).map(function (d) { return cfgItem.docToRow(d); });
            var text = kit.csv.encode(cfgItem.columns, rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="' + cfgItem.target + '-export.csv"');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            kit.audit(req, {action: 'export', target: cfgItem.target,
                objectId: (result.docs || []).map(function (d) { return String(d._id); }),
                detail: 'rows=' + rows.length}, function () {
                res.send(text);
            });
        });
    };
};
