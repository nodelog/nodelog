//require 主要文件，所有其他js文件由此文件配置加载和设置依赖顺序
require.config({
//    base 路径
    baseUrl: "/js",
    //js文件别名
    paths: {
        "jquery": "jquery-1.10.2.min",
        "cookie": "jquery.cookie",
        "bootstrap": "bootstrap",
        "layer": "layer.min",
        "hotkeys": "external/jquery.hotkeys",
        "prettify": "external/google-code-prettify/prettify",
        "switch": "bootstrap-switch.min",
        "wysiwyg": "bootstrap-wysiwyg",
        "responsive": "responsive-nav.min"//bs自适应导航
    },
//    依赖加载
    shim: {
        'bootstrap': {
            deps: ['jquery']
        },
        'wysiwyg': {
            deps: ['bootstrap']
        },
        'layer': {
            deps: ['jquery']
        },
        'hotkeys': {
            deps: ['jquery']
        },
        'cookie': {
            deps: ['jquery']
        },
        'backtop': {
            deps: ['jquery']
        },
        'common': {
            deps: ['jquery','cookie','bootstrap','layer','backtop']
        },
        'editor': {
            deps: ['jquery','bootstrap','hotkeys','prettify','wysiwyg','common']
        }
    }
});
//require 最后一个依赖，则按顺序加载js文件
require(['editor']);

