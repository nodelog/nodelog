var index = 0;
function myMsg(_msg, _height, index) {
    if (typeof(_height) == "undefined") {
        _height = '100px';
    }
    $.layer({
        shade: [0],
        title: false,
        closeBtn: [1, true],
        time: 2,
        offset: [_height, '50%'],
        dialog: {
            btns: 0,
            type: -1,
            msg: _msg
        },
        end: function () {
            parent.layer.close(index);
        }
    });
}
function myAlert(_msg, callback) {
    index = $.layer({
        time: 0,
        title: "系统提示",
        closeBtn: [0, true],
        border: [5, 0.3, '#e5e5e5'],
        shade: [0.3, '#000'],
        shift: 'top',
        offset: ['300px', '50%'],
        btn: ['确定', '取消'],
        dialog: {
            btns: 2,
            type: -1,
            msg: _msg,
            yes: function (index) {
                layer.close(index);
                callback();
            },
            no: function (index) {
                layer.close(index);
                return false;
            }
        }
    });
}
function myPage(title, area, html, callback) {
    index = $.layer({
        type: 1,
        title: title,
        area: area,
        border: [5, 0.3, '#e5e5e5'],
        shade: [0.3, '#000'],
        shift: 'top',
        page: {
            html: html
        }, success: function (obj) {
            callback(obj);
        }
    });
}
function loading(text) {
    if (typeof(text) == "undefined") {
        text = "加载中...";
    }
    index = layer.load(text);
}
function limitLength(select, length) {
    if (select.val().length >= length) {
        select.val(select.val().substring(0, length));
    }
}
function canInput(select, length) {
    var _size = select.val().length;
    return length - _size;
}
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
$(function () {
    var url = location.href;
//    var current_menu = $('.js-current-menu').val();
//    if (current_menu && $('.' + current_menu).length > 0) {
//        $('.current-menu').removeClass("current-menu");
//        $('.' + current_menu).addClass("current-menu");
//    } else {
//        $('.js-home-menu').addClass("current-menu");
//    }
    var sessionUser;
    $.ajax({
        url: "/session",
        dataType: "json",
        async: false,
        success: function (data) {
            sessionUser = data.user;
        }
    });
    if (url.indexOf("/manager") == -1) {
        $.get("/category/all",
            function (data) {
                var docs = data.docs;
                var html = '<li style="padding: 5px;"><input type="text" class="form-control js-category-auto" placeholder="筛选" autofocus x-webkit-speech></li>';
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
                if (url.indexOf("content/addPage") != -1) {
                    $('.js-category-value').html(_addHtml);
                    if (sessionUser == null) {
                        $('.js-login-btn').click();
                    }
                    $(window).bind('beforeunload', function () {
                        return '您输入的内容尚未保存，确定离开此页面吗？';
                    });
                }
                if (url.indexOf("view=editContent") != -1) {
                    $('.js-editor').html($('.js-content-hide').html());
                    $('.js-category-value').html(_editHtml);
                    if (sessionUser == null) {
                        $('.js-login-btn').click();
                    }
                    $(window).bind('beforeunload', function () {
                        return '您输入的内容尚未保存，确定离开此页面吗？';
                    });
                }
            }, "json");
    }
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
            $.post("/user/login", {
                userName: userName,
                password: password
            }, function (data) {
                var result = data.success;

                if (result) {//success
                    layer.close(index);
                    myMsg(data.msg);
                    loading();
                    $(window).unbind('beforeunload');
                    location.reload();
                } else {
                    myMsg(data.msg);
                }
            }, "json");
        }
    });
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
            layer.close(index);
            loading();
            $.post("/user/reg", {
                userName: userName,
                password: password,
                password2: password2
            }, function (data) {
                var msg = data.msg;
                layer.close(index);
                myMsg(data.msg);
            }, "json");
        }
    });
    $('.js-body').delegate('.js-logout-btn', 'click', function () {
        myAlert("您确定退出系统吗？", function () {
            layer.close(index);
            loading();
            $.get("/user/logout", {}, function (data) {
                layer.close(index);
                $(window).unbind('beforeunload');
                location.reload();
            }, "json");
        })
    });
    $('.js-user-delete').click(function (e) {
        var $this = $(this);
        var id = $this.attr("data-id");
        myAlert("删除后无法恢复，您确定要删除吗？", function () {
            layer.close(index);
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
    var addCategoryHtml = $('.js-add-category-panel').html();
    $('.js-add-category-panel').html("");
    $('.js-add-category').click(function () {
        myPage('添加分类', ['310px', '160px'], addCategoryHtml, function (obj) {
            $('.js-category-name').focus();
        });
    });
    $('.js-body').delegate('.js-save-category', 'click', function () {
        var name = $('.js-category-name').val().trim();
        var id = $('.js-category-name').attr("data-id");
        if (name == "") {
            myMsg("分类名称不能为空");
        } else if (!id) {//add
            $.post("/manager/category/add", {
                name: name
            }, function (data) {
                var result = data.success;
                var msg = data.msg;
                if (result) {//success
                    layer.close(index);
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
                    layer.close(index);
                    $('.js-modify-category-current').text(name);
                }
                myMsg(data.msg);
            }, "json");
        }
    });
    $('.js-category-delete').click(function (e) {
        var $this = $(this);
        var id = $this.attr("data-id");
        myAlert("删除后无法恢复，您确定要删除此分类吗？", function () {
            layer.close(index);
            loading();
            $.post("/manager/category/delete", {
                id: id
            }, function (data) {
                layer.close(index);
                if (data.success) {
                    $this.parent().parent().fadeOut();
                }
                myMsg(data.msg);
            }, "json");

        })
    });
    $('.js-modify-category').click(function () {
        $('.js-modify-category-current').removeClass("js-modify-category-current");
        var $this = $(this);
        var value = $this.text();
        var id = $this.attr("data-id");
        myPage('修改分类', ['310px', '160px'], addCategoryHtml, function (obj) {
            $('.js-category-name').val(value);
            $('.js-category-name').attr("data-id", id);
            $('.js-category-name').focus();
            $('.js-save-category').text("修改");
            $this.addClass("js-modify-category-current");
        });
    });
    $('.js-add-content-name').bind('keyup change  focus blur', function () {
        var $this = $(this);
        var maxlength = parseInt($this.attr("maxlength"), 10);
        if ($this.val().length >= maxlength) {
            limitLength($this, maxlength);
        }
        $('.js-content-name-chars').html(canInput($this, maxlength));
    });
    $('.js-save-content ').click(function () {
        if (sessionUser == null) {
            $('.js-login-btn').click();
        } else {
            var name = $('.js-add-content-name').val().trim();
            var oldName = $('.js-add-content-name').attr("data-name");
            var id = $('.js-add-content-name').attr("data-id");
            var content = $('.js-editor').html();
            var category = $('.js-category-value').val();
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
                    category: category,
                    oldName: oldName
                }, function (data) {
                    layer.close(index);
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
    $('.js-content-delete').click(function (e) {
        var $this = $(this);
        var id = $this.attr("data-id");
        myAlert("删除后无法恢复，您确定要删除吗？", function () {
            layer.close(index);
            loading();
            $.post("/manager/content/delete", {
                id: id
            }, function (data) {
                layer.close(index);
                if (data.success) {
                    $this.parent().parent().fadeOut()
                }
                myMsg(data.msg);
            }, "json");
        });
    });
    $(window).bind('scroll resize', function () {
        if ($(window).scrollTop() > 50) {
            $(".js-goto-top").show();
        } else {
            $(".js-goto-top").hide();
        }
    });
    $(window).scroll();
    $(".js-goto-top").on("click", function () {
        $('body,html').animate({scrollTop: 0}, 500);
        return false;
    });
    $('.js-open-comment-btn').click(function () {
        $('.js-comment-input').focus();
    });
    $('.js-post-comment-btn').click(function () {
        var $this = $(this);
        var id = $this.attr("data-id");
        var comment = $('.js-comment-input').val().trim();
        if (comment == "") {
            myMsg("评论内容为空");
        } else {
            loading();
            layer.close(index);
            $.post("/comment/add", {
                contentId: id,
                comment: comment
            }, function (data) {
                layer.close(index);
                myMsg(data.msg);
                if (data.success) {
                    location.reload();
                }
            }, "json");
        }
    });
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
            var docs = data.docs;
            var html = "";
            page = data.page;
            totalPage = data.totalPage;
            var total = data.total;
            $.each(docs, function (i, val) {
                html += '<a class="list-group-item"><label>' + val.userName + ':&nbsp;</label>';
                html += '<span class="color-gray">' + new Date(val.createTime.toLocaleString()).format() + '</span>';
                html += '<div>' + val.comment + '</div></a>';
            });
            if (totalPage > page) {
                $this.attr("data-page", page);
            } else {
                $('.js-more-comment').addClass("hide");
            }
            $('.js-comment-panel').html($('.js-comment-panel').html() + html);
        }, "json");
    });
    $('.js-comment-input').focus(function () {
        if (sessionUser == null) {
            $(this).blur();
            $('.js-login-btn').click();
        }
    });
    if (url.indexOf("view=contentDetail") != -1) {
        var docId = $('.js-doc-id').val();
        if (sessionUser != null && sessionUser._id != docId) {
            $('.js-post-comment-btn').prop("disabled", false);
            $('.js-comment-input').attr("placeholder", "请输入评论");
        }
        $.get("/comment/all", {
            cententId: docId,
            page: 1
        }, function (data) {
            var docs = data.docs;
            if (docs != null) {
                var html = "";
                var page = data.page;
                var totalPage = data.totalPage;
                var total = data.total;
                $.each(docs, function (i, val) {
                    html += '<a class="list-group-item"><label>' + val.userName + ':&nbsp;</label>';
                    html += '<span class="color-gray">' + new Date(val.createTime.toLocaleString()).format() + '</span>';
                    html += '<div>' + val.comment + '</div></a>';
                });
                var d = new Date();
                var n = d.toLocaleDateString();
                $('.js-comment-title').html($('.js-comment-title').html() + " (" + total + ")");
                if (totalPage > 1) {
                    $('.js-more-comment').removeClass("hide");
                    $('.js-more-comment-btn').attr("data-page", page);
                    $('.js-more-comment-btn').attr("data-totalPage", totalPage);
                    $('.js-more-comment-btn').attr("data-id", docId);
                }
                $('.js-comment-panel').html(html);
            } else {
                $('.js-all-comment').removeClass("hide");
                $('.js-comment-panel').html("");
            }
        }, "json");
    }
    var loginFlag = $('.js-login-flag').val();
    if (loginFlag == "true") {
        $('.js-login-btn').click();
    }
    $('.js-refresh').click(function () {
        location.reload();
    });
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
    //回车搜索
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
            var _html = '<li style="padding: 5px;"><input type="text" class="form-control js-search-auto" placeholder="筛选" x-webkit-speech /></li>';
            if (_word != "") {
                $.post(_searchUrl, {"word": _word}, function (data) {
                    var docs = data.docs;
                    var _id, _name, _url;
                    if (docs.length > 0) {
                        $.each(docs, function (i, tempDoc) {
                            _id = tempDoc._id, _name = tempDoc.name;
                            _url = "/content/detail?id=" + _id + "&view=contentDetail";
                            _html += '<li><a href="' + _url + '"  class="l-option" target="_blank">' + _name + '</a></li>';
                        });
                    } else {
                        _html = '<li style="padding: 5px;"><input type="text" class="form-control js-search-auto" value="没有要找的日志" /></li>';
                    }
                    $('.js-search-panel').html(_html).removeClass("hide");
                    $('.js-search-bar').addClass("open");
                }, "json");
            } else {
                $('.js-search-panel').html("").addClass("hide");
            }
        }
    });
    function searchState() {
        if ($('.js-search').val().trim() != "") {
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
            var content = $('.js-editor').html();
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
                    layer.close(index);
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
            layer.close(index);
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
        $('.js-current-user').fadeToggle();
        $('.js-user-edit-panel').fadeToggle();
    }

    $('.js-user-edit').click(function () {
        switchUserEditPanel();
    });
    $('.js-user-edit-cancel').click(function () {
        switchUserEditPanel();
    });
    $('.js-user-edit-save').click(function () {
        var id = sessionUser._id;
        var userName = $('input[name=userName]').val().trim();
        var realName = $('input[name=realName]').val().trim();
        var password = $('input[name=password]').val().trim();
        $.post("/manager/user/update", {
            id: id,
            userName: userName,
            realName: realName,
            password: password
        }, function (data) {
            if (data.result == true) {
//                switchUserEditPanel();
                location.reload();
            } else {
                myMsg(data.result);
            }
        }, "json");
    });
    var theme= $.cookie('style-theme');
    var bdImg;//黑色
    console.log(theme);
    if (theme) {
        $(".js-theme[data-theme='"+theme+"'] a i").addClass("glyphicon glyphicon-ok");
        bdImg = $(".js-theme[data-theme='"+theme+"']").attr("data-bdimg");
    } else {
        $(".js-theme[data-theme='style-black'] a i").addClass("glyphicon glyphicon-ok");
        bdImg = $(".js-theme[data-theme='style-black']").attr("data-bdimg");
    }
    $('.js-theme').click(function(){
        $.cookie('style-theme', $(this).attr("data-theme"), {expires: 30, path:"/"});
        location.reload();
    });
    if (url.indexOf("/manager") == -1) {//非管理端页面
        $.post("/log/count",{},function(data) {
            $('.js-log-count').text(data.count);
        },"json");

        window._bd_share_config = {//百度分享
            "common": {
                "bdSnsKey": {"tsina": "NODELOG", "tqq": "NODELOG", "t163": "NODELOG", "tsohu": "NODELOG"},
                "bdText": document.title + "-NODELOG-" + location.href,
                "bdMini": "2",
                "bdMiniList": false,
                "bdPic": "",
                "bdStyle": "0",
                "bdSize": "16",
                "bdUrl": location.href
            },
            "slide": {
                "type": "slide",
                "bdImg": bdImg,
                "bdPos": "right",
                "bdTop": "100"
            }};
        with (document)0[(getElementsByTagName('head')[0] || body).appendChild(createElement('script')).src = 'http://bdimg.share.baidu.com/static/api/js/share.js?v=89860593.js?cdnversion='+~(-new Date()/36e5)];
    }
    $('#gotoTop').tooltip("hide");
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
            if(index) {
                layer.close(index);
            }
        }
    });

});

<!--bs自适应导航插件-->
var navigation = responsiveNav("#nav", { // Selector: The ID of the wrapper
    animate: true, // Boolean: 是否启动CSS过渡效果（transitions）， true 或 false
        transition: 400, // Integer: 过渡效果的执行速度，以毫秒（millisecond）为单位
        label: "Menu", // String: Label for the navigation toggle
        insert: "after", // String: Insert the toggle before or after the navigation
        customToggle: "", // Selector: Specify the ID of a custom toggle
        openPos: "relative", // String: Position of the opened nav, relative or static
        jsClass: "js", // String: 'JS enabled' class which is added to <html> el
        debug: false, // Boolean: Log debug messages to console, true 或 false
        init: function(){}, // Function: Init callback
    open: function(){}, // Function: Open callback
    close: function(){} // Function: Close callback
});

