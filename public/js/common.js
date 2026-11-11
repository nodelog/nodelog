/* =========================================================================
   NODELOG · common.js  —  零依赖原生重写（替代 jQuery + layer 版本）
   行为 100% 对齐旧版：分类菜单 / 评论加载更多 / 搜索建议 / 登录态 /
   增删改（文章·分类·公告·用户）/ 后台开关 / 链接墙 / 回顶。
   依赖：ui.js（window.NL.toast/alert/modal/loading/closeAll）。
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------- 极简 DOM / 请求工具 ---------------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function val(el) { return el ? el.value : ''; }
  function setVal(el, v) { if (el) el.value = (v == null ? '' : v); }
  function attr(el, n) { return el ? el.getAttribute(n) : null; }
  function setAttr(el, n, v) { if (el) el.setAttribute(n, v); }
  function show(el) { if (el) el.classList.remove('hide'); }
  function hide(el) { if (el) el.classList.add('hide'); }
  function fadeOut(el) { if (el) el.classList.add('hide'); }       // 等价旧 .fadeOut()
  function fadeToggle(el) { if (el) el.classList.toggle('hide'); } // 等价旧 .fadeToggle()

  // 事件：无 sel 直绑；有 sel 走事件委托（等价旧 .on/.delegate/.live）
  function on(el, evt, sel, handler) {
    if (!el) return;
    if (sel) {
      el.addEventListener(evt, function (e) {
        var t = e.target.closest(sel);
        if (t && el.contains(t)) handler.call(t, e, t);
      });
    } else {
      el.addEventListener(evt, handler);
    }
  }

  function getJSON(url, data) {
    var q = data ? ('?' + new URLSearchParams(data).toString()) : '';
    return fetch(url + q, { credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  function postForm(url, data) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data || {}).toString()
    }).then(function (r) { return r.json(); });
  }

  /* ---------------- 旧 layer 封装 → NL ---------------- */
  function myMsg(m) { NL.toast(m); }
  function myAlert(m, cb) { NL.alert(m, { onConfirm: cb }); }
  function myPage(title, area, html, cb) { NL.modal({ title: title, content: html, onOpen: cb }); }
  function loading(text) { NL.loading(text); }
  function closeLayer() { NL.closeAll(); }

  /* ---------------- 旧工具函数 ---------------- */
  function limitLength(el, length) {
    if (el && el.value.length >= length) el.value = el.value.substring(0, length);
  }
  function canInput(el, length) {
    return length - (el ? el.value.length : 0);
  }
  Date.prototype.format = function (fmt) {
    if (fmt == null) fmt = 'yyyy-MM-dd hh:mm:ss';
    var o = { 'M+': this.getMonth() + 1, 'd+': this.getDate(), 'h+': this.getHours(), 'H+': this.getHours(), 'm+': this.getMinutes(), 's+': this.getSeconds() };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (this.getFullYear() + '').substr(4 - RegExp.$1.length));
    for (var k in o) {
      if (new RegExp('(' + k + ')').test(fmt)) {
        fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (('00' + o[k]).substr(('' + o[k]).length)));
      }
    }
    return fmt;
  };
  function fmtCommentTime(v) {
    if (v == null || v === '') return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return (typeof d.format === 'function') ? d.format('yyyy-MM-dd hh:mm:ss') : d.toLocaleString();
  }

  var sessionUser = null;
  var url = location.href;
  var beforeUnloadHandler = function () { return '您输入的内容尚未保存，确定离开此页面吗？'; };
  function setHtml(el, h) { if (el) el.innerHTML = h; }

  /* ---------------- 初始化（登录态拉取后执行）---------------- */
  function init() {
    /* 正文链接新窗口打开 */
    on(document, 'click', '.js-content a', function (e) {
      var link = this.getAttribute('href');
      if (link && link.indexOf('javascript:;') === -1) { window.open(link, '_blank'); e.preventDefault(); }
    });

    if (url.indexOf('/manager') === -1) loadCategoryMenu();

    /* 主导航：移动端折叠 + 分类下拉（替代 Bootstrap JS） */
    on(document, 'click', '.navbar-toggle', function () {
      var target = attr(this, 'data-target') || '#example-navbar-collapse';
      var el = qs(target);
      if (el) {
        var open = el.classList.toggle('in');
        this.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });
    on(document, 'click', '.js-category-content', function (e) {
      e.preventDefault();
      var dd = this.closest('.dropdown');
      if (dd) dd.classList.toggle('open');
    });
    on(document, 'click', function (e) {
      if (!e.target.closest('.dropdown')) {
        qsa('.dropdown.open').forEach(function (d) { d.classList.remove('open'); });
      }
    });

    /* 分类菜单自动筛选 */
    on(qs('.js-category-menu'), 'keyup focus click change', '.js-category-auto', function (e) {
      e.stopPropagation();
      var _val = (this.value || '').trim().toLowerCase();
      qsa('.js-category-menu li').forEach(function (li) {
        var a = li.querySelector('a');
        if (!a) return;
        if (_val === '' || a.textContent.toLowerCase().indexOf(_val) !== -1) li.classList.remove('hide');
        else li.classList.add('hide');
      });
    });

    /* 登录（微信扫码由 qr-login.js 在捕获阶段接管，这里仅保留程序化触发） */
    var loginFlag = attr(qs('.js-login-flag'), 'value');
    if (loginFlag === 'true' && qs('.js-login-btn')) qs('.js-login-btn').click();

    /* 退出 */
    on(document, 'click', '.js-logout-btn', function () {
      myAlert('您确定从服务器退出当前登录的用户吗？', function () {
        closeLayer(); loading();
        getJSON('/user/logout', {}).then(function () {
          sessionUser = null;
          qsa('.js-login-toggle a').forEach(function (a) { a.style.display = (a.classList.contains('js-login-btn') ? '' : 'none'); });
          NL.closeAll();
          window.removeEventListener('beforeunload', beforeUnloadHandler);
          if (url.indexOf('/manager') !== -1) location.href = '/';
        });
      });
    });

    /* 删除用户 */
    on(document, 'click', '.js-user-delete', function () {
      var id = attr(this, 'data-id');
      var self = this;
      myAlert('删除后无法恢复，您确定要删除吗？', function () {
        closeLayer(); loading();
        postForm('/manager/user/delete', { id: id }).then(function (data) {
          if (data.success) fadeOut(self.parentNode.parentNode);
          myMsg(data.msg);
        });
      });
    });

    /* 后台开关：用户状态 / 内容共享 / 用户角色（原生 checkbox 替代 bootstrapSwitch） */
    bindSwitch('.js-user-status', '/manager/user/update', function (checked) { return { status: checked ? 0 : 1 }; });
    bindSwitch('.js-content-status', '/manager/content/share', function (checked) { return { status: checked ? 0 : 2 }; });
    bindSwitch('.js-user-role', '/manager/user/update', function (checked) { return { role: checked ? 0 : 1 }; });

    /* 分页上下页 */
    on(document, 'click', '.js-pre-page', function () {
      var page = parseInt(attr(this, 'data-page'), 10);
      if (page <= 1) { myMsg('已经是最新的了'); return; }
      location.href = attr(this, 'data-url') + 'page=' + (page - 1);
    });
    on(document, 'click', '.js-next-page', function () {
      var page = parseInt(attr(this, 'data-page'), 10);
      var total = parseInt(attr(this, 'data-total'), 10);
      if (page >= total) { myMsg('后面没有了'); return; }
      location.href = attr(this, 'data-url') + 'page=' + (page + 1);
    });

    /* 添加 / 修改 / 删除分类 */
    on(document, 'click', '.js-add-category', function () {
      myPage('添加分类', ['310px', '160px'], qs('.js-add-category-panel').innerHTML, function (modal) {
        var input = modal.querySelector('.js-category-name');
        if (input) input.focus();
      });
    });
    on(document, 'click', '.js-save-category', function () {
      var scope = qs('.layermcont') || document;
      var name = scope.querySelector('.js-category-name');
      var nameVal = name ? name.value.trim() : '';
      var id = name ? name.getAttribute('data-id') : null;
      if (nameVal === '') { myMsg('分类名称不能为空'); return; }
      if (!id) {
        postForm('/manager/category/add', { name: nameVal }).then(function (data) {
          if (data.success) { closeLayer(); location.href = '/manager/category?page=1'; }
          myMsg(data.msg);
        });
      } else {
        postForm('/manager/category/modify', { id: id, name: nameVal }).then(function (data) {
          if (data.success) { closeLayer(); var cur = qs('.js-modify-category-current'); if (cur) cur.textContent = nameVal; }
          myMsg(data.msg);
        });
      }
    });
    on(document, 'click', '.js-category-delete', function () {
      var id = attr(this, 'data-id');
      var self = this;
      myAlert('删除后无法恢复，您确定要删除此分类吗？', function () {
        closeLayer(); loading();
        postForm('/manager/category/delete', { id: id }).then(function (data) {
          if (data.success) fadeOut(self.parentNode.parentNode);
          myMsg(data.msg);
        });
      });
    });
    on(document, 'click', '.js-modify-category', function () {
      var cur = qs('.js-modify-category-current');
      if (cur) cur.classList.remove('js-modify-category-current');
      this.classList.add('js-modify-category-current');
      var value = this.textContent;
      var id = attr(this, 'data-id');
      myPage('修改分类', ['310px', '160px'], qs('.js-add-category-panel').innerHTML, function (modal) {
        var input = modal.querySelector('.js-category-name');
        if (input) { input.value = value; input.setAttribute('data-id', id); }
        var focus = modal.querySelector('.layermcont .js-category-name');
        if (focus) focus.focus();
      });
    });

    /* 标题字数限制 + 剩余字数 */
    function bindCounter(sel) {
      on(document, 'keyup change focus blur', sel, function () {
        var max = parseInt(attr(this, 'maxlength'), 10);
        if (this.value.length >= max) limitLength(this, max);
        var out = qs('.js-content-name-chars');
        if (out) out.textContent = canInput(this, max);
      });
    }
    bindCounter('.js-add-content-name');
    bindCounter('.js-add-log-name');

    /* 保存文章 */
    on(document, 'click', '.js-save-content', function () {
      if (sessionUser == null) { if (qs('.js-login-btn')) qs('.js-login-btn').click(); return; }
      var name = val(qs('.js-add-content-name')).trim();
      var oldName = attr(qs('.js-add-content-name'), 'data-name');
      var id = attr(qs('.js-add-content-name'), 'data-id');
      var content = val(qs('.js-editor'));
      var category = val(qs('.js-category-value'));
      var original = val(qs('input[name="original"]')).trim();
      var contentType = val(qs('.js-content-type')) || 'markdown';
      if (name === '') { myMsg('标题不能为空'); return; }
      if (content.trim() === '') { myMsg('内容不能为空'); return; }
      loading();
      postForm('/content/add', {
        id: id, name: name, content: content, contentType: contentType,
        category: category, oldName: oldName, original: original
      }).then(function (data) {
        closeLayer();
        myMsg(data.msg);
        if (data.success) {
          window.removeEventListener('beforeunload', beforeUnloadHandler);
          if (id != null) location.href = '/content/detail?view=contentDetail&id=' + id;
          else location.href = '/';
        }
      });
    });

    /* 删除文章 */
    on(document, 'click', '.js-content-delete', function () {
      var id = attr(this, 'data-id');
      var self = this;
      myAlert('删除后无法恢复，您确定要删除吗？', function () {
        closeLayer(); loading();
        postForm('/manager/content/delete', { id: id }).then(function (data) {
          if (data.success) fadeOut(self.parentNode.parentNode);
          myMsg(data.msg);
        });
      });
    });

    /* 跳转评论输入框 */
    on(document, 'click', '.js-open-comment-btn', function () { var el = qs('.js-comment-input'); if (el) el.focus(); });

    /* 发表评论 */
    on(document, 'click', '.js-post-comment-btn', function () {
      var id = attr(this, 'data-id');
      var name = attr(this, 'data-name');
      var email = attr(this, 'data-email');
      var comment = val(qs('.js-comment-input')).trim();
      if (comment === '') { myMsg('评论内容为空'); return; }
      loading(); closeLayer();
      postForm('/comment/add', { contentId: id, name: name, email: email, comment: comment }).then(function (data) {
        closeLayer(); myMsg(data.msg);
        if (data.success) location.reload();
      });
    });

    /* 评论区：详情页加载 + 加载更多 */
    if (url.indexOf('view=contentDetail') !== -1 || qs('.js-doc-id')) {
      var docId = val(qs('.js-doc-id'));
      if (sessionUser != null && sessionUser._id !== docId) {
        var pc = qs('.js-post-comment-btn'); if (pc) pc.disabled = false;
        var ci = qs('.js-comment-input'); if (ci) ci.setAttribute('placeholder', '请输入评论');
      }
      loadComments(1);
      on(qs('.js-comment-panel'), 'click', '.js-state-retry', function () {
        var retry = attr(this, 'data-retry');
        if (retry === 'comments') {
          setHtml(qs('.js-comment-panel'), NL.state('loading', { size: 'block' }));
          loadComments(1);
        } else if (retry === 'more-comments') {
          if (qs('.js-more-comment-btn')) qs('.js-more-comment-btn').click();
        }
      });
      qsa('.js-content *').forEach(function (el) {
        if (el.offsetWidth > window.screen.width - 60) el.style.width = (window.screen.width - 60) + 'px';
      });
    }

    /* 评论输入框聚焦 → 未登录则登录 */
    on(document, 'focus', '.js-comment-input', function () {
      if (sessionUser == null) { this.blur(); if (qs('.js-login-btn')) qs('.js-login-btn').click(); }
    });

    /* 我发布的 / 我的评论 */
    on(document, 'click', '.js-my-content-menu', function () {
      if (sessionUser == null) { if (qs('.js-login-btn')) qs('.js-login-btn').click(); return; }
      location.href = '/content/user?page=1';
    });
    on(document, 'click', '.js-refresh', function () { location.reload(); });

    /* 搜索：回车跳转 + 实时建议 */
    on(document, 'keydown keyup focus click change', '.js-search', function (e) {
      var max = parseInt(attr(this, 'maxlength'), 10);
      if (this.value.length >= max) limitLength(this, max);
      this.classList.add('search-focus');
      var word = this.value.trim();
      if (e.keyCode === 13) {
        if (word === '') { myMsg('请输入关键字'); return false; }
        loading('开始搜索 "' + word + '" 相关日志…');
        location.href = '/content/search?word=' + encodeURIComponent(word) + '&page=1';
      } else {
        if (word === '') { setHtml(qs('.js-search-panel'), ''); hide(qs('.js-search-panel')); qs('.js-search-bar').classList.remove('open'); return; }
        suggest(word, '/content/search');
      }
    });
    on(document, 'click', '.js-search-panel', function (e) {
      var retry = e.target.closest('.js-state-retry');
      if (retry && attr(retry, 'data-retry') === 'search') suggest((qs('.js-search').value || '').trim(), '/content/search');
    });
    on(document, 'keyup focus click change', '.js-search-panel', '.js-search-auto', function (e) {
      e.stopPropagation();
      var _val = (this.value || '').trim().toLowerCase();
      qsa('.js-search-panel li').forEach(function (li) {
        var a = li.querySelector('a'); if (!a) return;
        if (_val === '' || a.textContent.toLowerCase().indexOf(_val) !== -1) li.classList.remove('hide');
        else li.classList.add('hide');
      });
    });
    function searchState() {
      if ((qs('.js-search').value || '').trim() !== '') qs('.js-search').classList.add('search-focus');
      else qs('.js-search').classList.remove('search-focus');
    }
    on(document, 'blur', '.js-search', searchState);
    if (url.indexOf('/manager') === -1) searchState();

    /* QQ 反馈图标 hover 切换 */
    on(document, 'mouseenter', '.js-qq-feedback', function () { var img = this.querySelector('img'); if (img) img.src = '/images/qq-enable.jpg'; });
    on(document, 'mouseleave', '.js-qq-feedback', function () { var img = this.querySelector('img'); if (img) img.src = '/images/qq-disable.png'; });

    /* 写公告 */
    on(document, 'click', '.js-add-log-btn', function () {
      if (sessionUser == null) { if (qs('.js-login-btn')) qs('.js-login-btn').click(); return; }
      var name = val(qs('.js-add-log-name')).trim();
      var content = val(qs('.js-editor'));
      if (name === '') { myMsg('标题不能为空'); return; }
      if (content.trim() === '') { myMsg('内容不能为空'); return; }
      loading();
      postForm('/manager/log/add', { name: name, content: content }).then(function (data) {
        closeLayer(); myMsg(data.msg);
        if (data.success) location.href = '/manager/log?view=manager/log&page=1';
      });
    });
    on(document, 'click', '.js-log-delete', function () {
      var id = attr(this, 'data-id');
      var self = this;
      myAlert('删除后无法恢复，您确定要删除吗？', function () {
        closeLayer(); loading();
        postForm('/manager/log/delete', { id: id }).then(function (data) {
          if (data.success) fadeOut(self.parentNode.parentNode);
          myMsg(data.msg);
        });
      });
    });

    /* 用户编辑面板 */
    function fillUserEditForm(u) {
      setVal(qs('input[name=userName]'), u.userName || '');
      setVal(qs('input[name=realName]'), u.realName || '');
      setVal(qs('input[name=email]'), u.email || '');
      setVal(qs('input[name=phone]'), u.phone || '');
      setVal(qs('input[name=password]'), '');
    }
    var editingUserId = null;
    on(document, 'click', '.js-user-edit', function () {
      editingUserId = attr(this, 'data-id');
      fillUserEditForm({
        userName: attr(this, 'data-user-name') || '',
        realName: attr(this, 'data-real-name') || '',
        email: attr(this, 'data-email') || '',
        phone: attr(this, 'data-phone') || ''
      });
      fadeToggle(qs('.js-user-edit-panel'));
    });
    on(document, 'click', '.js-user-edit-cancel', function () { fadeToggle(qs('.js-user-edit-panel')); });
    on(document, 'click', '.js-user-edit-save', function () {
      var id = editingUserId || (sessionUser && sessionUser._id);
      postForm('/manager/user/update', {
        id: id,
        userName: val(qs('input[name=userName]')).trim(),
        realName: val(qs('input[name=realName]')).trim(),
        password: val(qs('input[name=password]')).trim(),
        email: val(qs('input[name=email]')).trim(),
        phone: val(qs('input[name=phone]')).trim()
      }).then(function (data) {
        if (data.result === true) location.reload();
        else myMsg(data.msg || data.result);
      });
    });

    /* 站点配置 */
    on(document, 'click', '.js-site-edit-save', function () {
      var data = qsa('form[name=siteForm] [name]').map(function (el) {
        return encodeURIComponent(el.name) + '=' + encodeURIComponent(el.value);
      }).join('&');
      loading();
      fetch('/manager/site/update', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data
      }).then(function (r) { return r.json(); }).then(function (data) {
        myMsg(data.msg); if (data.success) location.reload();
      });
    });

    /* 前台公告数 */
    if (url.indexOf('/manager') === -1) {
      getJSON('/log/count', {}).then(function (data) {
        var el = qs('.js-log-count'); if (el) el.textContent = data.count;
      });
    }

    /* 微信/微博 关注浮层（原生轻量 popover 替代 Bootstrap .popover） */
    bindPopover('.js-attention-weixin', popverWeixinTempl());
    bindPopover('.js-attention-weibo', popverWeiboTempl());
    bindPopover('.js-attention-weixinweibo', popverWeixinWeiboTempl());

    /* ESC / 关闭全部 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) NL.closeAll();
    });
    on(document, 'click', '.layer-close-all', function () { NL.closeAll(); });

    /* 友链墙 */
    getJSON('/link/list', {}).then(function (data) {
      if (data.success) {
        var _html = '';
        (data.data || []).forEach(function (val, i) {
          if (i !== 0) _html += '&nbsp;&nbsp;|&nbsp;&nbsp;';
          _html += '<a href="' + val.url + '"' + (val.blank === 0 ? ' target="_blank"' : '') + '>' + val.name + '</a>';
        });
        var panel = qs('.js-links-panel'); if (panel) panel.insertAdjacentHTML('beforeend', _html);
      }
    });
  }

  /* ---------------- 分类菜单 ---------------- */
  function loadCategoryMenu() {
    getJSON('/category/all', {}).then(function (data) {
      var docs = (data && data.docs) || [];
      var html = '<li style="padding: 5px;"><input type="text" class="form-control js-category-auto" placeholder="输入" autofocus x-webkit-speech></li>';
      var _url = '', _addHtml = '', _editHtml = '';
      var _categoryId = val(qs('.js-edit-content-category'));
      docs.forEach(function (tempDoc) {
        var _id = tempDoc._id, _name = tempDoc.name;
        _url = '/content/category?categoryId=' + _id + '&page=1';
        html += '<li><a href="' + _url + '" class="l-option">' + _name + '</a></li>';
        if (url.indexOf('content/addPage') !== -1) {
          _addHtml += '<option class="l-option" value="' + _id + '">' + _name + '</option>';
        } else if (url.indexOf('view=editContent') !== -1) {
          _editHtml += (_id != _categoryId)
            ? '<option class="l-option" value="' + _id + '">' + _name + '</option>'
            : '<option value="' + _id + '" selected>' + _name + '</option>';
        }
      });
      var menu = qs('.js-category-menu');
      if (menu) menu.innerHTML = html;

      if (url.indexOf('content/category') !== -1) {
        qsa('.js-category-menu li').forEach(function (li) {
          var a = li.querySelector('a');
          if (a && (url.indexOf(a.getAttribute('href')) !== -1)) {
            a.parentNode.classList.add('l-option-current');
            a.classList.add('l-option-current');
            return false;
          }
        });
      }
      if (url.indexOf('content/addPage') !== -1) {
        var cv = qs('.js-category-value'); if (cv) cv.innerHTML = _addHtml;
        if (sessionUser == null && qs('.js-login-btn')) qs('.js-login-btn').click();
        window.addEventListener('beforeunload', beforeUnloadHandler);
      }
      if (url.indexOf('view=editContent') !== -1) {
        var cv2 = qs('.js-category-value'); if (cv2) cv2.innerHTML = _editHtml;
        if (sessionUser == null && qs('.js-login-btn')) qs('.js-login-btn').click();
        window.addEventListener('beforeunload', beforeUnloadHandler);
      }
    }).catch(function () {
      var menu = qs('.js-category-menu');
      if (menu) menu.innerHTML = '<li>' + NL.state('error', { title: '分类没加载出来', text: '稍后重试，或回首页浏览文章', retry: 'categories' }) + '</li>';
    });

    on(qs('.js-category-menu'), 'click', '.js-state-retry', function () {
      if (attr(this, 'data-retry') !== 'categories') return;
      var menu = qs('.js-category-menu');
      if (menu) menu.innerHTML = '<li>' + NL.state('loading') + '</li>';
      loadCategoryMenu();
    });
  }

  /* ---------------- 评论加载更多 + 首屏 ---------------- */
  function commentItem(val) {
    return '<div class="comment-item"><div class="comment-item-head">'
      + '<span class="comment-author">' + NL.esc(val.userName) + '</span>'
      + '<time class="color-gray">' + NL.esc(fmtCommentTime(val.createTime)) + '</time>'
      + '</div><div class="comment-item-body">' + NL.esc(val.comment) + '</div></div>';
  }
  function loadComments(reqPage) {
    var docId = val(qs('.js-doc-id'));
    getJSON('/comment/all', { cententId: docId, page: reqPage }).then(function (data) {
      var docs = data.docs;
      var panel = qs('.js-comment-panel');
      if (!panel) return;
      if (docs != null && docs.length > 0) {
        var html = '';
        docs.forEach(function (val) { html += commentItem(val); });
        var title = qs('.js-comment-title');
        if (title) {
          var base = title.textContent.replace(/\s*\(\d+\)\s*$/, '');
          title.textContent = base + ' (' + data.total + ')';
        }
        if (data.totalPage > 1) {
          show(qs('.js-more-comment'));
          var btn = qs('.js-more-comment-btn');
          setAttr(btn, 'data-page', data.page);
          setAttr(btn, 'data-totalPage', data.totalPage);
          setAttr(btn, 'data-id', docId);
        }
        panel.innerHTML = html;
      } else {
        panel.innerHTML = NL.state('empty', { size: 'block', title: '还没有评论', text: '来写第一条' });
      }
    }).catch(function () {
      var panel = qs('.js-comment-panel');
      if (!panel) return;
      var err = NL.state('error', { size: 'block', title: '评论没读出来', text: '稍后重试，文章内容不受影响', retry: 'comments' });
      if (panel.querySelector('.comment-item')) panel.insertAdjacentHTML('beforeend', err);
      else panel.innerHTML = err;
    });
  }
  on(document, 'click', '.js-more-comment-btn', function () {
    var page = parseInt(attr(this, 'data-page'), 10);
    var totalPage = parseInt(attr(this, 'data-totalPage'), 10);
    var contentId = attr(this, 'data-id');
    if (page >= totalPage) { myMsg('没有更多的评论了'); return; }
    getJSON('/comment/all', { cententId: contentId, page: page + 1 }).then(function (data) {
      var docs = data.docs || [];
      var html = '';
      docs.forEach(function (val) { html += commentItem(val); });
      var panel = qs('.js-comment-panel');
      if (data.totalPage > data.page) setAttr(qs('.js-more-comment-btn'), 'data-page', data.page);
      else hide(qs('.js-more-comment'));
      if (panel) panel.insertAdjacentHTML('beforeend', html);
    }).catch(function () {
      var err = NL.state('error', { size: 'inline', title: '更多评论没读出来', text: '点此重试，文章内容不受影响', retry: 'more-comments' });
      var panel = qs('.js-comment-panel'); if (panel) panel.insertAdjacentHTML('beforeend', err);
    });
  });

  /* ---------------- 搜索建议 ---------------- */
  function suggest(word, searchUrl) {
    var panel = qs('.js-search-panel');
    if (!panel) return;
    panel.innerHTML = '<li>' + NL.state('loading') + '</li>';
    show(panel);
    qs('.js-search-bar').classList.add('open');
    postForm(searchUrl, { word: word }).then(function (data) {
      var docs = (data && data.docs) || [];
      var html = '<li style="padding: 5px;"><input type="text" class="form-control js-search-auto" placeholder="精确定位" x-webkit-speech /></li>';
      if (docs.length > 0) {
        docs.forEach(function (tempDoc) {
          var _id = tempDoc._id, _name = tempDoc.name;
          var _url = '/content/detail?id=' + _id + '&view=contentDetail';
          html += '<li><a href="' + _url + '" class="l-option" target="_blank">' + NL.esc(_name) + '</a></li>';
        });
      } else {
        html += '<li>' + NL.state('empty', { title: '没找到「' + word + '」', text: '换个词或按分类浏览', actionHref: '/', actionText: '按分类浏览' }) + '</li>';
      }
      panel.innerHTML = html;
      qs('.js-search-bar').classList.add('open');
    }).catch(function () {
      panel.innerHTML = '<li>' + NL.state('error', { title: '搜索建议没加载出来', text: '按回车仍可直接搜索', retry: 'search' }) + '</li>';
      qs('.js-search-bar').classList.add('open');
    });
  }

  /* ---------------- 后台开关（原生 checkbox）---------------- */
  function bindSwitch(sel, api, build) {
    qsa(sel).forEach(function (el) {
      var initial = attr(el, 'data-type');
      el.checked = (initial === '0');
      el.addEventListener('change', function () {
        var id = attr(el, 'data-id');
        var payload = build(el.checked);
        payload.id = id;
        postForm(api, payload);
      });
    });
  }

  /* ---------------- 原生 popover（替代 Bootstrap .popover）---------------- */
  var popEl = null;
  function showPop(html, ref) {
    hidePop();
    popEl = document.createElement('div');
    popEl.className = 'nl-popover';
    popEl.setAttribute('role', 'tooltip');
    popEl.innerHTML = html;
    popEl.style.cssText = 'position:fixed;z-index:2147483000;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:var(--shadow);padding:var(--space-3);max-width:280px;';
    document.body.appendChild(popEl);
    var r = ref.getBoundingClientRect();
    var top = r.bottom + 8;
    if (top + popEl.offsetHeight > window.innerHeight) top = r.top - popEl.offsetHeight - 8;
    popEl.style.top = top + 'px';
    popEl.style.left = Math.max(8, r.left) + 'px';
  }
  function hidePop() { if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl); popEl = null; }
  function bindPopover(sel, html) {
    qsa(sel).forEach(function (el) {
      el.addEventListener('mouseenter', function () { showPop(html, el); });
      el.addEventListener('mouseleave', function () { hidePop(); });
    });
  }
  function popverWeixinTempl() {
    return '<table class="table"><tbody><tr><td><div class="heading text-center"><i class="icon-weixin">&nbsp;</i>误码者微信</div><img src="/images/weixin.png" width="200" height="200"></td></tr></tbody></table>';
  }
  function popverWeiboTempl() {
    return '<table class="table"><tbody><tr><td><div class="heading text-center"><i class="icon-weibo">&nbsp;</i>误码者微博</div><img src="/images/weibo.png" width="200" height="200"></td></tr></tbody></table>';
  }
  function popverWeixinWeiboTempl() {
    return '<table class="table"><tbody><tr><td><div class="heading text-center"><i class="icon-weixin">&nbsp;</i>误码者微信</div><img src="/images/weixin.png" width="200" height="200" /></td><td><div class="heading text-center"><i class="icon-weibo">&nbsp;</i>误码者微博</div><img src="/images/weibo.png" width="200" height="200" /></td></tr></tbody></table>';
  }

  /* ---------------- 回顶（占位，元素缺失则跳过）---------------- */
  function ScrollToTop() {
    var btn = document.getElementById('backToTop');
    if (!btn) return;
    var a = 50;
    window.addEventListener('scroll', function () {
      if ((window.pageYOffset || document.documentElement.scrollTop) >= a) btn.classList.remove('Offscreen');
      else btn.classList.add('Offscreen');
    });
    btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); return false; });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    getJSON('/session', {}).then(function (data) { sessionUser = data.user; })
      .catch(function () { sessionUser = null; })
      .then(function () { init(); ScrollToTop(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
