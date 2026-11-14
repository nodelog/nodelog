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
    ensureCategories(initCategoryPickers); // 写/编页 + 管理端编辑页的可搜索分类选择器
    bindCategoryAuto(); // 标题输入后完全自动预选最相关分类（可手动改）

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
      if (dd) {
        var open = dd.classList.toggle('open');
        this.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });
    on(document, 'click', function (e) {
      if (!e.target.closest('.dropdown')) {
        qsa('.dropdown.open').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('[aria-expanded]'); if (t) t.setAttribute('aria-expanded', 'false');
        });
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
      var rawTags = val(qs('.js-tags-value')).trim();
      var tags = rawTags || extractTags(name, content).join(', '); // 标签留空则发布/保存时自动提取
      var contentType = val(qs('.js-content-type')) || 'markdown';
      if (name === '') { myMsg('标题不能为空'); return; }
      if (content.trim() === '') { myMsg('内容不能为空'); return; }
      loading();
      postForm('/content/add', {
        id: id, name: name, content: content, contentType: contentType,
        category: category, oldName: oldName, original: original, tags: tags
      }).then(function (data) {
        closeLayer();
        myMsg(data.msg);
        if (data.success) {
          // 发布/保存成功后清除本地草稿，避免下次「写新文章」又回灌本次内容
          // （新增文章草稿 key 固定为 nl-draft-new，不清会跨文章串稿；编辑文章则清 nl-draft-<id>）
          try { localStorage.removeItem('nl-draft-' + (id || 'new')); } catch (e) {}
          window.removeEventListener('beforeunload', beforeUnloadHandler);
          if (id != null) location.href = '/content/detail?view=contentDetail&id=' + id;
          else location.href = '/';
        }
      });
    });

    /* 自动生成标签（标题 + 正文关键词提取） */
    on(document, 'click', '.js-auto-tags', function () { autoGenerateTags(); });
    bindTagFields(); // 标签预览 chips + 懒人自动填充

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
      loading();                              // F2: 不再紧跟 closeLayer()，让加载层在请求期间真实可见
      postForm('/comment/add', { contentId: id, name: name, email: email, comment: comment }).then(function (data) {
        closeLayer(); myMsg(data.msg);
        if (data.success) {
          // I2: 免整页刷新——乐观插入新评论、更新计数、清空输入框
          // 控制器 /comment/add 仅返回 {success,msg}，无新评论对象，故用输入值本地构造
          var panel = qs('.js-comment-panel');
          if (panel) {
            var emptyState = panel.querySelector('.state');
            if (emptyState) panel.innerHTML = '';
            panel.insertAdjacentHTML('afterbegin', commentItem({ userName: name, comment: comment, createTime: new Date() }));
          }
          var title = qs('.js-comment-title');
          if (title) {
            var mm = title.textContent.match(/\((\d+)\)/);
            var nn = mm ? (parseInt(mm[1], 10) + 1) : 1;
            var base = title.textContent.replace(/\s*\(\d+\)\s*$/, '');
            title.textContent = base + ' (' + nn + ')';
          }
          var ci = qs('.js-comment-input'); if (ci) ci.value = '';
        }
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

    /* 作者前台自助删除自己的文章：正文页 + 我的文章列表通用（后端按 author 归属软删） */
    on(document, 'click', '.js-delete-article', function () {
      if (sessionUser == null) { if (qs('.js-login-btn')) qs('.js-login-btn').click(); return; }
      var btn = this;
      var id = attr(btn, 'data-id');
      if (!id) return;
      NL.alert('确定要删除这篇文章吗？删除后可在后台恢复。', {
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: function () {
          btn.disabled = true;
          var oldText = btn.textContent;
          btn.textContent = '删除中…';
          postForm('/content/delete', { id: id }).then(function (r) {
            if (r && r.success) {
              NL.toast('删除成功');
              var card = btn.closest('.post-card');
              if (card) { // 列表页：就地移除
                card.parentNode && card.parentNode.removeChild(card);
                var kicker = qs('.kicker');
                if (kicker) kicker.textContent = kicker.textContent.replace(/\d+/, function (n) {
                  return String(Math.max(0, parseInt(n, 10) - 1));
                });
                if (!document.querySelector('.post-card')) location.reload();
              } else { // 正文页：删除后回到「我的文章」
                location.href = '/content/user?page=1';
              }
            } else {
              btn.disabled = false;
              btn.textContent = oldText;
              NL.alert(r && r.msg ? r.msg : '删除失败', { confirmText: '知道了' });
            }
          }).catch(function () {
            btn.disabled = false;
            btn.textContent = oldText;
            NL.alert('网络错误，删除失败', { confirmText: '知道了' });
          });
        }
      });
    });


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
        suggestDebounced(word, '/content/search');
      }
    });
    on(document, 'click', '.js-search-panel', function (e) {
      var retry = e.target.closest('.js-state-retry');
      if (retry && attr(retry, 'data-retry') === 'search') suggest((qs('.js-search').value || '').trim(), '/content/search', null);
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
      if (e.key === 'Escape' || e.keyCode === 27) {
        qsa('.dropdown.open').forEach(function (d) {
          d.classList.remove('open');
          var t = d.querySelector('[aria-expanded]'); if (t) t.setAttribute('aria-expanded', 'false');
        });
        NL.closeAll();
      }
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
  // 缓存全量分类，供导航菜单与写/编页「可搜索分类选择器」复用；单次请求，多处共享
  var allCategories = [];
  var categoryPromise = null;
  function fetchCategories() {
    if (categoryPromise) return categoryPromise;
    categoryPromise = getJSON('/category/all', {}).then(function (data) {
      allCategories = (data && data.docs) || [];
      return allCategories;
    });
    return categoryPromise;
  }

  // 懒加载分类（loadCategoryMenu 也会填充；管理端页面不跑 loadCategoryMenu，这里兜底）
  function ensureCategories(cb) {
    fetchCategories().then(function (list) { cb(list); }).catch(function () { cb([]); });
  }

  // 可搜索分类选择器（替代原生 <select>）：输入框即筛选，下拉点选，选中值写入隐藏 .js-category-value
  function initCategoryPickers() {
    qsa('.js-category-picker').forEach(function (root) {
      if (root.__pickInit) return; root.__pickInit = true;
      var input = qs('.js-category-input', root);
      var hidden = qs('.js-category-value', root);
      var menu = qs('.js-category-menu-list', root);
      if (!input || !hidden || !menu) return;
      function render(filter) {
        var f = (filter || '').trim().toLowerCase();
        var cur = hidden.value;
        var html = '';
        allCategories.forEach(function (c, i) {
          if (f !== '' && (c.name || '').toLowerCase().indexOf(f) === -1) return;
          var isSel = (String(c._id) === String(cur));
          html += '<li class="category-picker__item' + (isSel ? ' is-selected' : '') + '"'
            + ' role="option" aria-selected="' + (isSel ? 'true' : 'false') + '"'
            + ' tabindex="-1" id="cat-opt-' + i + '"'
            + ' data-id="' + c._id + '" data-name="' + c.name + '">' + c.name + '</li>';
        });
        if (!html) html = '<li class="category-picker__empty">无匹配分类</li>';
        menu.innerHTML = html;
      }
      function setActive(items, idx) {
        items.forEach(function (it, i) { it.classList.toggle('is-active', i === idx); });
        menu.setAttribute('aria-activedescendant', items[idx] ? items[idx].id : '');
      }
      function open() { render(input.value); menu.classList.add('is-open'); var its = qsa('.category-picker__item', menu); if (its.length) setActive(its, 0); }
      function close() { menu.classList.remove('is-open'); }
      function choose(li) {
        if (!li || !li.getAttribute('data-id')) return;
        hidden.value = li.getAttribute('data-id');
        input.value = li.getAttribute('data-name');
        qsa('.category-picker__item', menu).forEach(function (it) {
          it.setAttribute('aria-selected', it === li ? 'true' : 'false');
          it.classList.remove('is-active');
        });
        menu.setAttribute('aria-activedescendant', '');
        close();
      }
      input.addEventListener('focus', open);
      input.addEventListener('input', function () { render(this.value); menu.classList.add('is-open'); });
      input.addEventListener('keydown', function (e) {
        var items = qsa('.category-picker__item', menu);
        if (!items.length) return;
        var activeId = menu.getAttribute('aria-activedescendant');
        var idx = -1;
        for (var i = 0; i < items.length; i++) { if (items[i].id === activeId) { idx = i; break; } }
        if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; setActive(items, idx); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; setActive(items, idx); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(idx >= 0 ? items[idx] : items[0]); }
        else if (e.key === 'Escape') { close(); }
      });
      menu.addEventListener('click', function (e) {
        var li = e.target.closest ? e.target.closest('.category-picker__item') : null;
        choose(li);
      });
      document.addEventListener('click', function (e) { if (!root.contains(e.target)) close(); });
      // 编辑页回填已选分类名称
      var pre = hidden.value;
      if (pre) {
        var found = null;
        allCategories.forEach(function (c) { if (String(c._id) === String(pre)) found = c; });
        if (found) input.value = found.name;
      }
      render('');
    });
  }

  // 从已有分类中匹配最相关的一个（完全自动预选分类用）
  function matchCategory(title, content) {
    if (!allCategories || !allCategories.length) return null;
    var titleLow = (title || '').toLowerCase();
    var textLow = ((title || '') + '\n' + (content || '')).toLowerCase();
    var best = null, bestScore = 0;
    allCategories.forEach(function (c) {
      var name = (c.name || '').trim().toLowerCase();
      if (!name || name.length < 2) return;                  // 跳过过短分类名，降低误命中
      // 超短拉丁缩写（UI/API/DB/JS/CSS 等）：区分度极低、正文极易偶发命中，
      // 仅在标题出现时才参与匹配，正文出现一律忽略（宁可不选也不错选）
      var isShortLatin = /^[a-z0-9]+$/.test(name) && name.length <= 3;
      var titleHit = titleLow.indexOf(name) !== -1;
      var bodyHit = textLow.indexOf(name) !== -1;
      if (isShortLatin && !titleHit) return;
      var score = 0;
      if (titleHit) score += 50;   // 标题命中绝对主导
      if (bodyHit) score += 1;     // 正文命中低权重（中文/长词有区分度，短缩写已被上文拦截）
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore > 0 ? best : null;
  }
  // 完全自动预选分类：标题输入后若未手动选分类，自动填入最相关分类（可手动改）
  function bindCategoryAuto() {
    var root = qs('.js-category-picker');
    if (!root || root.__catAutoBound) return;
    root.__catAutoBound = true;
    var hidden = qs('.js-category-value', root);
    var input = qs('.js-category-input', root);
    var menu = qs('.js-category-menu-list', root);
    if (!hidden || !input) return;
    var tmr;
    function schedule() {
      clearTimeout(tmr);
      tmr = setTimeout(function () {
        if (hidden.value) return;                     // 已手动选定则不覆盖
        if (document.activeElement === input) return;  // 用户正在操作分类框则不打扰
        var title = val(qs('.js-add-content-name')) || '';
        var content = '';
        if (window.__vditor && typeof window.__vditor.getValue === 'function') {
          try { content = window.__vditor.getValue() || ''; } catch (e) {}
        } else { content = val(qs('.js-editor')) || ''; }
        var cat = matchCategory(title, content);
        if (cat) {
          hidden.value = cat._id;
          input.value = cat.name;
          if (menu) qsa('.category-picker__item', menu).forEach(function (it) {
            var sel = it.getAttribute('data-id') === String(cat._id);
            it.setAttribute('aria-selected', sel ? 'true' : 'false');
            it.classList.toggle('is-selected', sel);
          });
          var hint = qs('.js-cat-hint');
          if (hint) hint.textContent = '已自动匹配分类「' + cat.name + '」，可手动修改';
        }
      }, 800);
    }
    var titleEl = qs('.js-add-content-name');
    if (titleEl) titleEl.addEventListener('input', schedule);
  }

  function loadCategoryMenu() {
    fetchCategories().then(function (docs) {
      allCategories = docs;
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
        if (sessionUser == null && qs('.js-login-btn')) qs('.js-login-btn').click();
        window.addEventListener('beforeunload', beforeUnloadHandler);
      }
      if (url.indexOf('view=editContent') !== -1) {
        if (sessionUser == null && qs('.js-login-btn')) qs('.js-login-btn').click();
        window.addEventListener('beforeunload', beforeUnloadHandler);
      }
    }).catch(function () {
      var menu = qs('.js-category-menu');
      if (menu) menu.innerHTML = '<li>' + NL.state('error', { title: '分类没加载出来', text: '稍后重试，或回首页浏览文章', retry: 'categories' }) + '</li>';
    });

    on(qs('.js-category-menu'), 'click', '.js-state-retry', function () {
      if (attr(this, 'data-retry') !== 'categories') return;
      categoryPromise = null;   // 允许重试重新拉取分类
      var menu = qs('.js-category-menu');
      if (menu) menu.innerHTML = '<li>' + NL.state('loading') + '</li>';
      loadCategoryMenu();
    });
  }

  /* ---------------- 标签：客户端自动提取（零依赖，离线可用）---------------- */
  var STOP_EN = ('the and for with this that content div span class http https www com net org var function return null true false node code html body script style import export from use using new not are was were been have has had will would can could should may might must do does did a an as at by in of on or to is it if else while let const app via per using get set type number string boolean').split(' ');
  var STOP_ZH = '的了是在和与等你我他她它这那有个不也都就而及或对于把被让给从到上下中内外前后已将又很更最再比因为由经但却若如着过才么什被并且其也们得能会要被比被';
  function zhHasStop(g) {
    for (var i = 0; i < g.length; i++) { if (STOP_ZH.indexOf(g.charAt(i)) !== -1) return true; }
    return false;
  }
  // 从标题+正文提取候选标签：英文/技术词 + 中文 2~3 字 n-gram，过滤停用词
  function extractTags(title, content) {
    var text = (title || '') + '\n' + (content || '');
    text = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' '); // 去代码块/行内代码
    text = text.replace(/<[^>]+>/g, ' ');                                  // 去 HTML
    text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');                 // 链接/图片保留文字
    text = text.replace(/[#>*_~=\-]+/g, ' ');                              // 去 markdown 符号
    // 英文 / 技术词
    var enTerms = {};
    var enRe = /[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*/g, m;
    while ((m = enRe.exec(text)) !== null) {
      var w = m[0]; if (w.length < 2) continue;
      var low = w.toLowerCase();
      if (STOP_EN.indexOf(low) !== -1) continue;
      enTerms[low] = (enTerms[low] || 0) + 1;
    }
    var specials = text.match(/(?:C\+\+|C#|F#|Objective\-C)/g) || [];
    specials.forEach(function (s) { var k = s.replace(/\+/g, 'p').replace(/#/g, 's'); enTerms[k] = (enTerms[k] || 0) + 1; });
    // 中文 n-gram（标题加权：重复一次提升权重）
    var titleZh = (title || '').replace(/[^\u4e00-\u9fa5]/g, '');
    var zhText = (content || '').replace(/[^\u4e00-\u9fa5]/g, ' ') + ' ' + titleZh + ' ' + titleZh;
    var zhScores = {};
    zhText.split(/\s+/).filter(Boolean).forEach(function (run) {
      for (var n = 2; n <= 3; n++) {
        for (var i = 0; i + n <= run.length; i++) {
          var g = run.substr(i, n);
          if (zhHasStop(g)) continue;
          zhScores[g] = (zhScores[g] || 0) + (n === 3 ? 1.2 : 1);
        }
      }
    });
    var enList = Object.keys(enTerms).map(function (k) { return { t: k, s: enTerms[k] }; })
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 4).map(function (x) { return x.t; });
    var zhList = Object.keys(zhScores).map(function (k) { return { t: k, s: zhScores[k] }; })
      .filter(function (x) { return x.s >= 2; })        // 至少加权出现两次才入选
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 4).map(function (x) { return x.t; });
    var result = enList.concat(zhList), seen = {}, out = [];
    result.forEach(function (t) { var key = t.toLowerCase(); if (!seen[key]) { seen[key] = 1; out.push(t); } });
    return out.slice(0, 6);
  }
  function renderTagPreview(input) {
    var box = qs('.js-tag-preview');
    if (!box || !input) return;
    var tags = input.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    if (!tags.length) { box.innerHTML = ''; return; }
    box.innerHTML = tags.map(function (t) {
      return '<span class="tag-preview__chip" data-tag="' + t.replace(/"/g, '&quot;') + '">' + t +
        '<button type="button" class="tag-preview__chip-remove" aria-label="移除">×</button></span>';
    }).join('');
  }
  function setTagHint(msg) {
    var hint = qs('.js-tag-hint');
    if (hint) hint.textContent = msg || '';
  }
  function autoGenerateTags() {
    var input = qs('.js-tags-value');
    if (!input) return;
    var title = val(qs('.js-add-content-name')) || '';
    var content = '';
    if (window.__vditor && typeof window.__vditor.getValue === 'function') {
      try { content = window.__vditor.getValue() || ''; } catch (e) { content = ''; }
    } else {
      content = val(qs('.js-editor')) || '';
    }
    if (!title.trim() && !content.trim()) { setTagHint('请先填写标题或正文'); return; }
    var tags = extractTags(title, content);
    var existing = input.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    tags.forEach(function (t) { if (existing.indexOf(t) === -1) existing.push(t); });
    input.value = existing.slice(0, 8).join(', ');
    renderTagPreview(input);
    setTagHint(tags.length ? ('已提取 ' + tags.length + ' 个候选标签，可手动增删') : '未提取到明显标签，请手动填写');
  }
  function bindTagFields() {
    qsa('.js-tags-value').forEach(function (input) {
      if (input.__tagBound) return; input.__tagBound = true;
      renderTagPreview(input);
      input.addEventListener('input', function () { renderTagPreview(input); setTagHint(''); });
      var box = qs('.js-tag-preview');
      if (box) {
        box.addEventListener('click', function (e) {
          var rm = e.target.closest ? e.target.closest('.tag-preview__chip-remove') : null;
          if (!rm) return;
          var tag = rm.parentNode.getAttribute('data-tag');
          var arr = input.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean)
            .filter(function (t) { return t !== tag; });
          input.value = arr.join(', ');
          renderTagPreview(input);
        });
      }
    });
    // 懒人模式：标题写够字后，标签仍为空则自动填充候选（不覆盖手动输入）
    var titleEl = qs('.js-add-content-name');
    if (titleEl && !titleEl.__autoBound) {
      titleEl.__autoBound = true;
      var tmr;
      titleEl.addEventListener('input', function () {
        clearTimeout(tmr);
        tmr = setTimeout(function () {
          var input = qs('.js-tags-value');
          if (!input || input.value.trim() !== '') return;
          var content = '';
          if (window.__vditor && typeof window.__vditor.getValue === 'function') {
            try { content = window.__vditor.getValue() || ''; } catch (e) {}
          } else { content = val(qs('.js-editor')) || ''; }
          var tags = extractTags(val(titleEl), content);
          if (tags.length) { input.value = tags.join(', '); renderTagPreview(input); }
        }, 800);
      });
    }
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
  // 防抖 + 竞态取消：连续输入只发最后一次请求，且 abort 掉在途的旧请求
  var searchTimer = null;
  var searchController = null;
  function suggestDebounced(word, searchUrl) {
    if (searchTimer) clearTimeout(searchTimer);
    if (searchController) { try { searchController.abort(); } catch (e) {} }
    searchController = ('AbortController' in window) ? new AbortController() : null;
    var controller = searchController;
    searchTimer = setTimeout(function () { suggest(word, searchUrl, controller ? controller.signal : null); }, 220);
  }
  function suggest(word, searchUrl, signal) {
    var panel = qs('.js-search-panel');
    if (!panel) return;
    panel.innerHTML = '<li>' + NL.state('loading') + '</li>';
    show(panel);
    qs('.js-search-bar').classList.add('open');
    fetch(searchUrl, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ word: word }).toString(),
      signal: signal || null
    }).then(function (r) { return r.json(); }).then(function (data) {
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
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return; // 被新输入取消，忽略
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
        var prev = el.checked;
        var payload = build(el.checked);
        payload.id = id;
        el.disabled = true;
        postForm(api, payload).then(function (data) {
          el.disabled = false;
          if (data && data.success) {
            NL.toast(data.msg || '已保存');
          } else {
            el.checked = !prev;                 // 失败回滚开关
            NL.toast((data && data.msg) || '操作失败');
          }
        }).catch(function () {
          el.disabled = false;
          el.checked = !prev;                   // 网络错误也回滚
          NL.toast('网络错误，操作未生效');
        });
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
    popEl.style.cssText = 'position:fixed;z-index:var(--z-tooltip);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:var(--elev);padding:var(--space-3);max-width:280px;';
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

/* =========================================================================
   NODELOG · 后台管理增强（纯追加 · 自治 block · 零新依赖）
   —— 只消费 views/common/{adminToolbar,adminPager,icons}.ejs 的数据属性；
   —— 不重排、不覆盖上方 IIFE 的任何既有函数/委托（change-safety：唯一追加锚点）。
   —— 依赖全局 window.NL（ui.js 提供 modal/alert/toast/closeAll）；后台 footer
      不加载前台 state/esc 脚本，故此处做带守卫的 fallback，绝不覆盖前台实现。
   —— 所有用户字段只经 createElement/textContent/setAttribute/DOM value 落地；
      按钮字段描述由 data-form(JSON) 驱动；用户值一律不拼进 HTML 字符串。
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------- 极小工具（对齐上方 IIFE 的 qs/qsa/on，含靶心防护） ---------------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, evt, sel, handler) {
    if (!el) return;
    el.addEventListener(evt, function (e) {
      var t = (e.target && e.target.closest) ? e.target.closest(sel) : null;
      if (t && el.contains(t)) handler.call(t, e, t);
    });
  }
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
  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^\/(?!\/)/.test(u)) return u;   // 拒绝 //evil.com 协议相对地址
    return null;                          // 拒绝 javascript:/data:/vbscript:
  }

  /* ---------------- NL 带守卫 fallback（后台 footer 无前台 state/esc） ---------------- */
  var NL = (window.NL = window.NL || {});
  if (typeof NL.esc !== 'function') {
    NL.esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
  }
  if (typeof NL.state !== 'function') {
    // 图标只用 icons.ejs 的 symbol，不引入第二套图标语言。
    var STATE_SYMBOL = { error: 'i-shield', empty: 'i-list', success: 'i-check' };
    NL.state = function (kind, o) {
      o = o || {};
      var isAlert = (kind === 'error');
      var h = '<div class="state state--' + NL.esc(kind) + ' state--inline" data-state="' + NL.esc(kind) + '"' +
        ' role="' + (isAlert ? 'alert' : 'status') + '" aria-live="' + (isAlert ? 'assertive' : 'polite') + '" aria-atomic="true">';
      if (kind === 'loading') {
        return h + '<div class="state-skeleton" aria-hidden="true"><span class="sk sk--title"></span>' +
          '<span class="sk sk--line"></span><span class="sk sk--line sk--short"></span></div>' +
          '<span class="sr-only">正在加载</span></div>';
      }
      h += '<span class="state-icon" aria-hidden="true"><svg class="nl-icon" width="20" height="20">' +
        '<use href="#' + NL.esc(STATE_SYMBOL[kind] || 'i-list') + '"></use></svg></span><div class="state-body">';
      if (o.title) h += '<p class="state-title">' + NL.esc(o.title) + '</p>';
      if (o.text) h += '<p class="state-text">' + NL.esc(o.text) + '</p>';
      if (o.retry) {
        h += '<div class="state-actions"><button type="button" class="btn btn-sm js-state-retry" data-retry="' +
          NL.esc(o.retry) + '">' + NL.esc(o.retryLabel || '重试') + '</button></div>';
      }
      return h + '</div></div>';
    };
  }

  function toast(m) { if (typeof NL.toast === 'function') NL.toast(m); }
  function confirmBox(msg, cb) {
    if (typeof NL.alert === 'function') NL.alert(msg, { onConfirm: cb });
    else if (window.confirm(msg)) cb();
  }

  /* ---------------- 上下文：从工具条 data-* 推导 API，通用不硬编码资源 ---------------- */
  var BATCH_LIMIT = 100; // 与 controllers/adminConfig.BATCH_LIMIT 默认一致，后端校验为准
  function toolbar(el) { return (el && el.closest) ? (el.closest('.admin-toolbar') || qs('.admin-toolbar')) : qs('.admin-toolbar'); }
  function resOf(el) { var t = toolbar(el); return (t && t.getAttribute('data-res')) || ''; }
  function listScope(el) { var t = toolbar(el); return (t && t.closest('.admin-list')) || document; }
  function apiFor(res, action, el) {
    var t = toolbar(el);
    var custom = t ? t.getAttribute('data-' + action + '-api') : null;
    return custom || ('/manager/' + res + '/' + action);
  }
  function boxes(root, checkedOnly) {
    return qsa(checkedOnly ? '.js-batch-check:checked' : '.js-batch-check', root || document);
  }
  function selectedIds() {
    return boxes(document, true).map(function (el) { return el.value; }).filter(function (v) { return v !== ''; });
  }
  function rowOf(id) {
    var all = boxes(document, false);
    for (var i = 0; i < all.length; i++) if (all[i].value === String(id)) return all[i].closest('tr');
    return null;
  }
  function updateCount() {
    qsa('.js-batch-count').forEach(function (el) {
      el.textContent = '已选 ' + selectedIds().length + ' 条（单次≤' + BATCH_LIMIT + '）';
    });
  }
  function updateRowStatus(tr, status) {
    if (!tr) return;
    var cb = qs('.js-admin-status', tr);
    var label = qs('.js-status-label', tr);
    var s = String(status);
    if (cb) { cb.checked = (s === '0'); cb.setAttribute('data-status', s); }
    if (label) label.textContent = (s === '0' ? '正常' : '禁用');
  }

  /* ---------------- 批量选择（全选/单选/计数，上限 100） ---------------- */
  on(document, 'change', '.js-batch-all', function () {
    var scope = listScope(this);
    var all = boxes(scope, false);
    var toCheck = this.checked;
    var picked = 0;
    all.forEach(function (b) {
      if (toCheck && picked >= BATCH_LIMIT) { b.checked = false; return; }
      b.checked = toCheck;
      if (toCheck) picked++;
    });
    if (toCheck && all.length > BATCH_LIMIT) toast('单次最多 ' + BATCH_LIMIT + ' 条，已选中前 ' + BATCH_LIMIT + ' 条');
    updateCount();
  });
  on(document, 'change', '.js-batch-check', function () {
    var scope = listScope(this);
    var all = boxes(scope, false);
    var head = qs('.js-batch-all', scope);
    var checked = all.filter(function (b) { return b.checked; }).length;
    if (head) head.checked = (checked > 0 && checked === all.length);
    updateCount();
  });

  /* ---------------- 批量删除 / 批量改状态（部分成功：失败行保留） ---------------- */
  on(document, 'click', '.js-batch-delete', function () {
    var ids = selectedIds();
    if (!ids.length) { toast('请先选择要操作的记录'); return; }
    if (ids.length > BATCH_LIMIT) { toast('单次最多操作 ' + BATCH_LIMIT + ' 条'); return; }
    var res = resOf(this);
    var self = this;
    confirmBox('删除后无法恢复，确定删除选中的 ' + ids.length + ' 条记录吗？', function () {
      post(apiFor(res, 'batch', self), { ids: ids, action: 'delete' })
        .then(function (data) { applyBatchResult(data, ids, 'delete'); })
        .catch(function () { toast('网络错误，批量删除未生效'); });
    });
  });
  on(document, 'click', '.js-batch-status', function () {
    var ids = selectedIds();
    if (!ids.length) { toast('请先选择要操作的记录'); return; }
    if (ids.length > BATCH_LIMIT) { toast('单次最多操作 ' + BATCH_LIMIT + ' 条'); return; }
    var res = resOf(this);
    var self = this;
    var sel = qs('.js-batch-status-value', toolbar(this));
    var status = sel ? sel.value : '';
    if (status === '') { toast('请选择目标状态'); return; }
    confirmBox('确定把选中的 ' + ids.length + ' 条记录改为目标状态吗？', function () {
      post(apiFor(res, 'batch', self), { ids: ids, action: 'status', status: status })
        .then(function (data) { applyBatchResult(data, ids, 'status', status); })
        .catch(function () { toast('网络错误，批量改状态未生效'); });
    });
  });
  function applyBatchResult(data, ids, action, status) {
    if (!data || data.success === false) { toast((data && data.msg) || '操作失败，原数据已保留'); return; }
    var results = data.results || [];
    var okMap = {};
    var okN = 0;
    results.forEach(function (r) {
      if (r && r.ok) { okMap[String(r.id)] = r; okN++; }
    });
    var failed = (typeof data.failed === 'number') ? data.failed : (ids.length - okN);
    ids.forEach(function (id) {
      var tr = rowOf(id);
      if (!tr) return;
      if (okMap[String(id)]) {
        if (action === 'delete') {
          if (tr.parentNode) tr.parentNode.removeChild(tr);
        } else {
          updateRowStatus(tr, status);
          var chk = qs('.js-batch-check', tr); if (chk) chk.checked = false;
        }
      } else {
        // 失败行保留并就地标注（文字 + 颜色双线索，不只靠颜色），绝不整体清空/伪装空态。
        tr.classList.add('admin-row--error');
        tr.setAttribute('data-batch-error', '1');
        var op = tr.querySelector('.admin-col-actions') || tr.lastElementChild;
        if (op && !op.querySelector('.admin-row-error-tag')) {
          var tag = document.createElement('span');
          tag.className = 'admin-row-error-tag';
          tag.textContent = ' 操作失败';
          op.appendChild(tag);
        }
      }
    });
    updateCount();
    if (failed > 0) toast('成功 ' + okN + ' 条，失败 ' + failed + ' 条；失败记录已保留');
    else toast((action === 'delete' ? '已删除 ' : '已更新 ') + okN + ' 条');
  }

  /* ---------------- 单条状态 / 单条删除（失败回滚，保留原行） ---------------- */
  on(document, 'change', '.js-admin-status', function () {
    var el = this;
    var tr = el.closest('tr');
    var res = resOf(el);
    var id = el.getAttribute('data-id');
    var target = el.checked ? '0' : '1';
    var prev = el.checked ? '1' : '0';
    el.disabled = true;
    post(apiFor(res, 'status', el), { id: id, status: target })
      .then(function (data) {
        el.disabled = false;
        if (data && data.success !== false) {
          el.setAttribute('data-status', target);
          var label = tr ? qs('.js-status-label', tr) : null;
          if (label) label.textContent = (target === '0' ? '正常' : '禁用');
          toast((data && data.msg) || '状态已更新');
        } else {
          el.checked = (prev === '0');
          toast((data && data.msg) || '状态更新失败，已恢复原状');
        }
      })
      .catch(function () { el.disabled = false; el.checked = (prev === '0'); toast('网络错误，状态未更新'); });
  });
  on(document, 'click', '.js-admin-delete', function () {
    var el = this;
    var tr = el.closest('tr');
    var res = resOf(el);
    var id = el.getAttribute('data-id');
    confirmBox('删除后无法恢复，确定删除这条记录吗？', function () {
      post(apiFor(res, 'delete', el), { id: id })
        .then(function (data) {
          if (data && data.success !== false) {
            if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
            updateCount();
            toast((data && data.msg) || '已删除');
          } else toast((data && data.msg) || '删除失败，原数据已保留');
        })
        .catch(function () { toast('网络错误，删除未生效'); });
    });
  });

  /* ---------------- 新增 / 编辑：字段描述由 data-form(JSON) 驱动，控件全用 DOM API ---------------- */
  function fieldsOf(btn) {
    try { return JSON.parse(btn.getAttribute('data-form') || '[]') || []; }
    catch (e) { return []; }
  }
  function openForm(btn, edit) {
    if (typeof NL.modal !== 'function') { toast('弹层组件未就绪，请刷新页面'); return; }
    var res = resOf(btn);
    var bar = toolbar(btn);
    var fields = fieldsOf(btn);
    if (!fields.length && bar) fields = fieldsOf(bar);   // 编辑按钮未自带字段时，复用工具条新增字段
    var title = btn.getAttribute('data-title') || '记录';
    var api = (edit && ((btn.getAttribute('data-edit-api') || (bar && bar.getAttribute('data-edit-api')))))
      || btn.getAttribute('data-api') || ('/manager/' + res + '/add');
    var id = edit ? btn.getAttribute('data-id') : '';
    var tr = edit ? btn.closest('tr') : null;
    NL.modal({
      title: (edit ? '编辑' : '新增') + ' · ' + title,
      content: '', // 内容全部在 onOpen 内用 DOM 接口构建；用户字段不进 HTML 字符串
      size: 'large',
      onOpen: function (modal) {
        var body = modal.querySelector('.nl-modal-body');
        var form = document.createElement('form');
        form.className = 'admin-form';
        form.noValidate = true;                 // 自校验 + 就地错误，避免浏览器气泡与文案脱节
        fields.forEach(function (f) {
          var wrap = document.createElement('label');
          var cap = document.createElement('span');
          cap.textContent = f.t || f.n;
          wrap.appendChild(cap);
          var input;
          if (f.k === 'textarea') { input = document.createElement('textarea'); input.rows = 4; }
          else if (f.k === 'select') {
            input = document.createElement('select');
            (f.o || []).forEach(function (o) {
              var opt = document.createElement('option');
              opt.value = String(o.v); opt.textContent = String(o.t);
              input.appendChild(opt);
            });
          } else { input = document.createElement('input'); input.type = 'text'; }
          input.name = f.n;
          input.className = 'form-control';
          if (f.max) input.maxLength = parseInt(f.max, 10);
          if (f.req) { input.required = true; input.setAttribute('aria-required', 'true'); }
          var initial = (tr && tr.getAttribute('data-' + f.n) != null) ? tr.getAttribute('data-' + f.n) : f.d;
          if (initial != null) input.value = String(initial);
          wrap.appendChild(input);
          form.appendChild(wrap);
        });
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
        var save = document.createElement('button');
        save.type = 'submit'; save.className = 'btn btn-primary'; save.textContent = '保存';
        actions.appendChild(cancel); actions.appendChild(save); form.appendChild(actions);

        function showErr(msg) { err.textContent = msg; err.hidden = false; }
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          err.hidden = true;
          var payload = {};
          var bad = null;
          fields.forEach(function (f) {
            var input = form.elements[f.n];
            var v = input ? String(input.value == null ? '' : input.value).trim() : '';
            if (f.req && v === '' && !bad) bad = { input: input, msg: (f.t || f.n) + '不能为空' };
            payload[f.n] = v;
          });
          if (bad) { showErr(bad.msg); if (bad.input) bad.input.focus(); return; }
          if (id) payload.id = id;
          save.disabled = true;
          post(api, payload)
            .then(function (data) {
              save.disabled = false;
              if (data && data.success !== false && data.result !== false) {
                NL.closeAll();
                toast((data && data.msg) || '已保存');
                location.reload();
              } else showErr((data && data.msg) || '保存失败，请检查输入后重试');
            })
            .catch(function () { save.disabled = false; showErr('网络错误，保存未生效，请重试'); });
        });
        body.appendChild(form);
      }
    });
  }
  on(document, 'click', '.js-admin-add', function () { openForm(this, false); });
  on(document, 'click', '.js-admin-edit', function () { openForm(this, true); });

  /* ---------------- 导入 CSV（JSON body: {content}）/ 导出 CSV（GET 下载） ---------------- */
  on(document, 'click', '.js-admin-import', function () {
    var f = qs('.js-admin-file', toolbar(this));
    if (f) f.click();
  });
  on(document, 'change', '.js-admin-file', function () {
    var input = this;
    var file = input.files && input.files[0];
    if (!file) return;
    var MAX_BYTES = 2 * 1024 * 1024;   // 与 adminConfig.IMPORT_MAX_BYTES 默认一致，后端为准
    var MAX_ROWS = 1000;               // 与 adminConfig.IMPORT_MAX_ROWS 默认一致
    function reset() { try { input.value = ''; } catch (e) {} } // 允许重复选同一文件
    if (file.size > MAX_BYTES) { toast('文件超过 2MB，请拆分后重试'); reset(); return; }
    var res = resOf(input);
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '').replace(/^\uFEFF/, '');  // 去 UTF-8 BOM
      var rows = text.split(/\r?\n/).filter(function (line) { return line.trim() !== ''; }).length;
      if (!text.trim()) { toast('CSV 内容不能为空'); reset(); return; }
      if (rows > MAX_ROWS) { toast('文件超过 ' + MAX_ROWS + ' 行，请拆分后重试'); reset(); return; }
      post(apiFor(res, 'import', input), { content: text })
        .then(function (data) {
          if (data && data.success !== false) {
            toast('导入完成：成功 ' + (data.created || 0) + ' 条，失败 ' + (data.failed || 0) + ' 条');
            location.reload();
          } else toast((data && data.msg) || '导入失败，请检查 CSV 格式');
        })
        .catch(function () { toast('网络错误，导入未生效'); })
        .then(reset);
    };
    reader.onerror = function () { toast('文件读取失败，请重试'); reset(); };
    reader.readAsText(file, 'UTF-8');
  });
  on(document, 'click', '.js-admin-export', function () {
    var res = resOf(this);
    var form = qs('.js-admin-filter', toolbar(this));
    var params = new URLSearchParams();
    if (form) {
      var fd = new FormData(form);
      fd.forEach(function (v, k) { if (v !== '' && v != null) params.append(k, v); });
    } else {
      var cur = new URLSearchParams(location.search);
      cur.delete('page');
      cur.forEach(function (v, k) { params.append(k, v); });
    }
    window.location.assign('/manager/' + res + '/export?' + params.toString());
  });

  /* ---------------- 初始化：进入页面先同步批量计数 ---------------- */
  function bootAdmin() { updateCount(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAdmin);
  else bootAdmin();
})();
