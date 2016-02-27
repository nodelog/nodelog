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
