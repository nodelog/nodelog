/* Wiki 后台工作台交互：tab 切换 / 库与页面管理 / Vditor 编辑 / 导入。零第三方依赖（除 Vditor）。 */
(function () {
  'use strict';
  var D = window.__WIKI_ADMIN__ || {spaces: [], pagesBySpace: {}, initialSpace: ''};
  var spaces = D.spaces || [];
  var pagesBySpace = D.pagesBySpace || {};
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  // 统一提示：与全站共用 NL.toast（ui.js），不再用内联 .wa-msg 第二套体系
  function msg(id, text, kind) {
    var k = kind === 'ok' ? 'success' : (kind === 'error' ? 'error' : 'info');
    if (text && window.NL && NL.toast) NL.toast(text, 2400, k);
    // 清空旧的内联提示残留（历史页面可能还留有该节点）
    var el = $(id); if (el) { el.textContent = ''; el.className = 'wa-msg'; }
  }
  function post(url, data, cb) {
    fetch(url, {method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})
      .then(function (r) { return r.json(); })
      .then(cb)
      .catch(function (e) { cb({success: false, msg: '请求失败：' + e.message}); });
  }

  /* ---------- tabs ---------- */
  document.addEventListener('click', function (e) {
    var tab = e.target.closest ? e.target.closest('.wa-tab') : null;
    if (!tab) return;
    var name = tab.getAttribute('data-tab');
    document.querySelectorAll('.wa-tab').forEach(function (t) {
      var on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.wa-panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === name);
    });
    if (name === 'edit' && vd) setTimeout(function () { vd.resize(); }, 30);
  });

  /* ---------- 下拉填充 ---------- */
  function fillSpaceSelect(sel, selected) {
    if (!sel) return;
    sel.innerHTML = spaces.length
      ? spaces.map(function (s) {
          return '<option value="' + esc(s._id) + '"' + (String(selected) === String(s._id) ? ' selected' : '') + '>' + esc(s.name) + '</option>';
        }).join('')
      : '<option value="">（暂无知识库，请先在知识库管理新建）</option>';
  }
  fillSpaceSelect($('wa-space-select'), D.initialSpace);
  fillSpaceSelect($('wa-import-space'), D.initialSpace);

  /* ---------- Vditor ---------- */
  var vd = null;
  if (window.Vditor) {
    vd = new Vditor('wa-vditor', {
      // 桌面分屏(sv)；移动端屏窄用即时渲染(ir)，与博客编辑器口径一致
      cdn: '/vendor/vditor', mode: (window.innerWidth <= 768 ? 'ir' : 'sv'), lang: 'zh_CN',
      height: 560, cache: {enable: false},
      outline: {enable: true, position: 'right'},
      upload: {accept: 'image/*', handler: function (files) {
        // 复用现有图床接口；返回格式遵循 Vditor 上传回调
        var f = files[0];
        var reader = new FileReader();
        reader.onload = function () {
          post('/api/upload', {data: reader.result}, function (r) {
            if (r.success) vd.insertText('![' + esc(f.name) + '](' + r.url + ')\n');
            else msg('wa-edit-msg', '图片上传失败：' + r.msg, 'error');
          });
        };
        reader.readAsDataURL(f);
      }}
    });
  }

  /* ---------- 页面列表 ---------- */
  function currentSpaceId() { return $('wa-space-select') ? $('wa-space-select').value : ''; }
  function renderPages() {
    var ul = $('wa-page-list'); if (!ul) return;
    var id = currentSpaceId();
    var pages = pagesBySpace[id] || [];
    if (!pages.length) {
      ul.innerHTML = '<li class="wa-empty">该库暂无页面，点「新建页面」开始。</li>';
      return;
    }
    ul.innerHTML = pages.map(function (p) {
      return '<li><div class="wa-page-item' + (String($('wa-doc-id').value) === String(p._id) ? ' is-active' : '') + '" data-id="' + esc(p._id) + '">' +
        '<span class="wa-page-item__name">' + esc(p.name) + '</span>' +
        '<button type="button" class="wa-page-item__del" data-del="' + esc(p._id) + '" title="删除" aria-label="删除">×</button>' +
        '</div></li>';
    }).join('');
  }
  function loadPage(page) {
    $('wa-doc-id').value = page ? page._id : '';
    $('wa-doc-name').value = page ? page.name : '';
    $('wa-doc-tags').value = page && page.tags ? page.tags.join(', ') : '';
    $('wa-doc-slug').value = page ? (page.slug || '') : '';
    $('wa-doc-space').value = currentSpaceId();
    var src = page && page.content ? page.content : '';
    if (vd) vd.setValue(src); else $('wa-editor-source').value = src;
    $('wa-doc-delete').style.display = page ? 'inline-flex' : 'none';
    msg('wa-edit-msg', '');
    renderPages();
  }
  // 统一确认弹窗：全站走 NL.alert（ui.js），不再用浏览器原生 confirm
  function confirmAction(message, onConfirm, title) {
    if (window.NL && NL.alert) {
      NL.alert(message, {
        title: title || '请确认',
        confirmText: '删除', cancelText: '取消',
        onConfirm: onConfirm
      });
    } else {
      // 极端降级：ui.js 未加载时仍保留原生 confirm，功能不丢
      if (window.confirm(message)) onConfirm();
    }
  }
  // 执行删除页面的公共逻辑（列表小按钮与右下角按钮共用）
  function doDeleteDoc(id, anchor) {
    post('/manager/wiki/doc/delete', {id: id}, function (r) {
      if (!r.success) return msg('wa-edit-msg', r.msg, 'error');
      msg('wa-edit-msg', r.msg, 'ok');
      (pagesBySpace[currentSpaceId()] || []).forEach(function (p, i, arr) {
        if (String(p._id) === id) arr.splice(i, 1);
      });
      loadPage(null);
    });
  }
  $('wa-space-select').addEventListener('change', function () { loadPage(null); });
  $('wa-new-doc').addEventListener('click', function () { loadPage(null); });
  // 右下角删除按钮：删除当前编辑的文档（此前未绑定事件，点击无反应）
  $('wa-doc-delete').addEventListener('click', function () {
    var id = $('wa-doc-id').value;
    if (!id) return msg('wa-edit-msg', '请先选择一个页面', 'error');
    var name = $('wa-doc-name').value || '该页面';
    confirmAction('确认删除「' + name + '」？此操作不可撤销。', function () { doDeleteDoc(id); }, '删除页面');
  });
  $('wa-page-list').addEventListener('click', function (e) {
    var del = e.target.closest ? e.target.closest('[data-del]') : null;
    if (del) {
      e.stopPropagation();
      var id = del.getAttribute('data-del');
      confirmAction('确认删除该页面？此操作不可撤销。', function () { doDeleteDoc(id); }, '删除页面');
      return;
    }
    var item = e.target.closest ? e.target.closest('.wa-page-item') : null;
    if (!item) return;
    var pid = item.getAttribute('data-id');
    var all = pagesBySpace[currentSpaceId()] || [];
    var found = null;
    for (var i = 0; i < all.length; i++) { if (String(all[i]._id) === pid) { found = all[i]; break; } }
    if (found) loadPage(found);
  });

  $('wa-doc-save').addEventListener('click', function () {
    var spaceId = currentSpaceId();
    if (!spaceId) return msg('wa-edit-msg', '请先选择知识库', 'error');
    var content = vd ? vd.getValue() : $('wa-editor-source').value;
    var payload = {
      id: $('wa-doc-id').value, spaceId: spaceId, name: $('wa-doc-name').value,
      content: content, tags: $('wa-doc-tags').value, slug: $('wa-doc-slug').value
    };
    if (!payload.name.trim() || !payload.content.trim()) return msg('wa-edit-msg', '标题和正文不能为空', 'error');
    $('wa-doc-save').disabled = true;
    post('/manager/wiki/doc/save', payload, function (r) {
      $('wa-doc-save').disabled = false;
      if (!r.success) return msg('wa-edit-msg', r.msg, 'error');
      msg('wa-edit-msg', r.msg, 'ok');
      // 更新本地缓存并刷新列表
      var arr = pagesBySpace[spaceId] = pagesBySpace[spaceId] || [];
      var existing = null;
      arr.forEach(function (p) { if (String(p._id) === String(r.id)) existing = p; });
      if (existing) { existing.name = payload.name; existing.content = payload.content; existing.tags = String(payload.tags).split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean); existing.slug = r.slug || existing.slug; }
      else arr.push({_id: r.id, name: payload.name, content: payload.content, slug: r.slug, tags: String(payload.tags).split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean)});
      loadPage(existing || arr[arr.length - 1]);
    });
  });
  renderPages();

  /* ---------- 导入 ---------- */
  $('wa-import-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) return msg('wa-import-msg', '文件超过 2MB', 'error');
    var reader = new FileReader();
    reader.onload = function () { $('wa-import-content').value = String(reader.result || ''); };
    reader.readAsText(f, 'utf-8');
  });
  $('wa-import-submit').addEventListener('click', function () {
    var spaceId = $('wa-import-space').value;
    if (!spaceId) return msg('wa-import-msg', '请先选择知识库', 'error');
    var markdown = $('wa-import-content').value.trim();
    if (!markdown) return msg('wa-import-msg', '正文不能为空', 'error');
    $('wa-import-submit').disabled = true;
    post('/manager/wiki/import', {
      markdown: markdown, name: $('wa-import-name').value.trim(),
      tags: $('wa-import-tags').value.trim(), spaceSlug: null,
      spaceId: spaceId
    }, function (r) {
      $('wa-import-submit').disabled = false;
      if (!r.success) return msg('wa-import-msg', r.msg, 'error');
      msg('wa-import-msg', '导入成功：' + r.name, 'ok');
      $('wa-import-content').value = ''; $('wa-import-name').value = '';
    });
  });

  /* ---------- 知识库管理 ---------- */
  function renderSpaceList() {
    var ul = $('wa-space-list'); if (!ul) return;
    ul.innerHTML = spaces.length ? spaces.map(function (s) {
      return '<li><div class="wa-page-item" data-space="' + esc(s._id) + '">' +
        '<span class="wa-page-item__name">' + esc(s.name) + ' <small class="wa-muted">/wiki/' + esc(s.slug) + '</small></span>' +
        '</div></li>';
    }).join('') : '<li class="wa-empty">暂无知识库，点「新建知识库」创建。</li>';
  }
  function resetSpaceForm() {
    $('wa-space-id').value = ''; $('wa-space-name').value = ''; $('wa-space-slug').value = '';
    $('wa-space-desc').value = ''; $('wa-space-visibility').value = 'public'; $('wa-space-order').value = '0';
    $('wa-space-form-title').textContent = '新建知识库';
    $('wa-space-cancel').style.display = 'none'; $('wa-space-delete').style.display = 'none';
    msg('wa-space-msg', '');
  }
  $('wa-new-space').addEventListener('click', resetSpaceForm);
  $('wa-space-cancel').addEventListener('click', resetSpaceForm);
  $('wa-space-list').addEventListener('click', function (e) {
    var item = e.target.closest ? e.target.closest('[data-space]') : null; if (!item) return;
    var id = item.getAttribute('data-space'), found = null;
    spaces.forEach(function (s) { if (String(s._id) === id) found = s; });
    if (!found) return;
    $('wa-space-id').value = found._id; $('wa-space-name').value = found.name;
    $('wa-space-slug').value = found.slug; $('wa-space-desc').value = found.description || '';
    $('wa-space-visibility').value = found.visibility; $('wa-space-order').value = found.order || 0;
    $('wa-space-form-title').textContent = '编辑知识库：' + found.name;
    $('wa-space-cancel').style.display = 'inline-flex'; $('wa-space-delete').style.display = 'inline-flex';
    msg('wa-space-msg', '');
  });
  $('wa-space-save').addEventListener('click', function () {
    var id = $('wa-space-id').value;
    var payload = {
      id: id, name: $('wa-space-name').value.trim(), slug: $('wa-space-slug').value.trim(),
      description: $('wa-space-desc').value.trim(), visibility: $('wa-space-visibility').value,
      order: $('wa-space-order').value
    };
    if (!payload.name) return msg('wa-space-msg', '名称不能为空', 'error');
    post(id ? '/manager/wiki/space/update' : '/manager/wiki/space/add', payload, function (r) {
      if (!r.success) return msg('wa-space-msg', r.msg, 'error');
      msg('wa-space-msg', r.msg, 'ok');
      setTimeout(function () { location.reload(); }, 500);
    });
  });
  $('wa-space-delete').addEventListener('click', function () {
    var id = $('wa-space-id').value; if (!id) return;
    var name = $('wa-space-name').value || '该知识库';
    confirmAction('确认删除知识库「' + name + '」？库内有页面时会被拒绝。', function () {
      post('/manager/wiki/space/delete', {id: id}, function (r) {
        if (!r.success) return msg('wa-space-msg', r.msg, 'error');
        msg('wa-space-msg', r.msg, 'ok');
        setTimeout(function () { location.reload(); }, 500);
      });
    }, '删除知识库');
  });
  renderSpaceList();

  // 初始载入首个页面（若首库有页面）
  var initPages = pagesBySpace[D.initialSpace] || [];
  if (initPages.length) loadPage(initPages[0]);
})();
