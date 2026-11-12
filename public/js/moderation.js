/* NODELOG · 违规记录四级处置（本页专用，零新依赖，不碰 common.js）
   用户字段只经 createElement/textContent/setAttribute/表单 value 落地，不拼进 HTML 字符串。
   以 defer 引入且位于 footer 的 ui.js/common.js 之前：顶层只注册委托，NL 仅在事件回调里读取。 */
(function () {
  'use strict';
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function on(el, evt, sel, handler) {
    if (!el) return;
    el.addEventListener(evt, function (e) {
      var t = (e.target && e.target.closest) ? e.target.closest(sel) : null;
      if (t && el.contains(t)) handler.call(t, e, t);
    });
  }
  function toast(m) { if (window.NL && typeof NL.toast === 'function') NL.toast(m); }
  function post(url, data) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data || {}).toString()
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  var LV = { 0: '解除', 1: '警告', 2: '禁言', 3: '停用', 4: '封禁' };
  var API = '/manager/moderation/user/dispose';

  function openDispose(btn) {
    var NL = window.NL;
    if (!NL || typeof NL.modal !== 'function') { toast('弹层未就绪，请刷新页面重试'); return; }
    var id = btn.getAttribute('data-id') || '';
    var level = btn.getAttribute('data-level') || '';
    if (!id || !LV[level]) { toast('处置参数不完整，请刷新页面重试'); return; }
    var label = LV[level];
    var isMute = (level === '2');

    NL.modal({
      title: label + ' · 违规记录处置',
      content: '', // 内容全在 onOpen 内用 DOM 接口构建，用户值不进 HTML 字符串
      size: 'large',
      onOpen: function (modal) {
        var body = qs('.nl-modal-body', modal);
        if (!body) return;
        var form = document.createElement('form');
        form.className = 'admin-form';
        form.noValidate = true;

        var tip = document.createElement('p');
        tip.textContent = '确认对该违规记录执行「' + label + '」？处置会记入案底与操作日志，同级重复点击不会重复升级。';
        form.appendChild(tip);

        var mute = null;
        if (isMute) {
          var ml = document.createElement('label');
          var mc = document.createElement('span');
          mc.textContent = '禁言天数（1-365，默认 7）';
          mute = document.createElement('input');
          mute.type = 'number'; mute.name = 'muteDays';
          mute.min = '1'; mute.max = '365'; mute.value = '7';
          mute.className = 'form-control';
          ml.appendChild(mc); ml.appendChild(mute); form.appendChild(ml);
        }

        var rl = document.createElement('label');
        var rcap = document.createElement('span');
        rcap.textContent = '处置说明（选填，≤200 字，请勿填写正文或隐私信息）';
        var reason = document.createElement('textarea');
        reason.name = 'reason'; reason.rows = 3; reason.maxLength = 200;
        reason.className = 'form-control';
        rl.appendChild(rcap); rl.appendChild(reason); form.appendChild(rl);

        var err = document.createElement('p');
        err.className = 'admin-form-error';
        err.setAttribute('role', 'alert');
        err.hidden = true;
        form.appendChild(err);

        var actions = document.createElement('div');
        actions.className = 'admin-form-actions';
        var cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = '取消';
        cancel.addEventListener('click', function () { NL.closeAll(); });
        var ok = document.createElement('button');
        ok.type = 'submit'; ok.className = 'btn btn-primary'; ok.textContent = '确认' + label;
        actions.appendChild(cancel); actions.appendChild(ok); form.appendChild(actions);

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          err.hidden = true;
          var payload = { violationId: id, level: level };
          if (isMute) {
            var days = String(mute.value || '').trim();
            if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365) {
              err.textContent = '禁言天数须为 1-365 的整数';
              err.hidden = false;
              mute.focus();
              return;
            }
            payload.muteDays = days;
          }
          var r = String(reason.value || '').trim();
          if (r) payload.reason = r;
          ok.disabled = true;
          post(API, payload).then(function (data) {
            if (!data || data.success === false) {
              ok.disabled = false;
              err.textContent = (data && data.msg) || '处置失败，案底已保留，请重试';
              err.hidden = false;
              return;
            }
            toast(data.msg || (data.already ? '该级别已处置，未重复执行' : '已' + label));
            NL.closeAll();
            location.reload();
          }).catch(function () {
            ok.disabled = false;
            err.textContent = '网络错误，处置未生效，案底已保留，请重试';
            err.hidden = false;
          });
        });
        body.appendChild(form);
      }
    });
  }

  on(document, 'click', '.js-dispose-btn', function (e) {
    e.preventDefault();
    openDispose(this);
  });
})();
