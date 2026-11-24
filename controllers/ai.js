// P2 AI 辅助脚手架（环境变量门控）
// 启用：配置 AI_API_KEY（以及可选的 AI_API_BASE / AI_MODEL）后，/api/ai/summary 可用。
// 默认返回 501，绝不静默调用外部服务，避免泄漏密钥或产生费用。
exports.summary = function (req, res) {
    var key = process.env.AI_API_KEY;
    if (!key) {
        return res.status(501).json({success: false, msg: 'AI 未启用：请配置 AI_API_KEY 环境变量'});
    }
    var text = (req.body.text || '').slice(0, 8000);
    if (!text) {
        return res.json({success: false, msg: '缺少待处理文本'});
    }
    var base = process.env.AI_API_BASE || 'https://api.openai.com/v1';
    var model = process.env.AI_MODEL || 'gpt-4o-mini';

    if (typeof fetch !== 'function') {
        return res.status(501).json({success: false, msg: '运行环境不支持 fetch'});
    }
    fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
        body: JSON.stringify({
            model: model,
            messages: [
                {role: 'system', content: '请用一句话概括下面文章，并给出 3 个中文标签，以 JSON 输出 {summary:string, tags:[string]}。'},
                {role: 'user', content: text}
            ],
            response_format: {type: 'json_object'}
        })
    })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            var content = d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : d;
            res.json({success: true, data: content});
        })
        .catch(function (e) {
            res.status(502).json({success: false, msg: 'AI 调用失败：' + (e && e.message ? e.message : e)});
        });
};
