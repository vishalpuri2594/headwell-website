(function () {
    "use strict";

    // The only server this page talks to: HeadWell's public API (its address is already inside every installed app).
    // It calls two routes, /auth/forgot-password and /auth/reset-password. Nothing is stored in the browser.
    var API = "https://headwellbe-prod-production.up.railway.app/api/v1";
    var RESEND_SECONDS = 60;
    var REQUEST_TIMEOUT_MS = 20000;

    // Never run inside another site's frame (a meta Content-Security-Policy cannot set frame-ancestors).
    if (window.top !== window.self) {
        document.documentElement.style.display = "none";
        return;
    }

    // The wording is the app's own (and the server's, for a wrong code).
    var TEXT = {
        emailTitle: "Forgot your password?",
        emailSubtitle: "Enter the email you signed up with and we'll send you a 6-digit code.",
        codeTitle: "Check your email",
        doneTitle: "Password changed",
        doneSubtitle: "You can now sign in to the HeadWell app with your email and your new password. Everything you logged is still there.",
        badEmail: "Please enter a valid email address.",
        newCode: "We sent a new code. Use the newest email: older codes no longer work.",
        rejected: "That code is incorrect or has expired. Check the newest email we sent you, or ask for a new code.",
        tooShort: "That password is too short. Please use at least 8 characters.",
        network: "We couldn't reach HeadWell. Check your connection and try again.",
        server: "Something went wrong on our side. Please try again in a few minutes."
    };

    // The same five rules as the app. (The server only insists on 8 characters.)
    var RULES = [
        function (p) { return p.length >= 8; },
        function (p) { return /\p{Lu}/u.test(p); },
        function (p) { return /\p{Ll}/u.test(p); },
        function (p) { return /\p{Nd}/u.test(p); },
        function (p) { return /[^\p{L}\p{N}]/u.test(p); }
    ];

    function el(id) { return document.getElementById(id); }

    var requestForm = el("request-form");
    var resetForm = el("reset-form");
    var emailInput = el("email");
    var codeInput = el("code");
    var passwordInput = el("password");
    var confirmInput = el("confirm");
    var requestBtn = el("request-btn");
    var resetBtn = el("reset-btn");
    var resendBtn = el("resend");
    var changeBtn = el("change-email");
    var message = el("message");
    var messageText = el("message-text");
    var messageUse = el("message-use");
    var heroIcon = el("hero-icon");
    var heroUse = el("hero-use");
    var title = el("title");
    var subtitle = el("subtitle");
    var mismatch = el("mismatch");
    var strength = el("strength");
    var strengthLabel = el("strength-label");
    var barFill = el("bar-fill");
    var ruleItems = Array.prototype.slice.call(document.querySelectorAll("#rules li"));
    var eyes = Array.prototype.slice.call(document.querySelectorAll(".eye"));

    var busy = false;
    var timer = null;
    var secondsLeft = 0;
    var address = "";

    // ---- what is on screen -------------------------------------------------------------------------------------

    function setHero(step) {
        heroUse.setAttribute("href", step === "code" ? "#i-mail" : step === "done" ? "#i-check-circle" : "#i-lock");
        heroIcon.className = "hero-icon" + (step === "done" ? " ok" : "");
        title.textContent = step === "code" ? TEXT.codeTitle : step === "done" ? TEXT.doneTitle : TEXT.emailTitle;
        subtitle.textContent = "";
        if (step === "email") {
            subtitle.textContent = TEXT.emailSubtitle;
        } else if (step === "done") {
            subtitle.textContent = TEXT.doneSubtitle;
        } else {
            var who = document.createElement("strong");
            who.textContent = address;
            subtitle.appendChild(document.createTextNode("If an account exists for "));
            subtitle.appendChild(who);
            subtitle.appendChild(document.createTextNode(", we sent a 6-digit code. It works for 15 minutes. Check your spam folder too."));
        }
    }

    function goTo(step) {
        document.body.className = step === "done" ? "done" : "";
        requestForm.hidden = step !== "email";
        resetForm.hidden = step !== "code";
        setHero(step);
        if (step === "code") { codeInput.focus(); }
        else if (step === "done") { title.focus(); }
        else { emailInput.focus(); }
    }

    function banner(kind, text) {
        if (!text) {
            message.hidden = true;
            messageText.textContent = "";
            return;
        }
        message.className = "banner" + (kind === "error" ? " error" : "");
        message.setAttribute("role", kind === "error" ? "alert" : "status");
        messageUse.setAttribute("href", kind === "error" ? "#i-warn" : "#i-check-circle");
        messageText.textContent = text;
        message.hidden = false;
    }

    // ---- what the buttons may do -------------------------------------------------------------------------------

    function passwordOk(p) {
        return p.length <= 200 && RULES.every(function (rule) { return rule(p); });
    }

    function canSend() {
        return !busy && emailInput.value.trim().length > 0;
    }

    function canReset() {
        return !busy && /^[0-9]{6}$/.test(codeInput.value) && passwordOk(passwordInput.value) && passwordInput.value === confirmInput.value;
    }

    function clock(seconds) {
        var s = seconds % 60;
        return Math.floor(seconds / 60) + ":" + (s < 10 ? "0" : "") + s;
    }

    function renderResend() {
        resendBtn.textContent = secondsLeft > 0 ? "Resend code in " + clock(secondsLeft) : "Resend code";
        resendBtn.disabled = busy || secondsLeft > 0;
    }

    function refresh() {
        requestBtn.disabled = !canSend();
        resetBtn.disabled = !canReset();
        renderResend();
    }

    function setBusy(on, button) {
        busy = on;
        if (button === requestBtn) { requestBtn.textContent = on ? "Please wait…" : "Send Code"; }
        if (button === resetBtn) { resetBtn.textContent = on ? "Please wait…" : "Reset Password"; }
        refresh();
    }

    function stopCooldown() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    function startCooldown() {
        stopCooldown();
        secondsLeft = RESEND_SECONDS;
        renderResend();
        timer = setInterval(function () {
            secondsLeft -= 1;
            if (secondsLeft <= 0) { secondsLeft = 0; stopCooldown(); }
            renderResend();
        }, 1000);
    }

    // ---- the password: strength bar, the five rules, the match note ----------------------------------------------

    function updatePasswordUi() {
        var p = passwordInput.value;
        var met = RULES.map(function (rule) { return rule(p); });
        ruleItems.forEach(function (item, i) {
            item.className = met[i] ? "met" : "";
            item.querySelector("use").setAttribute("href", met[i] ? "#i-check-circle" : "#i-circle");
            item.lastElementChild.textContent = met[i] ? " (met)" : " (not met)";
        });
        var score = met.filter(Boolean).length;
        var level = score <= 2 ? "weak" : score <= 4 ? "fair" : "strong";
        strength.hidden = p.length === 0;
        barFill.className = "bar-fill " + level;
        strengthLabel.className = level;
        strengthLabel.textContent = level.charAt(0).toUpperCase() + level.slice(1);
        mismatch.hidden = !(confirmInput.value.length > 0 && confirmInput.value !== p);
        refresh();
    }

    function setShown(on) {
        passwordInput.type = on ? "text" : "password";
        confirmInput.type = on ? "text" : "password";
        eyes.forEach(function (button) {
            button.setAttribute("aria-label", on ? "Hide password" : "Show password");
            button.setAttribute("aria-pressed", on ? "true" : "false");
            button.querySelector("use").setAttribute("href", on ? "#i-eye-off" : "#i-eye");
        });
    }

    function wipe() {
        codeInput.value = "";
        passwordInput.value = "";
        confirmInput.value = "";
        setShown(false);
        updatePasswordUi();
    }

    // ---- talking to the server -------------------------------------------------------------------------------------

    function post(path, body) {
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var timeout = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
        return fetch(API + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            mode: "cors",
            credentials: "omit",
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller ? controller.signal : undefined
        }).then(function (response) {
            return response.status;
        }, function () {
            return 0;
        }).then(function (status) {
            if (timeout) { clearTimeout(timeout); }
            return status;
        });
    }

    function sendCode(isResend) {
        if (busy) { return; }
        setBusy(true, isResend ? resendBtn : requestBtn);
        post("/auth/forgot-password", { email: address }).then(function (status) {
            setBusy(false, isResend ? resendBtn : requestBtn);
            if (status === 200) {
                if (isResend) {
                    banner("ok", TEXT.newCode);
                    codeInput.focus();
                } else {
                    banner();
                    goTo("code");
                }
                startCooldown();
            } else if (status === 400) {
                goTo("email");
                banner("error", TEXT.badEmail);
            } else {
                banner("error", status === 0 ? TEXT.network : TEXT.server);
            }
            refresh();
        });
    }

    // ---- events ----------------------------------------------------------------------------------------------------

    requestForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy) { return; }
        var value = emailInput.value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || value.length > 254) {
            banner("error", TEXT.badEmail);
            emailInput.focus();
            return;
        }
        address = value;
        banner();
        sendCode(false);
    });

    resetForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!canReset()) { return; }
        banner();
        setBusy(true, resetBtn);
        post("/auth/reset-password", { email: address, code: codeInput.value, newPassword: passwordInput.value }).then(function (status) {
            setBusy(false, resetBtn);
            if (status === 204) {
                stopCooldown();
                wipe();
                banner();
                goTo("done");
            } else if (status === 400) {
                banner("error", TEXT.rejected);
                codeInput.focus();
            } else if (status === 422) {
                banner("error", TEXT.tooShort);
            } else {
                banner("error", status === 0 ? TEXT.network : TEXT.server);
            }
        });
    });

    resendBtn.addEventListener("click", function () {
        banner();
        sendCode(true);
    });

    changeBtn.addEventListener("click", function () {
        stopCooldown();
        secondsLeft = 0;
        wipe();
        banner();
        goTo("email");
    });

    emailInput.addEventListener("input", refresh);
    emailInput.addEventListener("change", refresh);

    codeInput.addEventListener("input", function () {
        codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
        refresh();
    });

    passwordInput.addEventListener("input", updatePasswordUi);
    confirmInput.addEventListener("input", updatePasswordUi);

    eyes.forEach(function (button) {
        button.addEventListener("click", function () {
            setShown(passwordInput.type === "password");
        });
    });

    setHero("email");
    updatePasswordUi();
}());
