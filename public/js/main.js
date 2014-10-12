require.config({
    baseUrl: "/js",
    paths: {
        "jquery": "jquery-1.10.2.min",
        "bootstrap": "bootstrap-2.3.1.min",
        "pin": "jquery.pin",
        "layer": "layer.min",
        "hotkeys": "external/jquery.hotkeys",
        "prettify": "external/google-code-prettify/prettify",
        "switch": "bootstrap-switch.min",
        "wysiwyg": "bootstrap-wysiwyg"
    },
    shim: {
        'pin': {
            deps: ['jquery']
        },
        'bootstrap': {
            deps: ['jquery']
        },
        'wysiwyg': {
            deps: ['bootstrap']
        },
        'layer': {
            deps: ['jquery']
        },
        'gotoTop': {
            deps: ['jquery']
        },
        'hotkeys': {
            deps: ['jquery']
        },
        'common': {
            deps: ['jquery','bootstrap','layer','pin']
        },
        'editor': {
            deps: ['jquery','bootstrap','hotkeys','prettify','wysiwyg','common']
        }
    }
});
require(['editor']);

