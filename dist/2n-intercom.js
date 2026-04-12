/**
 * 2N Intercom Manager Card  v1.1.0
 *
 * Card config:
 *   type: custom:twon-intercom-card
 *   entity_prefix: "front_door"        # required
 *   title: "Front Door"                # optional
 *   show_camera: true                  # default true
 *   show_switches: true                # default true
 *   show_stats: true                   # default true
 *   show_users: true                   # default true — hides Users tab entirely
 *   show_add_user: true                # default true — hides + Add User button
 *   show_delete_user: true             # default true — hides delete buttons
 *   camera_refresh_interval: 5000      # ms, default 5000
 *   camera_entity: "camera.xxx"        # optional, auto-detected
 */

class TwoNIntercomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config       = {};
    this._hass         = null;
    this._view         = "dashboard";
    this._editingUser  = null;
    this._users        = [];
    this._switches     = [];
    this._cameraEntity = null;
    this._entryId      = null;
    this._cameraTimer  = null;
    this._domReady     = false;
    this._lastUserHash = "";
    this._lastSwHash   = "";
  }

  setConfig(config) {
    if (!config.entity_prefix) throw new Error("2N Intercom Card: entity_prefix is required");
    this._config = config;
  }

  // ── HA updates — NEVER rebuilds DOM, only patches changed parts ──────────

  set hass(hass) {
    this._hass = hass;
    this._syncEntities();

    if (!this._domReady) {
      this._buildDOM();
      this._domReady = true;
      this._startCameraTimer();
      return;
    }

    this._patchHeader();

    const swHash = this._swHash();
    if (swHash !== this._lastSwHash) {
      this._lastSwHash = swHash;
      this._patchSwitches();
    }

    const userHash = this._userHash();
    if (userHash !== this._lastUserHash) {
      this._lastUserHash = userHash;
      this._rebuildListArea();
    }
  }

  // ── Entity sync ──────────────────────────────────────────────────────────

  _syncEntities() {
    if (!this._hass) return;
    const prefix = (this._config.entity_prefix || "").toLowerCase().replace(/ /g, "_");
    const states = this._hass.states;
    const match  = (id) => prefix ? id.includes(prefix) : true;

    this._users = Object.entries(states)
      .filter(([id]) => id.startsWith("sensor.") && id.includes("user_") && !id.includes("user_count") && match(id))
      .map(([id, s]) => ({ entity_id: id, name: s.state, attributes: s.attributes, uuid: s.attributes.uuid }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this._switches = Object.entries(states)
      .filter(([id]) => id.startsWith("switch.") && id.includes("switch_") && match(id))
      .map(([id, s]) => ({ entity_id: id, name: s.attributes.friendly_name || id, state: s.state, attributes: s.attributes }));

    this._cameraEntity = this._config.camera_entity ||
      Object.keys(states).find(id => id.startsWith("camera.") && match(id)) || null;

    const cs = Object.entries(states).find(([id]) => id.startsWith("sensor.") && id.includes("user_count") && match(id));
    this._entryId = cs?.[1]?.attributes?.entry_id || null;
  }

  _userHash() { return this._users.map(u => u.uuid + u.name).join("|"); }
  _swHash()   { return this._switches.map(s => s.entity_id + s.state).join("|"); }

  _show(flag, def = true) {
    return this._config[flag] !== undefined ? !!this._config[flag] : def;
  }

  // ── Full DOM build (once) ────────────────────────────────────────────────

  _buildDOM() {
    const showCam   = this._show("show_camera");
    const showSw    = this._show("show_switches");
    const showUsers = this._show("show_users");
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card">
          <div id="card-header">${this._renderHeader()}</div>
          ${showUsers ? `<div id="card-nav">${this._renderNav()}</div>` : ""}
          ${showCam   ? `<div id="camera-section">${this._renderCamera()}</div>` : ""}
          ${showSw    ? `<div id="switches-section">${this._renderSwitches()}</div>` : ""}
          <div class="content" id="card-content">${this._renderViewContent()}</div>
        </div>
        <div id="toast-container"></div>
        <div id="dialog-container"></div>
      </ha-card>`;
    this._lastUserHash = this._userHash();
    this._lastSwHash   = this._swHash();
    this._attachListeners();
  }

  // ── Surgical patches ─────────────────────────────────────────────────────

  _patchHeader() {
    const el = this.shadowRoot.getElementById("card-header");
    if (el) el.innerHTML = this._renderHeader();
  }

  _patchSwitches() {
    const el = this.shadowRoot.getElementById("switches-section");
    if (!el || !this._show("show_switches")) return;
    el.innerHTML = this._renderSwitches();
    this._attachSwitchListeners(el);
  }

  _rebuildListArea() {
    if (this._view === "add_user" || this._view === "edit_user") return;
    const scroller  = this.shadowRoot.querySelector(".user-scroll");
    const scrollTop = scroller?.scrollTop || 0;
    const el = this.shadowRoot.getElementById("card-content");
    if (!el) return;
    el.innerHTML = this._renderViewContent();
    this._attachContentListeners();
    const newScroller = el.querySelector(".user-scroll");
    if (newScroller) newScroller.scrollTop = scrollTop;
  }

  _switchView(view) {
    this._view = view;
    const el = this.shadowRoot.getElementById("card-content");
    if (el) { el.innerHTML = this._renderViewContent(); this._attachContentListeners(); }
    this.shadowRoot.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
      btn.classList.toggle("active",
        btn.dataset.view === view ||
        (view === "add_user"  && btn.dataset.view === "users") ||
        (view === "edit_user" && btn.dataset.view === "users"));
    });
    view === "dashboard" ? this._startCameraTimer() : this._stopCameraTimer();
  }

  // ── Camera timer — independent of HA state updates ───────────────────────

  _startCameraTimer() {
    this._stopCameraTimer();
    if (!this._show("show_camera") || this._view !== "dashboard") return;
    const ms = this._config.camera_refresh_interval ?? 5000;
    this._cameraTimer = setInterval(() => this._tickCamera(), ms);
  }

  _stopCameraTimer() {
    if (this._cameraTimer) { clearInterval(this._cameraTimer); this._cameraTimer = null; }
  }

  _tickCamera() {
    const img = this.shadowRoot.getElementById("cam-img");
    const url = this._getSnapshotUrl();
    if (!img || !url) return;
    // Preload before swap — eliminates flash/glitch
    const pre = new Image();
    pre.onload = () => { img.src = pre.src; };
    pre.src = `${url}&_t=${Date.now()}`;
  }

  _refreshCameraNow() {
    const img = this.shadowRoot.getElementById("cam-img");
    const url = this._getSnapshotUrl();
    if (!img || !url) return;
    img.src = `${url}&_t=${Date.now()}`;
    this._startCameraTimer(); // reset interval from now
  }

  _getSnapshotUrl() {
    if (!this._cameraEntity || !this._hass) return null;
    const s = this._hass.states[this._cameraEntity];
    return s ? `/api/camera_proxy/${this._cameraEntity}?token=${s.attributes.access_token||""}` : null;
  }

  _renderViewContent() {
    switch (this._view) {
      case "users":      return this._renderUserList();
      case "add_user":   return this._renderUserForm(null);
      case "edit_user":  return this._renderUserForm(this._editingUser);
      default:           return this._renderDashboard();
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────

  _styles() { return `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :host{
      --nic-bg:     var(--card-background-color,var(--ha-card-background,#fff));
      --nic-bg2:    var(--secondary-background-color,#f0f0f0);
      --nic-bg3:    var(--primary-background-color,#fafafa);
      --nic-border: var(--divider-color,rgba(0,0,0,0.12));
      --nic-accent: var(--primary-color,#03a9f4);
      --nic-ok:     var(--success-color,#4caf50);
      --nic-err:    var(--error-color,#f44336);
      --nic-warn:   var(--warning-color,#ff9800);
      --nic-t1:     var(--primary-text-color,#212121);
      --nic-t2:     var(--secondary-text-color,#727272);
      --nic-t3:     var(--disabled-text-color,#bdbdbd);
      --nic-r:      var(--ha-card-border-radius,12px);
      --nic-rsm:    8px;
      font-family:  var(--paper-font-common-base_-_font-family,inherit);
      color:        var(--primary-text-color);
    }
    .card{background:var(--nic-bg);border-radius:var(--nic-r);overflow:hidden}
    .header{display:flex;align-items:center;padding:12px 16px;background:var(--nic-bg2);border-bottom:1px solid var(--nic-border)}
    .hicon{width:32px;height:32px;background:var(--nic-accent);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;opacity:.9;margin-right:10px;flex-shrink:0}
    .htitle{font-size:15px;font-weight:500;color:var(--nic-t1)}
    .hsub{font-size:11px;color:var(--nic-t2)}
    .nav{display:flex;padding:0 16px;background:var(--nic-bg2);border-bottom:1px solid var(--nic-border)}
    .nav-btn{padding:10px 12px;font-size:12px;font-weight:500;color:var(--nic-t2);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;font-family:inherit;letter-spacing:.03em;text-transform:uppercase}
    .nav-btn:hover{color:var(--nic-t1)}
    .nav-btn.active{color:var(--nic-accent);border-bottom-color:var(--nic-accent)}
    .camera-wrap{position:relative;background:#000;aspect-ratio:4/3;overflow:hidden}
    .camera-wrap img{width:100%;height:100%;object-fit:cover;display:block}
    .cam-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,transparent 60%,rgba(0,0,0,.5));pointer-events:none}
    .cam-badge{position:absolute;top:10px;left:10px;background:rgba(0,0,0,.55);border-radius:6px;padding:4px 8px;font-size:10px;color:#fff;display:flex;align-items:center;gap:5px}
    .live-dot{width:6px;height:6px;border-radius:50%;background:var(--nic-ok);animation:pulse 2s infinite}
    .cam-btn{position:absolute;top:10px;right:10px;background:rgba(0,0,0,.45);border:none;border-radius:6px;padding:6px 8px;cursor:pointer;font-size:14px;line-height:1;color:#fff;transition:background .15s}
    .cam-btn:hover{background:rgba(0,0,0,.7)}
    .cam-nofeed{display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:8px;color:var(--nic-t2);font-size:13px;background:var(--nic-bg2)}
    .cam-nofeed .icon{font-size:36px}
    .switches{display:flex;gap:8px;padding:10px 16px;background:var(--nic-bg2);border-bottom:1px solid var(--nic-border);flex-wrap:wrap}
    .sw-btn{flex:1;min-width:100px;display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--nic-bg3);border:1px solid var(--nic-border);border-radius:var(--nic-rsm);cursor:pointer;transition:border-color .15s;font-family:inherit;font-size:13px;color:var(--nic-t1)}
    .sw-btn:hover{border-color:var(--nic-accent)}
    .sw-btn.on{border-color:var(--nic-ok)}
    .sw-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .sw-dot.on{background:var(--nic-ok)}
    .sw-dot.off{background:var(--nic-t3)}
    .sw-label{font-weight:500;font-size:12px;flex:1}
    .sw-trigger{margin-left:auto;background:var(--nic-accent);border:none;border-radius:4px;padding:3px 8px;font-size:11px;color:#fff;cursor:pointer;font-family:inherit;opacity:.85;transition:opacity .15s}
    .sw-trigger:hover{opacity:1}
    .content{padding:16px}
    .list-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .sec-title{font-size:11px;font-weight:500;color:var(--nic-t2);text-transform:uppercase;letter-spacing:.05em}
    .btn-add{display:flex;align-items:center;gap:5px;padding:6px 12px;background:var(--nic-accent);color:#fff;border:none;border-radius:var(--nic-rsm);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:opacity .15s}
    .btn-add:hover{opacity:.85}
    .ucard{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--nic-bg2);border:1px solid var(--nic-border);border-radius:var(--nic-rsm);margin-bottom:8px;transition:border-color .15s;cursor:pointer}
    .ucard:hover{border-color:var(--nic-accent)}
    .avatar{width:36px;height:36px;border-radius:50%;background:var(--nic-accent);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;flex-shrink:0;text-transform:uppercase;color:#fff;opacity:.85}
    .uinfo{flex:1;min-width:0}
    .uname{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--nic-t1)}
    .umeta{font-size:11px;color:var(--nic-t2);margin-top:2px}
    .badges{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
    .badge{padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500}
    .bp{background:rgba(3,169,244,.15);color:var(--nic-accent)}
    .bc{background:rgba(156,39,176,.12);color:#9c27b0}
    .bk{background:rgba(255,152,0,.12);color:var(--nic-warn)}
    .bv{background:rgba(76,175,80,.12);color:var(--nic-ok)}
    .uactions{display:flex;gap:6px;flex-shrink:0}
    .iBtn{width:30px;height:30px;border-radius:6px;border:1px solid var(--nic-border);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .15s;color:var(--nic-t2)}
    .iBtn:hover{border-color:var(--nic-t2);color:var(--nic-t1)}
    .no-users{text-align:center;padding:40px 20px;color:var(--nic-t2);font-size:13px}
    .no-users .icon{font-size:40px;margin-bottom:10px}
    .fhdr{display:flex;align-items:center;gap:10px;margin-bottom:20px}
    .back-btn{width:30px;height:30px;border-radius:6px;border:1px solid var(--nic-border);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--nic-t2);transition:all .15s}
    .back-btn:hover{border-color:var(--nic-t2);color:var(--nic-t1)}
    .ftitle{font-size:16px;font-weight:500;color:var(--nic-t1)}
    .fgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .fg{display:flex;flex-direction:column;gap:5px}
    .fg.s2{grid-column:span 2}
    .flabel{font-size:11px;font-weight:500;color:var(--nic-t2);text-transform:uppercase;letter-spacing:.04em}
    .fi{padding:8px 10px;background:var(--nic-bg2);border:1px solid var(--nic-border);border-radius:var(--nic-rsm);color:var(--nic-t1);font-size:13px;font-family:inherit;transition:border-color .15s;outline:none;width:100%}
    .fi:focus{border-color:var(--nic-accent)}
    .fhint{font-size:10px;color:var(--nic-t3)}
    .fsec{font-size:11px;font-weight:500;color:var(--nic-t2);text-transform:uppercase;letter-spacing:.04em;margin:16px 0 10px;padding-top:16px;border-top:1px solid var(--nic-border)}
    .cgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
    .clabel{font-size:10px;color:var(--nic-t2);margin-bottom:4px}
    .faction{display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--nic-border)}
    .btn{padding:8px 16px;border-radius:var(--nic-rsm);font-size:13px;font-weight:500;cursor:pointer;border:none;font-family:inherit;transition:opacity .15s}
    .bprimary{background:var(--nic-accent);color:#fff}
    .bprimary:hover{opacity:.85}
    .bdanger{background:var(--nic-err);color:#fff}
    .bdanger:hover{opacity:.85}
    .bghost{background:transparent;color:var(--nic-t2);border:1px solid var(--nic-border)}
    .bghost:hover{border-color:var(--nic-t2);color:var(--nic-t1)}
    .btn:disabled{opacity:.4;cursor:not-allowed}
    .dlg-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center}
    .dlg{background:var(--nic-bg);border:1px solid var(--nic-border);border-radius:var(--nic-r);padding:24px;max-width:380px;width:90%;box-shadow:var(--ha-card-box-shadow,0 2px 8px rgba(0,0,0,.15));animation:fadeIn .15s ease}
    .dlg-title{font-size:16px;font-weight:500;margin-bottom:8px;color:var(--nic-t1)}
    .dlg-body{font-size:13px;color:var(--nic-t2);margin-bottom:20px;line-height:1.5}
    .dlg-name{color:var(--nic-t1);font-weight:600}
    .dlg-actions{display:flex;gap:8px;justify-content:flex-end}
    .toast{position:fixed;bottom:20px;right:20px;padding:10px 14px;border-radius:var(--nic-rsm);font-size:13px;font-weight:500;z-index:9999;animation:slideUp .2s ease;display:flex;align-items:center;gap:8px;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,.2);color:#fff}
    .toast.success{background:var(--nic-ok)}
    .toast.error{background:var(--nic-err)}
    .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;flex-shrink:0;display:inline-block}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--nic-border);margin-bottom:16px;border-radius:var(--nic-rsm);overflow:hidden;border:1px solid var(--nic-border)}
    .stat{background:var(--nic-bg2);padding:12px;text-align:center}
    .stat-val{font-size:20px;font-weight:400;color:var(--nic-accent)}
    .stat-lbl{font-size:10px;color:var(--nic-t2);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
    .uscroll{max-height:320px;overflow-y:auto;padding-right:2px}
    .uscroll::-webkit-scrollbar{width:4px}
    .uscroll::-webkit-scrollbar-track{background:transparent}
    .uscroll::-webkit-scrollbar-thumb{background:var(--nic-border);border-radius:2px}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  `; }

  // ── Renderers ────────────────────────────────────────────────────────────

  _renderHeader() {
    const title = this._config.title || "2N Intercom";
    const parts = [];
    if (this._show("show_users"))    parts.push(`${this._users.length} user${this._users.length!==1?"s":""}`);
    if (this._show("show_switches")) parts.push(`${this._switches.length} switch${this._switches.length!==1?"es":""}`);
    return `<div class="header">
      <div class="hicon">🔒</div>
      <div><div class="htitle">${title}</div><div class="hsub">${parts.join(" · ")}</div></div>
    </div>`;
  }

  _renderNav() {
    const tabs = [{id:"dashboard",label:"Dashboard"},{id:"users",label:`Users (${this._users.length})`}];
    return `<div class="nav">${tabs.map(t=>`
      <button class="nav-btn ${this._view===t.id||(this._view==="add_user"&&t.id==="users")||(this._view==="edit_user"&&t.id==="users")?"active":""}" data-view="${t.id}">${t.label}</button>
    `).join("")}</div>`;
  }

  _renderCamera() {
    const url = this._getSnapshotUrl();
    if (!url) return `<div class="camera-wrap"><div class="cam-nofeed"><div class="icon">📷</div><div>No camera entity found</div></div></div>`;
    return `<div class="camera-wrap">
      <img id="cam-img" src="${url}&_t=${Date.now()}" alt="Camera"/>
      <div class="cam-overlay"></div>
      <div class="cam-badge"><div class="live-dot"></div> LIVE</div>
      <button class="cam-btn" id="cam-refresh" title="Refresh">⟳</button>
    </div>`;
  }

  _renderSwitches() {
    if (!this._switches.length) return '<div style="display:none"></div>';
    return `<div class="switches">${this._switches.map(sw=>`
      <div class="sw-btn ${sw.state==="on"?"on":""}" data-entity="${sw.entity_id}">
        <div class="sw-dot ${sw.state==="on"?"on":"off"}"></div>
        <span class="sw-label">${this._shortName(sw.name)}</span>
        <button class="sw-trigger" data-trigger="${sw.attributes.switch_id||1}">TRIGGER</button>
      </div>`).join("")}</div>`;
  }

  _shortName(n) {
    return n.replace(/.*?(\bswitch\s*\d*)/i,"$1").replace(/^2n intercom\s*/i,"").trim()||n;
  }

  _renderDashboard() {
    const showStats = this._show("show_stats");
    const showUsers = this._show("show_users");
    const showAdd   = this._show("show_add_user");
    const withPin   = this._users.filter(u=>u.attributes.has_pin).length;
    const withCode  = this._users.filter(u=>(u.attributes.switch_code_slots||[]).some(Boolean)).length;
    return `
      ${showStats ? `<div class="stats">
        <div class="stat"><div class="stat-val">${this._users.length}</div><div class="stat-lbl">Users</div></div>
        <div class="stat"><div class="stat-val">${withPin}</div><div class="stat-lbl">Have PIN</div></div>
        <div class="stat"><div class="stat-val">${withCode}</div><div class="stat-lbl">Have Codes</div></div>
      </div>` : ""}
      ${showUsers ? `
        <div class="list-hdr">
          <div class="sec-title">Recent Users</div>
          ${showAdd ? `<button class="btn-add" id="btn-add-dash">＋ Add User</button>` : ""}
        </div>
        <div class="uscroll">${this._users.slice(0,5).map(u=>this._renderUserCard(u)).join("")||this._renderNoUsers()}</div>
        ${this._users.length>5?`<div style="text-align:center;margin-top:8px">
          <button class="nav-btn" data-view="users" style="font-size:11px">View all ${this._users.length} →</button>
        </div>`:""}
      ` : ""}`;
  }

  _renderUserList() {
    const showAdd = this._show("show_add_user");
    return `
      <div class="list-hdr">
        <div class="sec-title">${this._users.length} Directory Users</div>
        ${showAdd ? `<button class="btn-add" id="btn-add-users">＋ Add User</button>` : ""}
      </div>
      <div class="uscroll">${this._users.map(u=>this._renderUserCard(u)).join("")||this._renderNoUsers()}</div>`;
  }

  _renderUserCard(u) {
    const a = u.attributes||{};
    const codes = (a.switch_code_slots||[]).filter(Boolean).length;
    const ini   = (u.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const showDel = this._show("show_delete_user");
    return `<div class="ucard" data-uuid="${u.uuid}">
      <div class="avatar">${ini}</div>
      <div class="uinfo">
        <div class="uname">${u.name}</div>
        <div class="umeta">${a.email||""}${a.virt_number?" · #"+a.virt_number:""}</div>
        <div class="badges">
          ${a.has_pin  ? '<span class="badge bp">PIN</span>':""}
          ${codes>0    ? `<span class="badge bc">${codes} Code${codes>1?"s":""}</span>`:""}
          ${a.has_card ? '<span class="badge bk">Card</span>':""}
          ${a.virt_number?`<span class="badge bv">#${a.virt_number}</span>`:""}
        </div>
      </div>
      <div class="uactions">
        <button class="iBtn" data-action="edit"   data-uuid="${u.uuid}" title="Edit">✏️</button>
        ${showDel?`<button class="iBtn" data-action="delete" data-uuid="${u.uuid}" data-name="${u.name}" title="Delete">🗑️</button>`:""}
      </div>
    </div>`;
  }

  _renderNoUsers() {
    return `<div class="no-users"><div class="icon">👤</div><div>No users in directory</div></div>`;
  }

  _renderUserForm(user) {
    const isEdit = !!user;
    const a = user?.attributes||{};
    const codes = a.switch_code_slots||[false,false,false,false];
    const ini   = isEdit ? (user.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() : "";
    const showDel = isEdit && this._show("show_delete_user");
    return `
      <div class="fhdr">
        <button class="back-btn" id="btn-back">←</button>
        ${isEdit?`<div class="avatar" style="margin-right:4px">${ini}</div>`:""}
        <div class="ftitle">${isEdit?`Edit: ${user.name}`:"Add New User"}</div>
      </div>
      ${isEdit?`<input type="hidden" id="f-uuid" value="${user.uuid}">`:""}
      <div class="fgrid">
        <div class="fg s2"><label class="flabel">Full Name *</label><input class="fi" id="f-name" type="text" placeholder="Jane Smith" value="${isEdit?user.name:""}"></div>
        <div class="fg"><label class="flabel">Email</label><input class="fi" id="f-email" type="email" placeholder="jane@example.com" value="${a.email||""}"></div>
        <div class="fg"><label class="flabel">Virtual Number</label><input class="fi" id="f-virt" type="text" placeholder="101" value="${a.virt_number||""}"></div>
        <div class="fg"><label class="flabel">SIP Peer</label><input class="fi" id="f-peer" type="text" placeholder="sip:100@192.168.1.10" value="${a.call_peers?.[0]||""}"></div>
        <div class="fg"><label class="flabel">Directory Path</label><input class="fi" id="f-tree" type="text" placeholder="/" value="${a.treepath||"/"}"></div>
      </div>
      <div class="fsec">Access Credentials</div>
      <div class="fgrid">
        <div class="fg"><label class="flabel">PIN Code</label><input class="fi" id="f-pin" type="password" placeholder="${isEdit&&a.has_pin?"leave blank to keep":"2–15 digits"}"></div>
        <div class="fg"><label class="flabel">Clear PIN</label>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;color:var(--nic-t2)">
            <input type="checkbox" id="f-clear-pin" style="accent-color:var(--nic-accent)"> Remove existing PIN
          </label>
        </div>
      </div>
      <div class="fsec">Switch Codes</div>
      <div class="cgrid">
        ${[1,2,3,4].map(i=>`
          <div>
            <div class="clabel">Slot ${i} ${codes[i-1]?"●":"○"}</div>
            <input class="fi" id="f-code-${i}" type="password" placeholder="${codes[i-1]?"••••":"empty"}">
          </div>`).join("")}
      </div>
      <div style="font-size:11px;color:var(--nic-t3);margin-top:6px">Leave blank to keep. Space to clear.</div>
      <div class="fsec">Access Validity</div>
      <div class="fgrid">
        <div class="fg"><label class="flabel">Valid From</label><input class="fi" id="f-from" type="datetime-local" value="${this._tsToLocal(a.valid_from)}"><span class="fhint">Blank = always</span></div>
        <div class="fg"><label class="flabel">Valid Until</label><input class="fi" id="f-to" type="datetime-local" value="${this._tsToLocal(a.valid_to)}"><span class="fhint">Blank = no expiry</span></div>
      </div>
      <div class="faction">
        ${showDel?`<button class="btn bdanger" id="btn-delete-form" data-uuid="${user.uuid}" data-name="${user.name}">Delete</button>`:""}
        <button class="btn bghost" id="btn-cancel">Cancel</button>
        <button class="btn bprimary" id="btn-save"><span id="btn-save-label">${isEdit?"Save Changes":"Create User"}</span></button>
      </div>`;
  }

  // ── Listeners ────────────────────────────────────────────────────────────

  _attachListeners() {
    const r = this.shadowRoot;
    r.querySelectorAll(".nav-btn[data-view]").forEach(b => b.addEventListener("click", () => this._switchView(b.dataset.view)));
    r.getElementById("cam-refresh")?.addEventListener("click", () => this._refreshCameraNow());
    this._attachSwitchListeners(r);
    this._attachContentListeners();
  }

  _attachSwitchListeners(root) {
    root.querySelectorAll("[data-trigger]").forEach(b =>
      b.addEventListener("click", e => { e.stopPropagation(); this._triggerSwitch(parseInt(b.dataset.trigger)); }));
    root.querySelectorAll(".sw-btn[data-entity]").forEach(s =>
      s.addEventListener("click", e => {
        if (e.target.dataset.trigger) return;
        const st = this._hass?.states[s.dataset.entity]?.state;
        this._hass?.callService("switch", st==="on"?"turn_off":"turn_on", {}, { entity_id: s.dataset.entity });
      }));
  }

  _attachContentListeners() {
    const r = this.shadowRoot;
    r.getElementById("btn-add-dash")?.addEventListener("click",  () => this._switchView("add_user"));
    r.getElementById("btn-add-users")?.addEventListener("click", () => this._switchView("add_user"));
    r.getElementById("btn-back")?.addEventListener("click",      () => { this._editingUser=null; this._switchView("users"); });
    r.getElementById("btn-cancel")?.addEventListener("click",    () => { this._editingUser=null; this._switchView("users"); });
    r.getElementById("btn-save")?.addEventListener("click",      () => this._handleSave());
    r.getElementById("btn-delete-form")?.addEventListener("click", e =>
      this._showDeleteDialog(e.currentTarget.dataset.uuid, e.currentTarget.dataset.name));
    r.querySelectorAll("[data-action='edit']").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      this._editingUser = this._users.find(u => u.uuid === b.dataset.uuid);
      this._switchView("edit_user");
    }));
    r.querySelectorAll("[data-action='delete']").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      this._showDeleteDialog(b.dataset.uuid, b.dataset.name);
    }));
    r.querySelectorAll(".nav-btn[data-view]").forEach(b =>
      b.addEventListener("click", () => this._switchView(b.dataset.view)));
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async _handleSave() {
    const r      = this.shadowRoot;
    const isEdit = this._view === "edit_user";
    const name   = r.getElementById("f-name")?.value?.trim();
    if (!name) { this._showToast("⚠️ Name is required", "error"); return; }

    const data = { user_name: name };
    if (this._entryId) data.entry_id = this._entryId;
    if (isEdit)        data.user_uuid = r.getElementById("f-uuid")?.value;

    const v = (id) => r.getElementById(id)?.value;
    if (v("f-email")?.trim()) data.user_email  = v("f-email").trim();
    if (v("f-virt")?.trim())  data.virt_number = v("f-virt").trim();
    if (v("f-peer")?.trim())  data.call_peer   = v("f-peer").trim();
    if (v("f-tree")?.trim())  data.treepath    = v("f-tree").trim();
    if (v("f-from"))          data.valid_from  = this._localToTs(v("f-from"));
    if (v("f-to"))            data.valid_to    = this._localToTs(v("f-to"));

    if (r.getElementById("f-clear-pin")?.checked) data.pin = "";
    else if (v("f-pin")) data.pin = v("f-pin");

    const codes = [1,2,3,4].map(i => v(`f-code-${i}`) ?? "");
    if (codes.some(c => c !== "")) data.switch_codes = codes.map(c => c===" "?"":c);

    const btn = r.getElementById("btn-save");
    const lbl = r.getElementById("btn-save-label");
    if (btn) btn.disabled = true;
    if (lbl) lbl.innerHTML = '<div class="spinner"></div>';

    try {
      await this._callService("2n_intercom", isEdit ? "update_user" : "create_user", data);
      this._showToast(isEdit ? "✅ User updated" : "✅ User created", "success");
      this._editingUser = null;
      this._switchView("users");
    } catch(err) {
      this._showToast(`❌ ${err.message||err}`, "error");
      if (btn) btn.disabled = false;
      if (lbl) lbl.textContent = isEdit ? "Save Changes" : "Create User";
    }
  }

  // ── Delete dialog ─────────────────────────────────────────────────────────

  _showDeleteDialog(uuid, name) {
    const c = this.shadowRoot.getElementById("dialog-container");
    c.innerHTML = `<div class="dlg-bg" id="dlg-bg">
      <div class="dlg">
        <div class="dlg-title">Delete User</div>
        <div class="dlg-body">Remove <span class="dlg-name">${name}</span> from the directory? Cannot be undone.</div>
        <div class="dlg-actions">
          <button class="btn bghost" id="dlg-cancel">Cancel</button>
          <button class="btn bdanger" id="dlg-ok">Delete</button>
        </div>
      </div></div>`;
    c.querySelector("#dlg-cancel").addEventListener("click", () => { c.innerHTML=""; });
    c.querySelector("#dlg-bg").addEventListener("click", e => { if(e.target.id==="dlg-bg") c.innerHTML=""; });
    c.querySelector("#dlg-ok").addEventListener("click", async () => {
      c.innerHTML = "";
      try {
        await this._callService("2n_intercom","delete_user",{user_uuid:uuid,...(this._entryId?{entry_id:this._entryId}:{})});
        this._showToast("🗑️ User deleted","success");
        if (this._view==="edit_user") { this._editingUser=null; this._switchView("users"); }
      } catch(err) { this._showToast(`❌ ${err.message||err}`,"error"); }
    });
  }

  // ── Utils ────────────────────────────────────────────────────────────────

  _triggerSwitch(id) {
    this._callService("2n_intercom","trigger_switch",{switch_id:id,action:"trigger",...(this._entryId?{entry_id:this._entryId}:{})});
    this._showToast("🔓 Switch triggered","success");
  }

  _showToast(msg, type="success") {
    const c = this.shadowRoot.getElementById("toast-container");
    const t = document.createElement("div");
    t.className = `toast ${type}`; t.textContent = msg;
    c.appendChild(t); setTimeout(()=>t.remove(),3500);
  }

  _callService(d, s, data) {
    if (!this._hass) return Promise.reject(new Error("HA not connected"));
    return this._hass.callService(d, s, data);
  }

  _tsToLocal(ts) {
    if (!ts||ts==="0") return "";
    try { const d=new Date(parseInt(ts)*1000); return isNaN(d.getTime())?"":d.toISOString().slice(0,16); } catch{return "";}
  }

  _localToTs(v) { try{return Math.floor(new Date(v).getTime()/1000);}catch{return 0;} }

  static getStubConfig() { return {type:"custom:twon-intercom-card",entity_prefix:"",title:"2N Intercom"}; }
  getCardSize() { return 8; }
  disconnectedCallback() { this._stopCameraTimer(); }
}

customElements.define("twon-intercom-card", TwoNIntercomCard);
window.customCards = window.customCards || [];
window.customCards.push({type:"twon-intercom-card",name:"2N Intercom Manager",description:"Manage 2N IP intercom users, camera, and door switches",preview:false});
