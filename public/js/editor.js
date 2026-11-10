// P0 Markdown 编辑器初始化（替换旧 bootstrap-wysiwyg contenteditable）
// 依赖：jQuery（require 或 manager 页脚已同步加载）、common.js（提供 myMsg）
$(function () {
    var $ta = $('#editor');
    if (!$ta.length) return; // 仅当页面存在编辑器时生效

    var $preview = $('.js-md-preview-body');
    var $previewWrap = $('.md-preview');
    var $previewBtn = $('.js-md-preview');

    function wrap(before, after, placeholder) {
        var ta = $ta[0];
        var s = ta.selectionStart, e = ta.selectionEnd;
        var val = ta.value;
        var sel = val.slice(s, e) || placeholder || '';
        ta.value = val.slice(0, s) + before + sel + after + val.slice(e);
        ta.focus();
        ta.selectionStart = s + before.length;
        ta.selectionEnd = s + before.length + sel.length;
        onInput();
    }

    function linePrefix(prefix) {
        var ta = $ta[0];
        var s = ta.selectionStart, e = ta.selectionEnd;
        var val = ta.value;
        var lineStart = val.lastIndexOf('\n', s - 1) + 1;
        ta.value = val.slice(0, lineStart) + prefix + val.slice(lineStart);
        ta.focus();
        ta.selectionStart = s + prefix.length;
        ta.selectionEnd = e + prefix.length;
        onInput();
    }

    $('.md-toolbar').on('click', '[data-md]', function () {
        var act = $(this).attr('data-md');
        switch (act) {
            case 'bold': wrap('**', '**', '加粗文字'); break;
            case 'italic': wrap('*', '*', '斜体文字'); break;
            case 'heading': linePrefix('## '); break;
            case 'quote': linePrefix('> '); break;
            case 'code': wrap('`', '`', '代码'); break;
            case 'ul': linePrefix('- '); break;
            case 'ol': linePrefix('1. '); break;
            case 'link': wrap('[', '](https://)', '链接文字'); break;
        }
    });

    // 本地草稿自动保存（按文章 id 区分）
    var draftKey = null;
    try {
        var dkId = $('.js-add-content-name').attr('data-id') || 'new';
        draftKey = 'nl-draft-' + dkId;
        var saved = localStorage.getItem(draftKey);
        if (saved && !$ta.val()) { $ta.val(saved); }
    } catch (e) {}

    function onInput() {
        if (!draftKey) return;
        try { localStorage.setItem(draftKey, $ta.val()); } catch (e) {}
    }
    $ta.on('input', onInput);

    // 图片：本地选择 -> base64 -> /api/upload -> 插入 ![](url)
    $('.js-md-img').on('click', function () { $('.js-md-file').click(); });
    $('.js-md-file').on('change', function () {
        var input = this;
        var file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { notify('图片过大（上限 5MB）'); input.value = ''; return; }
        var reader = new FileReader();
        reader.onload = function () {
            $.ajax({ url: '/api/upload', type: 'POST', data: { data: reader.result }, dataType: 'json' })
                .done(function (data) {
                    if (data && data.success) { wrap('![](', ')', data.url); }
                    else { notify((data && data.msg) || '上传失败'); }
                })
                .fail(function () { notify('上传失败，请检查网络'); });
        };
        reader.readAsDataURL(file);
        input.value = '';
    });

    // 实时预览：服务端 markdown 渲染，保证与展示一致
    $previewBtn.on('click', function () {
        if ($previewWrap.hasClass('hide')) {
            $.ajax({ url: '/api/preview', type: 'POST', data: { content: $ta.val() }, dataType: 'json' })
                .done(function (data) {
                    $preview.html((data && data.html) || '');
                    $previewWrap.removeClass('hide');
                    $ta.addClass('hide');
                    $previewBtn.html('<i class="icon-eye-close"></i> 编辑');
                });
        } else {
            $previewWrap.addClass('hide');
            $ta.removeClass('hide');
            $previewBtn.html('<i class="icon-eye-open"></i> 预览');
        }
    });

    function notify(msg) {
        if (typeof myMsg === 'function') myMsg(msg);
        else alert(msg);
    }
});
