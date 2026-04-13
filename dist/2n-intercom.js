/**
 * 2N Intercom Manager Card  v1.2.0
 *
 * Uses native HA web components throughout:
 *   ha-button, ha-icon-button, ha-chip, ha-card, ha-icon
 *   All typography via HA paper-font variables
 *   All colours via HA theme variables
 *
 * Card config:
 *   type: custom:twon-intercom-card
 *   entity_prefix: "front_door"
 *   title: "Front Door"
 *   show_camera: true
 *   show_switches: true
 *   show_stats: true
 *   show_users: true
 *   show_add_user: true
 *   show_delete_user: true
 *   camera_refresh_interval: 5000
 *   camera_entity: "camera.xxx"
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
    if (swHash !== this._lastSwHash) { this._lastSwHash = swHash; this._patchSwitches(); }
    const userHash = this._userHash();
    if (userHash !== this._lastUserHash) { this._lastUserHash = userHash; this._rebuildListArea(); }
  }

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
  _show(f, d = true) { return this._config[f] !== undefined ? !!this._config[f] : d; }

  // ── Build DOM once ────────────────────────────────────────────────────────

  _buildDOM() {
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div id="card-header"></div>
        ${this._show("show_users") ? `<div id="card-nav"></div>` : ""}
        ${this._show("show_camera")   ? `<div id="camera-section"></div>` : ""}
        ${this._show("show_switches") ? `<div id="switches-section"></div>` : ""}
        <div id="card-content"></div>
        <div id="toast-area"></div>
        <div id="dialog-area"></div>
      </ha-card>`;

    this._patchHeader();
    if (this._show("show_users"))    this._patchNav();
    if (this._show("show_camera"))   this._patchCamera();
    if (this._show("show_switches")) this._patchSwitches();
    this._patchContent();

    this._lastUserHash = this._userHash();
    this._lastSwHash   = this._swHash();
  }

  _patchHeader() {
    const el = this.shadowRoot.getElementById("card-header");
    if (!el) return;
    const title = this._config.title || "2N Intercom";
    const parts = [];
    if (this._show("show_users"))    parts.push(`${this._users.length} user${this._users.length!==1?"s":""}`);
    if (this._show("show_switches")) parts.push(`${this._switches.length} switch${this._switches.length!==1?"es":""}`);
    el.innerHTML = `
      <div class="card-header">
        <div class="header-icon"><ha-icon icon="mdi:터door-sliding-lock"></ha-icon></div>
        <div class="header-text">
          <div class="card-header-title">${title}</div>
          <div class="header-subtitle">${parts.join(" · ")}</div>
        </div>
      </div>`;
  }

  _patchNav() {
    const el = this.shadowRoot.getElementById("card-nav");
    if (!el) return;
    el.innerHTML = `
      <div class="nav-tabs">
        <button class="nav-tab ${this._view==="dashboard"?"active":""}" data-view="dashboard">Dashboard</button>
        <button class="nav-tab ${this._view==="users"||this._view==="add_user"||this._view==="edit_user"?"active":""}" data-view="users">Users (${this._users.length})</button>
      </div>`;
    el.querySelectorAll(".nav-tab").forEach(b => b.addEventListener("click", () => this._switchView(b.dataset.view)));
  }

  _patchCamera() {
    const el = this.shadowRoot.getElementById("camera-section");
    if (!el) return;
    const url = this._getSnapshotUrl();
    if (!url) {
      el.innerHTML = `<div class="cam-nofeed"><ha-icon icon="mdi:camera-off"></ha-icon><span>No camera entity found</span></div>`;
      return;
    }
    el.innerHTML = `
      <div class="cam-wrap">
        <img id="cam-img" src="${url}&_t=${Date.now()}" alt="Camera feed"/>
        <div class="cam-overlay"></div>
        <div class="cam-badge"><span class="live-dot"></span> LIVE</div>
        <ha-icon-button id="cam-refresh" title="Refresh camera">
          <ha-icon icon="mdi:refresh"></ha-icon>
        </ha-icon-button>
      </div>`;
    el.querySelector("#cam-refresh")?.addEventListener("click", () => this._refreshCameraNow());
  }

  _patchSwitches() {
    const el = this.shadowRoot.getElementById("switches-section");
    if (!el || !this._show("show_switches")) return;
    if (!this._switches.length) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="switches-grid">
        ${this._switches.map(sw => `
          <div class="switch-item ${sw.state==="on"?"sw-on":""}">
            <div class="sw-info">
              <span class="sw-state-dot ${sw.state==="on"?"dot-on":"dot-off"}"></span>
              <span class="body-2">${this._shortName(sw.name)}</span>
            </div>
            <ha-button class="sw-trigger-btn" data-trigger="${sw.attributes.switch_id||1}" data-entity="${sw.entity_id}">
              Trigger
            </ha-button>
          </div>`).join("")}
      </div>`;
    el.querySelectorAll("ha-button[data-trigger]").forEach(b => {
      b.addEventListener("click", e => { e.stopPropagation(); this._triggerSwitch(parseInt(b.dataset.trigger)); });
    });
    el.querySelectorAll(".sw-info").forEach(info => {
      const item = info.closest(".switch-item");
      const entity = item?.querySelector("[data-entity]")?.dataset.entity;
      if (!entity) return;
      item.querySelector(".sw-info").addEventListener("click", () => {
        const st = this._hass?.states[entity]?.state;
        this._hass?.callService("switch", st==="on"?"turn_off":"turn_on",{},{entity_id:entity});
      });
    });
  }

  _patchContent() {
    const el = this.shadowRoot.getElementById("card-content");
    if (!el) return;
    el.innerHTML = this._renderViewContent();
    this._attachContentListeners();
  }

  _rebuildListArea() {
    if (this._view==="add_user"||this._view==="edit_user") return;
    const scroller  = this.shadowRoot.querySelector(".user-scroll");
    const scrollTop = scroller?.scrollTop || 0;
    this._patchContent();
    this._patchNav();
    const ns = this.shadowRoot.querySelector(".user-scroll");
    if (ns) ns.scrollTop = scrollTop;
  }

  _switchView(view) {
    this._view = view;
    this._patchContent();
    this._patchNav();
    view==="dashboard" ? this._startCameraTimer() : this._stopCameraTimer();
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  _startCameraTimer() {
    this._stopCameraTimer();
    if (!this._show("show_camera")||this._view!=="dashboard") return;
    const ms = this._config.camera_refresh_interval ?? 5000;
    this._cameraTimer = setInterval(()=>this._tickCamera(), ms);
  }

  _stopCameraTimer() {
    if (this._cameraTimer) { clearInterval(this._cameraTimer); this._cameraTimer=null; }
  }

  _tickCamera() {
    const img = this.shadowRoot.getElementById("cam-img");
    const url = this._getSnapshotUrl();
    if (!img||!url) return;
    const pre = new Image();
    pre.onload = () => { img.src = pre.src; };
    pre.src = `${url}&_t=${Date.now()}`;
  }

  _refreshCameraNow() {
    const img = this.shadowRoot.getElementById("cam-img");
    const url = this._getSnapshotUrl();
    if (!img||!url) return;
    img.src = `${url}&_t=${Date.now()}`;
    this._startCameraTimer();
  }

  _getSnapshotUrl() {
    if (!this._cameraEntity||!this._hass) return null;
    const s = this._hass.states[this._cameraEntity];
    return s ? `/api/camera_proxy/${this._cameraEntity}?token=${s.attributes.access_token||""}` : null;
  }

  // ── View content ──────────────────────────────────────────────────────────

  _renderViewContent() {
    switch (this._view) {
      case "users":     return this._renderUserList();
      case "add_user":  return this._renderUserForm(null);
      case "edit_user": return this._renderUserForm(this._editingUser);
      default:          return this._renderDashboard();
    }
  }

  _renderDashboard() {
    const showStats = this._show("show_stats");
    const showUsers = this._show("show_users");
    const showAdd   = this._show("show_add_user");
    const withPin   = this._users.filter(u=>u.attributes.has_pin).length;
    const withCode  = this._users.filter(u=>(u.attributes.switch_code_slots||[]).some(Boolean)).length;
    return `
      <div class="content-pad">
        ${showStats ? `
          <div class="stat-row">
            <div class="stat-chip">
              <span class="stat-val">${this._users.length}</span>
              <span class="caption">Users</span>
            </div>
            <div class="stat-chip">
              <span class="stat-val">${withPin}</span>
              <span class="caption">Have PIN</span>
            </div>
            <div class="stat-chip">
              <span class="stat-val">${withCode}</span>
              <span class="caption">Have Codes</span>
            </div>
          </div>` : ""}
        ${showUsers ? `
          <div class="list-header">
            <span class="overline">Recent Users</span>
            ${showAdd ? `<ha-button id="btn-add-dash" unelevated>Add User</ha-button>` : ""}
          </div>
          <div class="user-scroll">
            ${this._users.slice(0,5).map(u=>this._renderUserRow(u)).join("")||this._renderEmpty()}
          </div>
          ${this._users.length>5 ? `
            <div class="show-all-row">
              <button class="text-btn" data-view="users">Show all ${this._users.length} users</button>
            </div>` : ""}
        ` : ""}
      </div>`;
  }

  _renderUserList() {
    const showAdd = this._show("show_add_user");
    return `
      <div class="content-pad">
        <div class="list-header">
          <span class="overline">${this._users.length} Directory Users</span>
          ${showAdd ? `<ha-button id="btn-add-users" unelevated>Add User</ha-button>` : ""}
        </div>
        <div class="user-scroll">
          ${this._users.map(u=>this._renderUserRow(u)).join("")||this._renderEmpty()}
        </div>
      </div>`;
  }

  _renderUserRow(u) {
    const a = u.attributes||{};
    const codes = (a.switch_code_slots||[]).filter(Boolean).length;
    const ini   = (u.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const showDel = this._show("show_delete_user");
    return `
      <div class="user-row">
        <div class="user-avatar body-1">${ini}</div>
        <div class="user-body">
          <div class="body-1 user-name">${u.name}</div>
          ${a.email||a.virt_number ? `<div class="caption user-sub">${a.email||""}${a.virt_number?" · #"+a.virt_number:""}</div>` : ""}
          <div class="badge-row">
            ${a.has_pin  ? `<span class="ha-chip">PIN</span>` : ""}
            ${codes>0    ? `<span class="ha-chip">${codes} Code${codes>1?"s":""}</span>` : ""}
            ${a.has_card ? `<span class="ha-chip">Card</span>` : ""}
            ${a.virt_number ? `<span class="ha-chip">#${a.virt_number}</span>` : ""}
          </div>
        </div>
        <div class="user-actions">
          <ha-icon-button data-action="edit" data-uuid="${u.uuid}" title="Edit user">
            <ha-icon icon="mdi:pencil"></ha-icon>
          </ha-icon-button>
          ${showDel ? `
          <ha-icon-button data-action="delete" data-uuid="${u.uuid}" data-name="${u.name}" title="Delete user">
            <ha-icon icon="mdi:delete"></ha-icon>
          </ha-icon-button>` : ""}
        </div>
      </div>`;
  }

  _renderEmpty() {
    return `<div class="empty-state"><ha-icon icon="mdi:account-plus"></ha-icon><span class="body-2">No users in directory</span></div>`;
  }

  _renderUserForm(user) {
    const isEdit  = !!user;
    const a       = user?.attributes||{};
    const codes   = a.switch_code_slots||[false,false,false,false];
    const ini     = isEdit ? (user.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() : "";
    const showDel = isEdit && this._show("show_delete_user");
    return `
      <div class="content-pad">
        <div class="form-header">
          <ha-icon-button id="btn-back" title="Back">
            <ha-icon icon="mdi:arrow-left"></ha-icon>
          </ha-icon-button>
          ${isEdit ? `<div class="user-avatar body-1" style="margin:0 8px">${ini}</div>` : `<ha-icon icon="mdi:account-plus" style="margin:0 8px"></ha-icon>`}
          <span class="headline">${isEdit ? `Edit: ${user.name}` : "Add New User"}</span>
        </div>

        ${isEdit ? `<input type="hidden" id="f-uuid" value="${user.uuid}">` : ""}

        <div class="form-section-label overline">Identity</div>
        <div class="form-grid">
          <label class="form-field full">
            <span class="caption form-label">Full Name *</span>
            <input class="ha-input" id="f-name" type="text" placeholder="Jane Smith" value="${isEdit?user.name:""}">
          </label>
          <label class="form-field">
            <span class="caption form-label">Email</span>
            <input class="ha-input" id="f-email" type="email" placeholder="jane@example.com" value="${a.email||""}">
          </label>
          <label class="form-field">
            <span class="caption form-label">Virtual Number</span>
            <input class="ha-input" id="f-virt" type="text" placeholder="101" value="${a.virt_number||""}">
          </label>
          <label class="form-field">
            <span class="caption form-label">SIP Peer</span>
            <input class="ha-input" id="f-peer" type="text" placeholder="sip:100@192.168.1.10" value="${a.call_peers?.[0]||""}">
          </label>
          <label class="form-field">
            <span class="caption form-label">Directory Path</span>
            <input class="ha-input" id="f-tree" type="text" placeholder="/" value="${a.treepath||"/"}">
          </label>
        </div>

        <div class="form-section-label overline">Access Credentials</div>
        <div class="form-grid">
          <label class="form-field">
            <span class="caption form-label">PIN Code</span>
            <input class="ha-input" id="f-pin" type="password" placeholder="${isEdit&&a.has_pin?"leave blank to keep":"2–15 digits"}">
          </label>
          <label class="form-field checkbox-field">
            <input type="checkbox" id="f-clear-pin" class="ha-checkbox">
            <span class="body-2">Remove existing PIN</span>
          </label>
        </div>

        <div class="form-section-label overline">Switch Codes</div>
        <div class="codes-grid">
          ${[1,2,3,4].map(i=>`
            <label class="form-field">
              <span class="caption form-label">Slot ${i} ${codes[i-1]?"●":"○"}</span>
              <input class="ha-input" id="f-code-${i}" type="password" placeholder="${codes[i-1]?"••••":"empty"}">
            </label>`).join("")}
        </div>
        <p class="caption hint-text">Leave blank to keep. Enter a space to clear a slot.</p>

        <div class="form-section-label overline">Access Validity</div>
        <div class="form-grid">
          <label class="form-field">
            <span class="caption form-label">Valid From</span>
            <input class="ha-input" id="f-from" type="datetime-local" value="${this._tsToLocal(a.valid_from)}">
          </label>
          <label class="form-field">
            <span class="caption form-label">Valid Until</span>
            <input class="ha-input" id="f-to" type="datetime-local" value="${this._tsToLocal(a.valid_to)}">
          </label>
        </div>

        <div class="form-actions">
          ${showDel ? `<ha-button class="danger-btn" id="btn-delete-form" data-uuid="${user.uuid}" data-name="${user.name}">Delete</ha-button>` : ""}
          <ha-button id="btn-cancel">Cancel</ha-button>
          <ha-button id="btn-save" unelevated>
            <span id="btn-save-label">${isEdit?"Save Changes":"Create User"}</span>
          </ha-button>
        </div>
      </div>`;
  }

  // ── Listeners ────────────────────────────────────────────────────────────

  _attachContentListeners() {
    const r = this.shadowRoot;
    r.getElementById("btn-add-dash")?.addEventListener("click",  () => this._switchView("add_user"));
    r.getElementById("btn-add-users")?.addEventListener("click", () => this._switchView("add_user"));
    r.getElementById("btn-back")?.addEventListener("click",   () => { this._editingUser=null; this._switchView("users"); });
    r.getElementById("btn-cancel")?.addEventListener("click", () => { this._editingUser=null; this._switchView("users"); });
    r.getElementById("btn-save")?.addEventListener("click",   () => this._handleSave());
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
    r.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => this._switchView(b.dataset.view)));
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async _handleSave() {
    const r      = this.shadowRoot;
    const isEdit = this._view==="edit_user";
    const name   = r.getElementById("f-name")?.value?.trim();
    if (!name) { this._showToast("Name is required","error"); return; }
    const data = { user_name: name };
    if (this._entryId) data.entry_id = this._entryId;
    if (isEdit) data.user_uuid = r.getElementById("f-uuid")?.value;
    const v = id => r.getElementById(id)?.value;
    if (v("f-email")?.trim())  data.user_email  = v("f-email").trim();
    if (v("f-virt")?.trim())   data.virt_number = v("f-virt").trim();
    if (v("f-peer")?.trim())   data.call_peer   = v("f-peer").trim();
    if (v("f-tree")?.trim())   data.treepath    = v("f-tree").trim();
    if (v("f-from"))           data.valid_from  = this._localToTs(v("f-from"));
    if (v("f-to"))             data.valid_to    = this._localToTs(v("f-to"));
    if (r.getElementById("f-clear-pin")?.checked) data.pin = "";
    else if (v("f-pin"))       data.pin = v("f-pin");
    const codes = [1,2,3,4].map(i=>v(`f-code-${i}`)??"");
    if (codes.some(c=>c!=="")) data.switch_codes = codes.map(c=>c===" "?"":c);
    const btn = r.getElementById("btn-save");
    const lbl = r.getElementById("btn-save-label");
    if (btn) btn.disabled = true;
    if (lbl) lbl.innerHTML = `<ha-circular-progress indeterminate size="small"></ha-circular-progress>`;
    try {
      await this._callService("2n_intercom", isEdit?"update_user":"create_user", data);
      this._showToast(isEdit?"User updated":"User created","success");
      this._editingUser = null;
      this._switchView("users");
    } catch(err) {
      this._showToast(`${err.message||err}`,"error");
      if (btn) btn.disabled = false;
      if (lbl) lbl.textContent = isEdit?"Save Changes":"Create User";
    }
  }

  // ── Delete dialog ─────────────────────────────────────────────────────────

  _showDeleteDialog(uuid, name) {
    const c = this.shadowRoot.getElementById("dialog-area");
    c.innerHTML = `
      <div class="dlg-scrim" id="dlg-scrim">
        <ha-dialog open heading="Delete User">
          <div>Remove <strong>${name}</strong> from the directory? This cannot be undone.</div>
          <ha-button slot="secondaryAction" dialogAction="close">Cancel</ha-button>
          <ha-button slot="primaryAction" id="dlg-confirm" class="danger-btn">Delete</ha-button>
        </ha-dialog>
      </div>`;
    c.querySelector("ha-dialog")?.addEventListener("closed", () => { c.innerHTML=""; });
    c.querySelector("#dlg-confirm")?.addEventListener("click", async () => {
      c.innerHTML = "";
      try {
        await this._callService("2n_intercom","delete_user",{user_uuid:uuid,...(this._entryId?{entry_id:this._entryId}:{})});
        this._showToast("User deleted","success");
        if (this._view==="edit_user") { this._editingUser=null; this._switchView("users"); }
      } catch(err) { this._showToast(`${err.message||err}`,"error"); }
    });
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  _showToast(msg, type="success") {
    const c = this.shadowRoot.getElementById("toast-area");
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    const icon = type==="success" ? "mdi:check-circle" : "mdi:alert-circle";
    t.innerHTML = `<ha-icon icon="${icon}"></ha-icon><span class="body-2">${msg}</span>`;
    c.appendChild(t);
    setTimeout(()=>t.remove(), 3500);
  }

  // ── Utils ────────────────────────────────────────────────────────────────

  _triggerSwitch(id) {
    this._callService("2n_intercom","trigger_switch",{switch_id:id,action:"trigger",...(this._entryId?{entry_id:this._entryId}:{})});
    this._showToast("Switch triggered","success");
  }

  _shortName(n) {
    return n.replace(/^.*?(switch\s*\d*)/i,"$1").replace(/^2n intercom\s*/i,"").trim()||n;
  }

  _callService(d,s,data) {
    if (!this._hass) return Promise.reject(new Error("HA not connected"));
    return this._hass.callService(d,s,data);
  }

  _tsToLocal(ts) {
    if (!ts||ts==="0") return "";
    try { const d=new Date(parseInt(ts)*1000); return isNaN(d.getTime())?"":d.toISOString().slice(0,16); } catch{return "";}
  }
  _localToTs(v) { try{return Math.floor(new Date(v).getTime()/1000);}catch{return 0;} }

  // ── Styles — all via HA CSS variables ─────────────────────────────────────

  _styles() { return `
    *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Host — must be 100% width and use container queries ── */
    :host {
      /* Typography — real HA paper-font variable names */
      --font-headline:    var(--paper-font-headline_-_font-size,      24px);
      --font-title:       var(--paper-font-title_-_font-size,         20px);
      --font-subhead:     var(--paper-font-subhead_-_font-size,       16px);
      --font-body-1:      var(--paper-font-body-1_-_font-size,        14px);
      --font-body-2:      var(--paper-font-body-2_-_font-size,        14px);
      --font-caption:     var(--paper-font-caption_-_font-size,       12px);
      --font-overline:    10px;
      --fw-medium:        var(--paper-font-body-2_-_font-weight,      500);
      --fw-regular:       var(--paper-font-body-1_-_font-weight,      400);
      /* Colours */
      --c-bg:             var(--card-background-color, var(--ha-card-background, #fff));
      --c-bg2:            var(--secondary-background-color, #f5f5f5);
      --c-divider:        var(--divider-color, rgba(0,0,0,.12));
      --c-accent:         var(--primary-color, #03a9f4);
      --c-text1:          var(--primary-text-color, #212121);
      --c-text2:          var(--secondary-text-color, #727272);
      --c-text3:          var(--disabled-text-color, #bdbdbd);
      --c-success:        var(--success-color, #4caf50);
      --c-error:          var(--error-color, #f44336);
      --c-warning:        var(--warning-color, #ff9800);
      /* Shape */
      --r:                var(--ha-card-border-radius, 12px);
      --r-sm:             8px;
      --r-xs:             4px;
      /* KEY: fill parent width */
      display: block;
      width: 100%;
      container-type: inline-size;
      container-name: card;
      font-family: var(--paper-font-common-base_-_font-family, Roboto, sans-serif);
      color: var(--c-text1);
    }

    ha-card {
      display: block;
      width: 100%;
      overflow: hidden;
    }

    /* ── Typography helpers ── */
    .headline  { font-size:var(--font-headline); font-weight:var(--fw-medium);  line-height:1.3; color:var(--c-text1); }
    .subhead   { font-size:var(--font-subhead);  font-weight:var(--fw-medium);  color:var(--c-text1); }
    .body-1    { font-size:var(--font-body-1);   font-weight:var(--fw-regular); color:var(--c-text1); }
    .body-2    { font-size:var(--font-body-2);   font-weight:var(--fw-medium);  color:var(--c-text1); }
    .caption   { font-size:var(--font-caption);  font-weight:var(--fw-regular); color:var(--c-text2); }
    .overline  { font-size:var(--font-overline); font-weight:var(--fw-medium);  color:var(--c-text2); text-transform:uppercase; letter-spacing:.1em; }

    /* ── Card header ── */
    .card-header {
      display: flex; align-items: center; gap: 12px;
      padding: 16px 16px 12px;
      border-bottom: 1px solid var(--c-divider);
    }
    .header-icon {
      width:40px; height:40px; border-radius:10px; background:var(--c-accent);
      display:flex; align-items:center; justify-content:center; flex-shrink:0; opacity:.9;
    }
    .header-icon ha-icon { --mdc-icon-size:22px; color:#fff; }
    .card-header-title { font-size:var(--font-subhead); font-weight:var(--fw-medium); color:var(--c-text1); }
    .header-subtitle   { font-size:var(--font-caption); color:var(--c-text2); margin-top:1px; }

    /* ── Nav tabs ── */
    .nav-tabs {
      display:flex; border-bottom:1px solid var(--c-divider);
      background:var(--c-bg2); padding:0 8px;
    }
    .nav-tab {
      padding:10px 16px; font-size:var(--font-caption); font-weight:var(--fw-medium);
      text-transform:uppercase; letter-spacing:.08em; color:var(--c-text2);
      background:none; border:none; border-bottom:2px solid transparent;
      cursor:pointer; font-family:inherit; transition:color .15s, border-color .15s;
    }
    .nav-tab:hover  { color:var(--c-text1); }
    .nav-tab.active { color:var(--c-accent); border-bottom-color:var(--c-accent); }

    /* ── Camera ── */
    .cam-wrap { position:relative; background:#000; aspect-ratio:4/3; overflow:hidden; width:100%; }
    .cam-wrap img { width:100%; height:100%; object-fit:cover; display:block; }
    .cam-overlay  { position:absolute; inset:0; background:linear-gradient(to bottom,transparent 60%,rgba(0,0,0,.4)); pointer-events:none; }
    .cam-badge    { position:absolute; top:10px; left:10px; background:rgba(0,0,0,.55); border-radius:4px; padding:3px 8px; font-size:var(--font-caption); color:#fff; display:flex; align-items:center; gap:5px; }
    .live-dot     { width:6px; height:6px; border-radius:50%; background:var(--c-success); animation:pulse 2s infinite; }
    ha-icon-button#cam-refresh { position:absolute; top:6px; right:6px; --mdc-icon-button-size:32px; --mdc-icon-size:18px; color:#fff; }
    .cam-nofeed   { display:flex; flex-direction:column; align-items:center; justify-content:center; height:180px; gap:8px; color:var(--c-text2); background:var(--c-bg2); }
    .cam-nofeed ha-icon { --mdc-icon-size:36px; }

    /* ── Switches
         Default: single column stack (narrow cards / mobile)
         ≥ 400px: 2 columns
         ≥ 600px: 4 columns (all switches in one row) ── */
    .switches-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      padding: 10px 16px;
      background: var(--c-bg2);
      border-bottom: 1px solid var(--c-divider);
    }
    @container card (min-width: 400px) {
      .switches-grid { grid-template-columns: 1fr 1fr; }
    }
    @container card (min-width: 600px) {
      .switches-grid { grid-template-columns: repeat(4, 1fr); }
    }

    .switch-item {
      display:flex; align-items:center; justify-content:space-between;
      padding:8px 10px 8px 12px; background:var(--c-bg);
      border:1px solid var(--c-divider); border-radius:var(--r-sm); gap:6px; min-width:0;
    }
    .switch-item.sw-on { border-color:var(--c-success); }
    .sw-info  { display:flex; align-items:center; gap:8px; cursor:pointer; flex:1; min-width:0; overflow:hidden; }
    .sw-state-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .dot-on  { background:var(--c-success); }
    .dot-off { background:var(--c-text3); }
    .sw-info .body-2 { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .switch-item ha-button { flex-shrink:0; --mdc-theme-primary:var(--c-accent); }

    /* ── Content ── */
    .content-pad { padding:16px; }

    /* ── Stats row — always 3 equal columns ── */
    .stat-row { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:16px; }
    .stat-chip { display:flex; flex-direction:column; align-items:center; padding:12px 8px; background:var(--c-bg2); border-radius:var(--r-sm); border:1px solid var(--c-divider); gap:2px; }
    .stat-val  { font-size:var(--font-title); font-weight:var(--fw-medium); color:var(--c-accent); }

    /* ── List header ── */
    .list-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .list-header ha-button { --mdc-theme-primary:var(--c-accent); }

    /* ── User rows ── */
    .user-scroll { max-height:340px; overflow-y:auto; }
    .user-scroll::-webkit-scrollbar { width:4px; }
    .user-scroll::-webkit-scrollbar-thumb { background:var(--c-divider); border-radius:2px; }
    .user-row { display:flex; align-items:center; gap:12px; padding:10px 4px 10px 0; border-bottom:1px solid var(--c-divider); }
    .user-row:last-child { border-bottom:none; }
    .user-avatar { width:40px; height:40px; border-radius:50%; background:var(--c-accent); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:var(--fw-medium); flex-shrink:0; opacity:.85; font-size:var(--font-body-1); }
    .user-body  { flex:1; min-width:0; }
    .user-name  { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .user-sub   { margin-top:1px; }
    .badge-row  { display:flex; gap:4px; margin-top:4px; flex-wrap:wrap; }
    .ha-chip    { display:inline-flex; align-items:center; padding:1px 8px; border-radius:12px; font-size:var(--font-caption); font-weight:var(--fw-medium); background:var(--c-bg2); border:1px solid var(--c-divider); color:var(--c-text2); }
    .user-actions ha-icon-button { --mdc-icon-button-size:36px; --mdc-icon-size:18px; color:var(--c-text2); }
    .empty-state { display:flex; flex-direction:column; align-items:center; padding:32px 16px; gap:8px; color:var(--c-text2); }
    .empty-state ha-icon { --mdc-icon-size:40px; }
    .show-all-row { text-align:center; padding:8px 0 0; }
    .text-btn { background:none; border:none; cursor:pointer; font-family:inherit; font-size:var(--font-caption); color:var(--c-accent); font-weight:var(--fw-medium); text-transform:uppercase; letter-spacing:.08em; padding:4px 8px; }

    /* ── Form header ── */
    .form-header { display:flex; align-items:center; gap:4px; margin-bottom:20px; }
    .form-header ha-icon-button { --mdc-icon-button-size:36px; --mdc-icon-size:20px; color:var(--c-text2); }
    .form-section-label { margin:16px 0 10px; }

    /* ── Form grid
         Default (narrow): single column, all fields full width
         ≥ 400px: two columns, fields auto-assigned ── */
    .form-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @container card (min-width: 400px) {
      .form-grid { grid-template-columns: 1fr 1fr; }
      .form-field.full { grid-column: span 2; }
    }

    .form-field { display:flex; flex-direction:column; gap:4px; }
    .form-label { display:block; }

    .ha-input {
      width:100%; padding:8px 12px;
      background:var(--c-bg2); border:1px solid var(--c-divider);
      border-radius:var(--r-xs); color:var(--c-text1);
      font-size:var(--font-body-1); font-family:inherit;
      outline:none; transition:border-color .15s;
    }
    .ha-input:focus { border-color:var(--c-accent); }

    .checkbox-field { flex-direction:row; align-items:center; gap:8px; padding-top:20px; }
    .ha-checkbox    { accent-color:var(--c-accent); width:16px; height:16px; cursor:pointer; }

    /* ── Switch codes grid
         Default: 2 columns (narrow / mobile)
         ≥ 400px: 4 columns ── */
    .codes-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    @container card (min-width: 400px) {
      .codes-grid { grid-template-columns: repeat(4,1fr); }
    }

    .hint-text { margin-top:6px; color:var(--c-text3); }

    .form-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:20px; padding-top:16px; border-top:1px solid var(--c-divider); flex-wrap:wrap; }
    .form-actions ha-button { --mdc-theme-primary:var(--c-accent); }
    .danger-btn { --mdc-theme-primary:var(--c-error); }

    /* ── Toast ── */
    #toast-area { position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
    .toast { display:flex; align-items:center; gap:8px; padding:10px 16px; border-radius:var(--r-sm); color:#fff; animation:slideUp .2s ease; box-shadow:var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.2)); min-width:180px; max-width:300px; pointer-events:auto; }
    .toast.success { background:var(--c-success); }
    .toast.error   { background:var(--c-error); }
    .toast ha-icon { --mdc-icon-size:18px; flex-shrink:0; }
    .dlg-scrim ha-dialog { --mdc-theme-primary:var(--c-accent); }

    @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
    @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  `

  static getStubConfig() {
    return { type:"custom:twon-intercom-card", entity_prefix:"", title:"2N Intercom" };
  }
  getCardSize() { return 8; }
  disconnectedCallback() { this._stopCameraTimer(); }
}

customElements.define("twon-intercom-card", TwoNIntercomCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "twon-intercom-card",
  name: "2N Intercom Manager",
  description: "Manage 2N IP intercom users, camera, and door switches",
  preview: false,
});
