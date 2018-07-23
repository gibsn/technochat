var hold = "";

function blinkTitle(msg1, msg2, delay, isFocus, timeout) {
    if (isFocus == null) {
        isFocus = false;
    }
    if (timeout == null) {
        timeout = false;
    }
    if(timeout){
        setTimeout(blinkTitleStop, timeout);
    }
    document.title = msg1;
    if (isFocus == false) {
        hold = window.setInterval(function() {
            if (document.title == msg1) {
                document.title = msg2;
            } else {
                document.title = msg1;
            }
        }, delay);
    }
    if (isFocus == true) {
        var onPage = false;
        window.onfocus = function() {
            onPage = true;
        };
        // window.onblur = function() {
        //     onPage = false;
        // };
        hold = window.setInterval(function() {
            if (onPage == false) {
                if (document.title == msg1) {
                    document.title = msg2;
                } else {
                    document.title = msg1;
                }
            } else {
                document.title = msg1
            }
        }, delay);
    }
}

function blinkTitleStop() {
    clearInterval(hold);
}
