/* ================================================================
   auth-sync.js  —  Google Sign-In + Cross-Device Data Sync
   ================================================================

   SETUP (one-time):
   1. Go to https://console.firebase.google.com  →  Create a project
   2. Build  →  Authentication  →  Sign-in method  →  Enable "Google"
   3. Build  →  Firestore Database  →  Create database  (start in test mode)
   4. Project Settings  →  General  →  Your apps  →  Add web app  →  Copy config
   5. Replace the FB_CONFIG object below with your config values
   6. Project Settings  →  Authentication  →  Settings  →  Authorized domains  →  Add your domain

   Firestore security rules (paste in Firestore > Rules):
   -------------------------------------------------------
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ================================================================ */
(function () {
  "use strict";

  /* ============ FIREBASE CONFIG ============ */
  var FB_CONFIG = {
  apiKey: "AIzaSyBfROwyzuM2gdRJ4kgEkldpXLm81HqfKUk",
  authDomain: "austrian-lifestyle.firebaseapp.com",
  projectId: "austrian-lifestyle",
  storageBucket: "austrian-lifestyle.firebasestorage.app",
  messagingSenderId: "720060203043",
  appId: "1:720060203043:web:b0dbde8ecd14edf53c7196"
  };

  /* ============ INTERNAL STATE ============ */
  var auth = null, db = null, provider = null;
  var currentUser = null;
  var _suppress   = false;
  var _timers     = {};
  var _ready      = false;
  var _callbacks  = [];

  /* ============ CROSS-TAB SYNC ============ */
  var _bc = null;
  try { _bc = new BroadcastChannel("auth-sync-channel"); } catch (_) {}
  var _AUTH_KEY = "al-auth-state";

  function broadcastAuthState(user) {
    var state = user
      ? { uid: user.uid, email: user.email || "", displayName: user.displayName || "", photoURL: user.photoURL || "" }
      : null;
    try { localStorage.setItem(_AUTH_KEY, JSON.stringify(state)); } catch (_) {}
    if (_bc) { try { _bc.postMessage({ type: "auth", state: state }); } catch (_) {} }
  }

  function applyAuthState(state) {
    if (state) {
      currentUser = state;
      currentUser.getIdToken = function () { return Promise.resolve(""); };
    } else {
      currentUser = null;
    }
    updateUI();
    notify();
  }

  function listenForCrossTabAuth() {
    if (_bc) {
      _bc.onmessage = function (e) {
        if (e.data && e.data.type === "auth") {
          applyAuthState(e.data.state);
        }
      };
    }
    window.addEventListener("storage", function (e) {
      if (e.key === _AUTH_KEY && e.newValue) {
        try { applyAuthState(JSON.parse(e.newValue)); } catch (_) {}
      }
    });
  }

  listenForCrossTabAuth();

  /* ============ DYNAMIC SCRIPT LOADER ============ */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[data-fb="' + src + '"]')) { res(); return; }
      var s = document.createElement("script");
      s.src = src;
      s.setAttribute("data-fb", src);
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  /* ============ INIT ============ */
  async function init() {
    if (FB_CONFIG.apiKey === "REPLACE_WITH_YOUR_API_KEY") {
      console.warn("[auth-sync] Firebase not configured. Open auth-sync.js and replace FB_CONFIG. Sync disabled.");
      /* Even without Firebase, check localStorage for cross-tab auth state */
      try {
        var cached = JSON.parse(localStorage.getItem(_AUTH_KEY));
        if (cached) applyAuthState(cached);
      } catch (_) {}
      _ready = true; notify(); return;
    }
    try {
      await loadScript("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js");

      if (typeof firebase === "undefined" || !firebase.initializeApp) throw new Error("Firebase SDK missing");

      firebase.initializeApp(FB_CONFIG);
      auth     = firebase.auth();
      db       = firebase.firestore();
      provider = new firebase.auth.GoogleAuthProvider();

      db.enablePersistence({ synchronizeTabs: true }).catch(function () {});

      setupSync();

      auth.onAuthStateChanged(function (user) {
        currentUser = user;
        broadcastAuthState(user);
        if (user) pullFromCloud();
        updateUI();
        notify();
      });

      _ready = true;
      notify();
    } catch (e) {
      console.warn("[auth-sync] Init failed:", e);
      _ready = true;
      notify();
    }
  }

  function notify() {
    _callbacks.forEach(function (cb) { try { cb(currentUser); } catch (_) {} });
  }

  /* ============ AUTH ============ */
  function signIn() {
    if (!auth) { alert("Sign-in unavailable — check your internet connection."); return; }
    auth.signInWithPopup(provider).catch(function (e) {
      if (e.code !== "auth/popup-closed-by-user") alert("Sign-in failed: " + e.message);
    });
  }
  function signOutFn() {
    if (auth) auth.signOut();
    broadcastAuthState(null);
  }

  /* ============ localStorage INTERCEPTOR ============ */
  var _g = localStorage.getItem.bind(localStorage);
  var _s = localStorage.setItem.bind(localStorage);
  var _r = localStorage.removeItem.bind(localStorage);

  function setupSync() {
    localStorage.setItem = function (k, v) {
      _s(k, v);
      if (!_suppress && currentUser && db) debouncedWrite(k, v);
    };
    localStorage.removeItem = function (k) {
      _r(k);
      if (!_suppress && currentUser && db) debouncedDelete(k);
    };
  }

  function debouncedWrite(key, value) {
    clearTimeout(_timers["w" + key]);
    _timers["w" + key] = setTimeout(function () {
      if (!currentUser || !db) return;
      db.doc("users/" + currentUser.uid + "/data/" + key).set({
        value: value,
        ts: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function (e) { console.warn("[auth-sync] write failed:", key, e); });
    }, 800);
  }

  function debouncedDelete(key) {
    clearTimeout(_timers["d" + key]);
    _timers["d" + key] = setTimeout(function () {
      if (!currentUser || !db) return;
      db.doc("users/" + currentUser.uid + "/data/" + key).delete().catch(function () {});
    }, 800);
  }

  /* ============ CLOUD PULL ============ */
  async function pullFromCloud() {
    if (!currentUser || !db) return;
    _suppress = true;
    var changed = 0;
    try {
      var snap = await db.collection("users/" + currentUser.uid + "/data").get();
      snap.forEach(function (doc) {
        var d = doc.data();
        if (d && d.value !== undefined) {
          var old = _g(doc.id);
          _s(doc.id, d.value);
          if (old === null || old !== d.value) changed++;
        }
      });
    } catch (e) {
      console.warn("[auth-sync] pull failed:", e);
    }
    _suppress = false;
    if (changed > 0) {
      showOverlay();
      setTimeout(function () { location.reload(); }, 600);
    }
  }

  function showOverlay() {
    var el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--bg,#fafbfd);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:Inter,sans-serif;";
    el.innerHTML = '<div style="width:36px;height:36px;border:3px solid var(--border,#e4e7f1);border-top-color:var(--accent,#2d5bff);border-radius:50%;animation:_asp .8s linear infinite;"></div>' +
      '<div style="font-size:14px;font-weight:600;color:var(--sub,#6b7194);">Syncing your data\u2026</div>' +
      '<style>@keyframes _asp{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }

  /* ============ AUTH UI ============ */
  function updateUI() {
    document.querySelectorAll(".auth-area").forEach(function (el) {
      if (currentUser) {
        var nm = currentUser.displayName || currentUser.email || "";
        if (nm.length > 18) nm = nm.substring(0, 18) + "\u2026";
        el.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<img src="' + (currentUser.photoURL || "") + '" onerror="this.style.display=\'none\'" ' +
            'style="width:30px;height:30px;border-radius:50%;border:2px solid var(--border);object-fit:cover;" alt="">' +
            '<span class="auth-name" style="font-size:11.5px;font-weight:600;color:var(--text);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(nm) + "</span>" +
            '<button onclick="AuthSync.signOut()" style="padding:5px 10px;font-size:11px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600;transition:.2s;">Sign Out</button>' +
          "</div>";
      } else {
        el.innerHTML =
          '<button onclick="AuthSync.signIn()" style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:12px;font-weight:600;font-family:Inter,sans-serif;transition:.2s;white-space:nowrap;" ' +
          'onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
            '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>' +
            "Sign in</button>";
      }
    });
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  /* ============ INJECT GLOBAL STYLES ============ */
  (function () {
    var s = document.createElement("style");
    s.textContent =
      ".auth-area{display:flex;align-items:center}" +
      ".auth-area img{object-fit:cover}" +
      ".auth-area button{transition:.2s}" +
      ".auth-area button:hover{opacity:.85}" +
      "@media(max-width:500px){.auth-area .auth-name{display:none!important}}";
    document.head.appendChild(s);
  })();

  /* ============ EXPOSE API ============ */
  window.AuthSync = {
    signIn:  signIn,
    signOut: signOutFn,
    getUser: function () { return currentUser; },
    onAuth:  function (cb) { _callbacks.push(cb); if (_ready) cb(currentUser); },
    isReady: function () { return _ready; }
  };

  /* ============ AUTO-INIT ============ */
  init();
})();
