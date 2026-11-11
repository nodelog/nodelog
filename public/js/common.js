var layerIndex = null;//layer弹出层index全局变量
//自定义消息弹出框
function myMsg(_msg) {
    closeLayer();
    layer.open({
        content: _msg,
        time: 2 //2秒后自动关闭
    });
}
function closeLayer(){
    if(layerIndex != null){
        layer.close(layerIndex);
    }
}
//自定义确认弹出框
function myAlert(_msg, callback) {
    layerIndex = layer.open({
        title: 'NODELOG 温馨提示',
        content: _msg,
        btn: ['嗯', '不要'],
        yes: function(index){
            layer.close(index);
            callback();
        }
    });
}
//自定义弹出页面
function myPage(title, area, html, callback) {
    layerIndex = layer.open({
        type: 1,
        content: html,
        style: 'position:fixed; left:0; top:0; width:100%; height:100%; border:none;',
        success: callback
    });
}
//自定义加载
function loading() {
    layerIndex = layer.open({type: 2});
}
//输入框字数限制
function limitLength(select, length) {
    if (select.val().length >= length) {
        select.val(select.val().substring(0, length));
    }
}
//剩余可输入字数
function canInput(select, length) {
    var _size = select.val().length;
    return length - _size;
}
//日期格式化
Date.prototype.format = function (fmt) {
    if (fmt == null) {
        fmt = "yyyy-MM-dd hh:mm:ss";
    }
    var o = {
        "M+": this.getMonth() + 1,
        "d+": this.getDate(),
        "h+": this.getHours(),
        "H+": this.getHours(),
        "m+": this.getMinutes(),
        "s+": this.getSeconds()
    };
    if (/(y+)/.test(fmt)) {
        fmt = fmt.replace(RegExp.$1, (this.getFullYear() + "").substr(4 - RegExp.$1.length));
    }
    for (var k in o) {
        if (new RegExp("(" + k + ")").test(fmt)) {
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
        }
    }
    return fmt;
}
//jquery函数
$(function () {
    $('.js-content a').on('click touchend', function(e) {
        var el = $(this);
        var link = el.attr('href');
        if(link && link.indexOf('javascript:;') == -1){
            window.open(link, '_blank');
            e.preventDefault();
        }
    });

    //当前url
    var url = location.href;
//    var current_menu = $('.js-current-menu').val();
//    if (current_menu && $('.' + current_menu).length > 0) {
//        $('.current-menu').removeClass("current-menu");
//        $('.' + current_menu).addClass("current-menu");
//    } else {
//        $('.js-home-menu').addClass("current-menu");
//    }
    var sessionUser;//当前用户session
    function getSessionUser(){
        $.ajax({
            url: "/session",
            dataType: "json",
            async: false,
            success: function (data) {
                layer.closeAll();
                sessionUser = data.user;
            }
        });
    }
    getSessionUser();
    //是否后台路径判断
    if (url.indexOf("/manager") == -1) {
        //加载所有分类（失败不静默空白：显示统一 error 态并提供重试）
        function loadCategoryMenu() {
        $.get("/category/all",
            function (data) {
                var docs = data.docs;
                var html = '<li style="padding: 5px;"><input type="text" class="form-control js-category-auto" placeholder="输入" autofocus x-webkit-speech></li>';
                var _url = "";
                var _addHtml = "";
                var _editHtml = "";
                var _categoryId = $('.js-edit-content-category').val();
                $.each(docs, function (i, tempDoc) {
                    var _id = tempDoc._id, _name = tempDoc.name;
                    _url = "/content/category?categoryId=" + _id + "&page=1";
                    html += '<li><a href="' + _url + '"  class="l-option">' + _name + '</a></li>';
                    if (url.indexOf("content/addPage") != -1) {
                        _addHtml += '<option class="l-option" value="' + _id + '">' + _name + '</option>';
                    } else if (url.indexOf("view=editContent") != -1) {
                        if (_id != _categoryId) {
                            _editHtml += '<option class="l-option" value="' + _id + '">' + _name + '</option>';
                        } else {
                            _editHtml += '<option value="' + _id + '" selected>' + _name + '</option>';
                        }
                    }
                });
                $('.js-category-menu').html(html);
                //当前分类页面分类菜单高亮
                if (url.indexOf("content/category") != -1) {
                    $('.js-category-menu li').each(function () {
                        $this = $(this).children("a:first");
                        if (url.indexOf($this.attr("href")) != -1) {
                            var _html = $this.html();
                            var _length = _html.length;
                            // $('.js-category-menu-name').html(_html);
                            $this.parent().addClass("l-option-current");
                            $this.addClass("l-option-current");
                            return false;
                        }
                    });
                }
                //写日志页面关闭提醒
                if (url.indexOf("content/addPage") != -1) {
                    $('.js-category-value').html(_addHtml);
                    if (sessionUser == null) {
                        $('.js-login-btn').click();
                    }
                    $(window).bind('beforeunload', function () {
                        return '您输入的内容尚未保存，确定离开此页面吗？';
                    });
                }
                //编辑日志页面关闭提醒
                if (url.indexOf("view=editContent") != -1) {
                    // 编辑器内容已由 editor.ejs 直接填充到 textarea，无需再注入
                    $('.js-category-value').html(_editHtml);
                    if (sessionUser == null) {
                        $('.js-login-btn').click();
                    }
                    $(window).bind('beforeunload', function () {
                        return '您输入的内容尚未保存，确定离开此页面吗？';
                    });
                }
            }, "json").fail(function () {
                $('.js-category-menu').html('<li>' + window.NL.state('error', {
                    title: '分类没加载出来', text: '稍后重试，或回首页浏览文章', retry: 'categories'
                }) + '</li>');
            });
        }
        loadCategoryMenu();
        $('.js-category-menu').on('click', '.js-state-retry', function () {
            if ($(this).attr('data-retry') !== 'categories') return;
            $('.js-category-menu').html('<li>' + window.NL.state('loading') + '</li>');
            loadCategoryMenu();
        });
    }
    //分类菜单自动筛选
    $('.js-category-menu').delegate('.js-category-auto', 'keyup focus click change', function (e) {
        e.stopPropagation();
        var $this = $(this);
        var _val = $this.val().trim();
        if (_val != "") {
            $('.js-category-menu li').each(function () {
                _this = $(this).children("a:first");
                if (_this.text().toLowerCase().indexOf(_val.toLowerCase()) != -1) {//存在
                    _this.parent().removeClass("hide");
                } else {
                    _this.parent().addClass("hide");

                }
            });
        } else {
            $('.js-category-menu li').removeClass("hide");
        }
    });
    //登录
    var loginHtml = $('.js-login-panel').html();
    $('.js-login-panel').html("");
    $('.js-login-btn').click(function () {
        myPage('用户登录', ['310px', '200px'], loginHtml, function (obj) {
            $('.js-login-username').focus();
        });
    });
    $('.js-body').delegate('.js-signIn-btn', 'click', function () {
        var userName = $('.js-login-username').val().trim();
        var password = $('.js-login-password').val().trim();
        if (userName == "") {
            myMsg("用户名不能为空");
        } else if (password == "") {
            myMsg("密码不能为空");
        } else {
            loading();
            $.post("/user/login", {
                userName: userName,
                password: password
            }, function (data) {
                var result = data.success;

                if (result) {//success
                    sessionUser = data.obj;
                    $('.js-user-name').text(sessionUser.realName);
                    $('.js-login-toggle a').toggle();
                    layer.closeAll();
                    $(window).unbind('beforeunload');
                } else {
                    myMsg(data.msg);
                }
            }, "json");
        }
    });
    //注册
    var registerHtml = $('.js-register-panel').html();
    $('.js-register-panel').html("");
    $('.js-register-btn').click(function () {
        myPage('用户注册', ['310px', '230px'], registerHtml, function (obj) {
            $('.js-register-username').focus();
        });
    });
    $('.js-body').delegate('.js-signUp-btn', 'click', function () {
        var userName = $('.js-register-username').val().trim();
        var password = $('.js-register-password').val().trim();
        var password2 = $('.js-register-password2').val().trim();
        if (userName == "") {
            myMsg("用户名不能为空");
        } else if (password == "") {
            myMsg("密码不能为空");
        } else if (password2 == "") {
            myMsg("确认密码不能为空");
        } else if (password != password2) {
            myMsg("两次密码不一致");
        } else {
            closeLayer();
            loading();
            $.post("/user/reg", {
                userName: userName,
                password: password,
                password2: password2
            }, function (data) {
                var msg = data.msg;
                closeLayer();
                myMsg(data.msg);
            }, "json");
        }
    });
    //退出
    $('.js-body').delegate('.js-logout-btn', 'click', function () {
        myAlert("您确定从服务器退出当前登录的用户吗？", function () {
            closeLayer();
            loading();
            $.get("/user/logout", {}, function (data) {
                sessionUser = null;
                $('.js-login-toggle a').toggle();
                layer.closeAll();
                $(window).unbind('beforeunload');
                if (url.indexOf("/manager") != -1) {
                    location.href = "/";
                }
            }, "json");
        })
    });
    //删除用户
    $('.js-user-delete').click(function (e) {
        var $this = $(this);
        var id = $this.attr("data-id");
        myAlert("删除后无法恢复，您确定要删除吗？", function () {
            closeLayer();
            loading();
            $.post("/manager/user/delete", {
                id: id
            }, function (data) {
                if (data.success) {
                    $this.parent().parent().fadeOut()
                }
                myMsg(data.msg);
            }, "json");
        });
    });
    //用户状态切换
    $(".js-user-status").each(function (i, obj) {
        var status = $(this).attr("data-type");
        if (status == 0) {
            $(this).prop('checked', true);
        } else {
            $(this).prop('checked', false);
        }
        $(this).bootstrapSwitch({size: 'small', onColor: 'success', offColor: 'danger', onText: '启用', offText: '禁用'});
    });
    $(".js-user-status").on('switchChange.bootstrapSwitch', function (event, status) {
        var id = $(this).attr("data-id");
        console.log(status);
        $.post("/manager/user/update", {
            id: id,
            status: status ? 0 : 1
        }, function (data) {
        }, "json");
    });
    //日志状态切换
    $(".js-content-status").each(function (i, obj) {
        var status = $(this).attr("data-type");
        if (status == 0) {
            $(this).prop('checked', true);
        } else if (status == 2) {
            $(this).prop('checked', false);
        }
        $(this).bootstrapSwitch({size: 'small', onColor: 'success', offColor: 'danger', onText: '共享', offText: '私有'});
    });
    $(".js-content-status").on('switchChange.bootstrapSwitch', function (event, status) {
        var id = $(this).attr("data-id");
        console.log(status);
        $.post("/manager/content/share", {
            id: id,
            status: status ? 0 : 2
        }, function (data) {
        }, "json");
    });
    //分页上一页
    $('.js-pre-page').click(function () {
        var $this = $(this);
        var page = parseInt($this.attr("data-page"));
        if (page <= 1) {
            myMsg("已经是最新的了");
            return;
        } else {
            var _url = $this.attr("data-url");
            window.location = _url + "page=" + (parseInt(page) - 1);
        }
    });
    //分页下一页
    $('.js-next-page').click(function () {
        var $this = $(this);
        var page = parseInt($this.attr("data-page"));
        var totalPage = parseInt($this.attr("data-total"));
        if (page >= totalPage) {
            myMsg("后面没有了");
            return;
        } else {
            var _url = $this.attr("data-url");
            window.location = _url + "page=" + (parseInt(page) + 1);
        }
    });
//    $(".js-menu-bar").pin({
//        containerSelector: ".js-panel-row"
//    })
    //添加分类
    $('.js-add-category').click(function () {
        myPage('添加分类', ['310px', '160px'], $('.js-add-category-panel').html(), function (obj) {
            $('.js-category-name').val(value);
            $('.js-category-name').attr("data-id", id);
            $('.layermcont .js-category-name').focus();
        });
    });
    $('.js-body').delegate('.js-save-category', 'click', function () {

        var name = $('.layermcont .js-category-name').val().trim();
        var id = $('.layermcont .js-category-name').attr("data-id");
        if (name == "") {
            myMsg("分类名称不能为空");
        } else if (!id) {//add
            $.post("/manager/category/add", {
                name: name
            }, function (data) {
                var result = data.success;
                var msg = data.msg;
                if (result) {//success
                    closeLayer();
                    window.location = "/manager/category?page=1";
                }
                myMsg(data.msg);
            }, "json");
        } else {
            $.post("/manager/category/modify", {
                id: id,
                name: name
            }, function (data) {
                var result = data.success;
                var msg = data.msg;
                if (result) {//success
                    closeLayer();
                    $('.js-modify-category-current').text(name);
                }
                myMsg(data.msg);
            }, "json");
        }
    });
    //删除分类
    $('.js-category-delete').click(function (e) {
        var $this = $(this);
        var id = $this.attr("data-id");
        myAlert("删除后无法恢复，您确定要删除此分类吗？", function () {
            closeLayer();;
            loading();
            $.post("/manager/category/delete", {
                id: id
            }, function (data) {
                closeLayer();;
                if (data.success) {
                    $this.parent().parent().fadeOut();
                }
                myMsg(data.msg);
            }, "json");

        })
    });
    //修改分类
    $('.js-modify-category').click(function () {
        $('.js-modify-category-current').removeClass("js-modify-category-current");
        var $this = $(this);
        var value = $this.text();
        var id = $this.attr("data-id");
        $this.addClass("js-modify-category-current");
        myPage('修改分类', ['310px', '160px'],  $('.js-add-category-panel').html(), function (obj) {
            $('.js-category-name').val(value);
            $('.js-category-name').attr("data-id", id);
            $('.layermcont .js-category-name').focus();
        });
    });
    //日志名称输入框字数限制和剩余字数提示
    $('.js-add-content-name').bind('keyup change  focus blur', function () {
        var $this = $(this);
        var maxlength = parseInt($this.attr("maxlength"), 10);
        if ($this.val().length >= maxlength) {
            limitLength($this, maxlength);
        }
        $('.js-content-name-chars').html(canInput($this, maxlength));
    });
    //保存日志
    $('.js-save-content ').click(function () {
        if (sessionUser == null) {
            $('.js-login-btn').click();
        } else {
            var name = $('.js-add-content-name').val().trim();
            var oldName = $('.js-add-content-name').attr("data-name");
            var id = $('.js-add-content-name').attr("data-id");
            var content = $('.js-editor').val();
            var category = $('.js-category-value').val();
            var original = $('input[name="original"]').val().trim();
            var contentType = $('.js-content-type').val() || 'markdown';
            if (name === "") {
                myMsg("标题不能为空");
            } else if (content.trim() === "") {
                myMsg("内容不能为空");
            } else {
                loading();
                $.post("/content/add", {
                    id: id,
                    name: name,
                    content: content,
                    contentType: contentType,
                    category: category,
                    oldName: oldName,
                    original: original
                }, function (data) {
                    closeLayer();;
                    myMsg(data.msg);
                    if (data.success) {//success
                        $(window).unbind('beforeunload');
                        if (id != null) {
                            window.location = "/content/detail?view=contentDetail&id=" + id;
                        }
                        else {
                            window.location = "/";
                        }
                    }
                }, "json");
            }
        }
    });
    //删除日志
    $('.js-content-delete').click(function (e) {
        var $this = $(this);
        var id = $this.attr("data-id");
        myAlert("删除后无法恢复，您确定要删除吗？", function () {
            closeLayer();;
            loading();
            $.post("/manager/content/delete", {
                id: id
            }, function (data) {
                closeLayer();;
                if (data.success) {
                    $this.parent().parent().fadeOut()
                }
                myMsg(data.msg);
            }, "json");
        });
    });
    //跳转到评论输入框
    $('.js-open-comment-btn').click(function () {
        $('.js-comment-input').focus();
    });
    //评论日志
    $('.js-post-comment-btn').click(function () {
        var $this = $(this);
        var id = $this.attr("data-id");
        var name = $this.attr("data-name");
        var email = $this.attr("data-email");
        var comment = $('.js-comment-input').val().trim();
        if (comment == "") {
            myMsg("评论内容为空");
        } else {
            loading();
            closeLayer();;
            $.post("/comment/add", {
                contentId: id,
                name: name,
                email: email,
                comment: comment
            }, function (data) {
                closeLayer();;
                myMsg(data.msg);
                if (data.success) {
                    location.reload();
                }
            }, "json");
        }
    });
    // 评论时间格式化：null/undefined/空/非日期一律返回 ''（绝不假 1970、绝不抛）。
    // 主渲染 loadComments() 与「加载更多」共用同一套，避免两套精度/行为漂移。
    function fmtCommentTime(v) {
        if (v == null || v === '') return '';
        var d = new Date(v);
        if (isNaN(d.getTime())) return '';
        return (typeof d.format === 'function') ? d.format('yyyy-MM-dd hh:mm:ss') : d.toLocaleString();
    }
    //更多评论
    $('.js-more-comment-btn').click(function () {
        var $this = $(this);
        var page = parseInt($this.attr("data-page"));
        var totalPage = parseInt($this.attr("data-totalPage"));
        var contentId = $this.attr("data-id");
        if (page >= totalPage) {
            myMsg("没有更多的评论了");
            return false;
        }
        $.get("/comment/all", {
            cententId: contentId,
            page: page + 1
        }, function (data) {
            var docs = data.docs || [];
            var html = "";
            var nextPage = data.page;
            var nextTotalPage = data.totalPage;
            $.each(docs, function (i, val) {
                // 与主渲染 loadComments() 同一套转义与同一套 .comment-item 结构：
                // userName 来自 User.realName（入库只 trim），comment 只净化正文，管不到用户名，
                // 裸拼 .html() 会让 <img onerror> 真执行。三个字段一律过 window.NL.esc。
                // 时间走 fmtCommentTime()：null/空/非法一律返回 ''，坏条目只少一个时间戳，
                // 绝不中断循环、绝不丢前面已拼好的合法条目。
                html += '<div class="comment-item"><div class="comment-item-head">';
                html += '<span class="comment-author">' + window.NL.esc(val.userName) + '</span>';
                html += '<time class="color-gray">' + window.NL.esc(fmtCommentTime(val.createTime)) + '</time>';
                html += '</div><div class="comment-item-body">' + window.NL.esc(val.comment) + '</div></div>';
            });
            // 成功后才推进 data-page；无更多页时隐藏「更多评论」
            if (nextTotalPage > nextPage) {
                $this.attr("data-page", nextPage);
            } else {
                $('.js-more-comment').addClass("hide");
            }
            // append 而非 .html(existing + html)：避免每次翻页把已渲染内容重新解析一遍
            $('.js-comment-panel').append(html);
        }, "json").fail(function () {
            // 仅在评论面板内渲染统一 error 态，独立 data-retry=more-comments：
            // 只重发当前 page+1（绝不调 loadComments(1)），失败不推进 data-page，保留已渲染评论
            var err = window.NL.state('error', {
                size: 'inline', title: '更多评论没读出来', text: '点此重试，文章内容不受影响', retry: 'more-comments'
            });
            $('.js-comment-panel').append(err);
        });
    });
    //评论触发登录
    $('.js-comment-input').focus(function () {
        if (sessionUser == null) {
            $(this).blur();
            $('.js-login-btn').click();
        }
    });
    //日志详情页面加载评论列表
    // 文章卡片链接形如 /content/detail?id=xxx（不带 view=contentDetail），
    // 因此同时以 .js-doc-id 判定详情页，否则评论区会永久停在骨架。
    if (url.indexOf("view=contentDetail") != -1 || $('.js-doc-id').length) {
        var docId = $('.js-doc-id').val();
        if (sessionUser != null && sessionUser._id != docId) {
            $('.js-post-comment-btn').prop("disabled", false);
            $('.js-comment-input').attr("placeholder", "请输入评论");
        }
        // 统一状态：骨架（模板里已放）→ 评论 / 空态 / 失败带重试；失败保留标题与已渲染内容
        function loadComments(reqPage) {
            $.get("/comment/all", {
                cententId: docId,
                page: reqPage
            }, function (data) {
                var docs = data.docs;
                if (docs != null && docs.length > 0) {
                    var html = "";
                    var page = data.page;
                    var totalPage = data.totalPage;
                    var total = data.total;
                    $.each(docs, function (i, val) {
                        html += '<div class="comment-item"><div class="comment-item-head">';
                        html += '<span class="comment-author">' + window.NL.esc(val.userName) + '</span>';
                        html += '<time class="color-gray">' + window.NL.esc(fmtCommentTime(val.createTime)) + '</time>';
                        html += '</div><div class="comment-item-body">' + window.NL.esc(val.comment) + '</div></div>';
                    });
                    var $title = $('.js-comment-title');
                    var baseTitle = $title.text().replace(/\s*\(\d+\)\s*$/, '');
                    $title.text(baseTitle + ' (' + total + ')');
                    if (totalPage > 1) {
                        $('.js-more-comment').removeClass("hide");
                        $('.js-more-comment-btn').attr("data-page", page);
                        $('.js-more-comment-btn').attr("data-totalPage", totalPage);
                        $('.js-more-comment-btn').attr("data-id", docId);
                    }
                    $('.js-comment-panel').html(html);
                } else {
                    // 空态交给统一组件，不再显示第二套「暂无评论」alert
                    $('.js-comment-panel').html(window.NL.state('empty', {
                        size: 'block', title: '还没有评论', text: '来写第一条'
                    }));
                }
            }, "json").fail(function () {
                var err = window.NL.state('error', {
                    size: 'block', title: '评论没读出来', text: '稍后重试，文章内容不受影响', retry: 'comments'
                });
                if ($('.js-comment-panel').find('.comment-item').length) {
                    $('.js-comment-panel').append(err);
                } else {
                    $('.js-comment-panel').html(err);
                }
            });
        }
        loadComments(1);
        $('.js-comment-panel').on('click', '.js-state-retry', function () {
            var retry = $(this).attr('data-retry');
            if (retry === 'comments') {
                $('.js-comment-panel').html(window.NL.state('loading', { size: 'block' }));
                loadComments(1);
            } else if (retry === 'more-comments') {
                // 只重发当前已记录的下一页，绝不回到第一页；失败不推进 data-page
                $('.js-more-comment-btn').trigger('click');
            }
        });

        //自适应内容宽度，宽度超过屏幕宽度-60设置为此宽度
        var maxWidth = window.screen.width - 60;
        $('.js-content *').each(function (i,val) {
            if($(val).width() > maxWidth){
                $(val).width(maxWidth);
            }
        });
    }
    var loginFlag = $('.js-login-flag').val();
    if (loginFlag == "true") {
        $('.js-login-btn').click();
    }
    $('.js-refresh').click(function () {
        location.reload();
    });
    //我发布的日志列表
    $('.js-my-content-menu').click(function () {
        if (sessionUser == null) {
            $('.js-login-btn').click();
        } else {
            window.location = '/content/user?page=1';
        }
    });
    $('.js-my-comment-menu').click(function () {
        if (sessionUser == null) {
            $('.js-login-btn').click();
        } else {
            $.get('/content/user?page=1');
        }
    });
    /* $('.js-category-content').mouseenter(function (e) {
     if (e.target == this) {
     $('.js-category-menu').addClass("showcategory");
     $('.js-category-content').focus();
     }
     });
     $('.js-category').mouseleave(function () {
     $('.js-category-menu').removeClass("showcategory");
     $('.js-category-content').blur();
     });*/
//    $('.js-menu-panel .bg-color').removeClass("bg-color");
    //回车自动极速搜索
    $('.js-search').on('keydown keyup focus click change', function (e) {
        var $this = $(this);
        var maxlength = parseInt($this.attr("maxlength"), 10);
        if ($this.val().length >= maxlength) {
            limitLength($this, maxlength);
        }
        $this.addClass("search-focus");
        var _word = $this.val().trim();
        var _searchUrl = "/content/search";
        if (e.keyCode == 13) {
            if (_word == "") {
                myMsg("请输入关键字");
                return false;
            }
            loading("开始搜索 \"" + _word + "\" 相关日志...");
            location.href = _searchUrl + "?word=" + _word + "&page=1";
        } else {
            if (_word == "") {
                $('.js-search-panel').html("").addClass("hide");
                $('.js-search-bar').removeClass("open");
                return;
            }
            suggest(_word, _searchUrl);
        }
    });
    // 搜索建议四态：骨架 / 结果 / 空态 / 失败带重试；回车跳转与 target="_blank" 保持不变
    function suggest(word, searchUrl) {
        var filterLi = '<li style="padding: 5px;"><input type="text" class="form-control js-search-auto" placeholder="精确定位" x-webkit-speech /></li>';
        $('.js-search-panel').html('<li>' + window.NL.state('loading') + '</li>').removeClass("hide");
        $('.js-search-bar').addClass("open");
        $.post(searchUrl, {"word": word}, function (data) {
            var docs = data.docs || [];
            var html = filterLi;
            var _id, _name, _url;
            if (docs.length > 0) {
                $.each(docs, function (i, tempDoc) {
                    _id = tempDoc._id, _name = tempDoc.name;
                    _url = "/content/detail?id=" + _id + "&view=contentDetail";
                    html += '<li><a href="' + _url + '"  class="l-option" target="_blank">' + window.NL.esc(_name) + '</a></li>';
                });
            } else {
                html += '<li>' + window.NL.state('empty', {
                    title: '没找到「' + word + '」', text: '换个词或按分类浏览',
                    actionHref: '/', actionText: '按分类浏览'
                }) + '</li>';
            }
            $('.js-search-panel').html(html).removeClass("hide");
            $('.js-search-bar').addClass("open");
        }, "json").fail(function () {
            $('.js-search-panel').html('<li>' + window.NL.state('error', {
                title: '搜索建议没加载出来', text: '按回车仍可直接搜索', retry: 'search'
            }) + '</li>').removeClass("hide");
            $('.js-search-bar').addClass("open");
        });
    }
    $('.js-search-panel').on('click', '.js-state-retry', function () {
        if ($(this).attr('data-retry') !== 'search') return;
        suggest($.trim($('.js-search').val()), "/content/search");
    });
    function searchState() {
        if ($.trim($('.js-search').val()) != "") {
            $('.js-search').addClass("search-focus");
        } else {
            $('.js-search').removeClass("search-focus");
        }
    }

    $('.js-search').blur(function () {
        searchState();
    });
    if (url.indexOf("/manager") == -1) {
        searchState();
    }
    $('.js-search-panel').delegate('.js-search-auto', 'keyup focus click change', function (e) {
        e.stopPropagation();
        var $this = $(this);
        var _val = $this.val().trim();
        if (_val != "") {
            $('.js-search-panel li').each(function () {
                _this = $(this).children("a:first");
                if (_this.text().toLowerCase().indexOf(_val.toLowerCase()) != -1) {//存在
                    _this.parent().removeClass("hide");
                } else {
                    _this.parent().addClass("hide");
                }
            });
        } else {
            $('.js-search-panel li').removeClass("hide");
        }
    });
    $('.js-qq-feedback').hover(function () {
        $(this).find("img").attr("src", "/images/qq-enable.jpg");
    }, function () {
        $(this).find("img").attr("src", "/images/qq-disable.png");
    });
    $('.js-add-log-name').bind('keyup change  focus blur', function () {
        var $this = $(this);
        var maxlength = parseInt($this.attr("maxlength"), 10);
        if ($this.val().length >= maxlength) {
            limitLength($this, maxlength);
        }
        $('.js-add-log-name-chars').html(canInput($this, maxlength));
    });
    $('.js-add-log-btn').click(function () {
        if (sessionUser == null) {
            $('.js-login-btn').click();
        } else {
            var name = $('.js-add-log-name').val().trim();
            var content = $('.js-editor').val();
            if (name === "") {
                myMsg("标题不能为空");
            } else if (content.trim() === "") {
                myMsg("内容不能为空");
            } else {
                loading();
                $.post("/manager/log/add", {
                    name: name,
                    content: content
                }, function (data) {
                    closeLayer();;
                    myMsg(data.msg);
                    if (data.success) {//success
                        window.location = "/manager/log?view=manager/log&page=1";
                    }
                }, "json");
            }
        }
    });
    $('.js-log-delete').click(function (e) {
        var $this = $(this);
        var id = $this.attr("data-id");
        myAlert("删除后无法恢复，您确定要删除吗？", function () {
            closeLayer();;
            loading();
            $.post("/manager/log/delete", {
                id: id
            }, function (data) {
                if (data.success) {
                    $this.parent().parent().fadeOut()
                }
                myMsg(data.msg);
            }, "json");
        });
    });
    $(".js-user-role").each(function (i, obj) {
        var role = $(this).attr("data-type");
        if (role == 0) {
            $(this).prop('checked', true);
        } else {
            $(this).prop('checked', false);
        }
        $(this).bootstrapSwitch({size: 'small', onColor: 'warning', offColor: 'info', onText: '管理员', offText: '用户'});
    });
    $(".js-user-role").on('switchChange.bootstrapSwitch', function (event, status) {
        var id = $(this).attr("data-id");
        console.log(status);
        $.post("/manager/user/update", {
            id: id,
            role: status ? 0 : 1
        }, function (data) {
        }, "json");
    });
    function switchUserEditPanel() {
        // 只切换编辑表单行：现在任意用户行都可点编辑，不再联动隐藏“当前用户”行
        $('.js-user-edit-panel').fadeToggle();
    }

    // 正在编辑的目标用户 id（默认当前用户；点其他用户的“编辑”时会被覆盖）
    var editingUserId = null;

    function fillUserEditForm(u) {
        $('input[name=userName]').val(u.userName || '');
        $('input[name=realName]').val(u.realName || '');
        $('input[name=email]').val(u.email || '');
        $('input[name=phone]').val(u.phone || '');
        $('input[name=password]').val('');// 密码框每次打开留空，避免误提交旧值
    }

    $('.js-user-edit').click(function () {
        editingUserId = $(this).attr('data-id');
        // 从所点链接的 data-* 上取源数据回填表单，避免依赖列顺序
        fillUserEditForm({
            userName: $(this).attr('data-user-name') || '',
            realName: $(this).attr('data-real-name') || '',
            email: $(this).attr('data-email') || '',
            phone: $(this).attr('data-phone') || ''
        });
        switchUserEditPanel();
    });
    $('.js-user-edit-cancel').click(function () {
        switchUserEditPanel();
    });
    $('.js-user-edit-save').click(function () {
        var id = editingUserId || sessionUser._id;
        var userName = $('input[name=userName]').val().trim();
        var realName = $('input[name=realName]').val().trim();
        var password = $('input[name=password]').val().trim();
        var email = $('input[name=email]').val().trim();
        var phone = $('input[name=phone]').val().trim();
        $.post("/manager/user/update", {
            id: id,
            userName: userName,
            realName: realName,
            password: password,
            email: email,
            phone: phone
        }, function (data) {
            if (data.result == true) {
//                switchUserEditPanel();
                location.reload();
            } else {
                myMsg(data.msg || data.result);
            }
        }, "json");
    });
    //网站配置
    $('.js-site-edit-save').click(function () {
        var data = $('form[name=siteForm]').serializeArray();
        loading();
        $.post("/manager/site/update", data, function (data) {
            if (data.success) {
                myMsg(data.msg);
                location.reload();
            } else {
                myMsg(data.msg);
            }
        }, "json");
    });
   
    // 旧四色皮肤块已移除：唯一的主题控制是 header.ejs 的 .theme-toggle（localStorage nl-theme + data-theme）
    if (url.indexOf("/manager") == -1) {//非管理端页面
        $.post("/log/count",{},function(data) {
            $('.js-log-count').text(data.count);
        },"json");

        //window._bd_share_config = {//百度分享
        //    "common": {
        //        "bdSnsKey": {"tsina": "NODELOG", "tqq": "NODELOG", "t163": "NODELOG", "tsohu": "NODELOG"},
        //        "bdText": document.title + "-NODELOG-" + location.href,
        //        "bdMini": "2",
        //        "bdMiniList": false,
        //        "bdPic": "",
        //        "bdStyle": "0",
        //        "bdSize": "16",
        //        "bdUrl": location.href
        //    },
        //    "slide": {
        //        "type": "slide",
        //        "bdImg": bdImg,
        //        "bdPos": "right",
        //        "bdTop": "100"
        //    }};
        //with (document)0[(getElementsByTagName('head')[0] || body).appendChild(createElement('script')).src = 'http://bdimg.share.baidu.com/static/api/js/share.js?v=89860593.js?cdnversion='+~(-new Date()/36e5)];
    }
    $('.js-attention-weixin').popover({trigger:'hover',container:'body',template:popverWeixinTempl()});
    $('.js-attention-weibo').popover({trigger:'hover',container:'body',template:popverWeiboTempl()});
    $('.js-attention-weixinweibo').popover({trigger:'hover',container:'body',template:popverWeixinWeiboTempl()});
    function popverWeixinTempl() {
        var template = '<div class="popover bg-gray fade"><div class="arrow"></div><div class="popover-content docker-right">' +
        '<table class="table"><tbody><tr><td><div class="heading text-center">' +
        '<i class="icon-weixin">&nbsp;</i>误码者微信</div><img src="/images/weixin.png" width="200" height="200"></td></tr></tbody></table></div></div>';
        return template;
    }
    function popverWeiboTempl() {
        var template = '<div class="popover bg-gray fade"><div class="arrow"></div><div class="popover-content docker-right">' +
        '<table class="table"><tbody><tr><td><div class="heading text-center">' +
        '<i class="icon-weibo">&nbsp;</i>误码者微博</div><img src="/images/weibo.png" width="200" height="200"></td></tr></tbody></table></div></div>';
        return template;
    }
    function popverWeixinWeiboTempl() {
        var template = '<div class="popover bg-gray fade"><div class="arrow"></div><div class="popover-content docker-right">' +
            '<table class="table"><tbody><tr><td><div class="heading text-center"><i class="icon-weixin">&nbsp;</i>误码者微信</div>' +
            '<img src="/images/weixin.png" width="200" height="200" /></td><td><div class="heading text-center">' +
            '<i class="icon-weibo">&nbsp;</i>误码者微博</div><img src="/images/weibo.png" width="200" height="200" />' +
            '</td></tr></tbody></table></div></div>';
        return template;
    }

    //按ESC键 关闭弹出层
    $(document).keydown(function(event){
        if(event.keyCode == 27){ //ESC
            if(layerIndex) {
                closeLayer();;
            }
        }
    });
    $('body').delegate('.layer-close-all','click',function () {
        layer.closeAll();
    })

    $.post("/link/list", {}, function (data) {
        if (data.success) {
            var _html = '';
            $.each(data.data, function (i, val) {
                if(i != 0){
                    _html += '&nbsp;&nbsp;|&nbsp;&nbsp;';
                }
                if(val.blank == 0){
                    _html +='<a href="'+val.url+'" target="_blank">';
                } else{
                    _html +='<a href="'+val.url+'">';
                }
                _html +=val.name;
                _html +='</a>';
            });
            $(".js-links-panel").append(_html);
        }
    }, "json");
});//end jquery

//返回顶部
var ScrollToTop = ScrollToTop || {
    setup: function () {

        //var a = $(window).height() / 4;
        var a = 50;
        $(window).scroll(function () {
            (window.innerWidth ? window.pageYOffset : document.documentElement.scrollTop) >= a ? $("#backToTop").removeClass("Offscreen") : $("#backToTop").addClass("Offscreen")
        });
        //tooltip提示
        $("#backToTop").click(function () {
            $("html, body").animate({scrollTop: "0px"}, 400);
            return false
        })
    }
};
$(document).ready(function(){
    ScrollToTop.setup();
});


//控制台输出
console.log('%cNODELOG\n%chttps://blog.jiangzi.xin\n%c联系方式: 18205939315(微信qq同)\n%c源码git@osc( http://gitee.com/nodelog/nodelog )\n ', 'color:#222; font-size: 25px;', 'color:#31b0d5; font-size: 18px;', 'color:#5cb85c;font-size: 18px;', 'color:#d9534f; font-size: 18px;');


