/**
 * 2N Intercom Manager Card
 * A Lovelace custom card for managing 2N IP intercom directory users,
 * viewing the camera feed, and controlling door switches.
 *
 * Install: via HACS (Frontend / Dashboard category) — installs automatically
 * Manual install: copy dist/2n-intercom.js to /config/www/community/2n-intercom/
 * Resource URL (auto-added by HACS): /hacsfiles/2n-intercom/2n-intercom.js
 *
 * Card config:
 *   type: custom:twon-intercom-card
 *   entity_prefix: "2n_intercom_front_door"   # prefix of your device entities
 *   title: "Front Door Intercom"               # optional
 *   show_camera: true                          # optional, default true
 *   camera_entity: "camera.front_door_camera" # optional, auto-detected
 *   switch_entities:                           # optional, auto-detected
 *     - switch.front_door_switch_1
 */

class TwoNIntercomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._view = "dashboard"; // dashboard | users | add_user | edit_user
    this._editingUser = null;
    this._users = [];
    this._switches = [];
    this._cameraEntity = null;
    this._cameraRefresh = null;
    this._toast = null;
  }

  static get properties() {
    return { hass: {}, config: {} };
  }

  setConfig(config) {
    if (!config.entity_prefix && !config.count_entity) {
      throw new Error("2N Intercom Card: entity_prefix is required");
    }
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncEntities();
    if (!this._rendered) {
      this._render();
      this._rendered = true;
    } else {
      this._updateDynamic();
    }
  }

  _syncEntities() {
    if (!this._hass) return;
    const prefix = this._config.entity_prefix || "";
    const states = this._hass.states;

    // Find user sensors
    this._users = Object.entries(states)
      .filter(([id]) =>
        id.startsWith(`sensor.`) &&
        id.includes("user_") &&
        (prefix ? id.includes(prefix.toLowerCase().replace(/ /g, "_")) : true) &&
        !id.includes("user_count")
      )
      .map(([id, state]) => ({
        entity_id: id,
        name: state.state,
        attributes: state.attributes,
        uuid: state.attributes.uuid,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Find switch entities
    this._switches = Object.entries(states)
      .filter(([id]) =>
        id.startsWith("switch.") &&
        (prefix ? id.includes(prefix.toLowerCase().replace(/ /g, "_")) : true) &&
        id.includes("switch_")
      )
      .map(([id, state]) => ({
        entity_id: id,
        name: state.attributes.friendly_name || id,
        state: state.state,
        attributes: state.attributes,
      }));

    // Find camera entity
    if (this._config.camera_entity) {
      this._cameraEntity = this._config.camera_entity;
    } else {
      const camEntry = Object.keys(states).find(
        (id) =>
          id.startsWith("camera.") &&
          (prefix ? id.includes(prefix.toLowerCase().replace(/ /g, "_")) : true)
      );
      this._cameraEntity = camEntry || null;
    }

    // Get entry_id from first user or count sensor
    const countSensor = Object.entries(states).find(
      ([id]) =>
        id.startsWith("sensor.") &&
        id.includes("user_count") &&
        (prefix ? id.includes(prefix.toLowerCase().replace(/ /g, "_")) : true)
    );
    this._entryId =
      countSensor?.[1]?.attributes?.entry_id || null;
  }

  _getSnapshotUrl() {
    if (!this._cameraEntity || !this._hass) return null;
    const state = this._hass.states[this._cameraEntity];
    if (!state) return null;
    // Use HA's camera proxy for auth handling
    return `/api/camera_proxy/${this._cameraEntity}?token=${state.attributes.access_token || ""}`;
  }

  // ── Styles ───────────────────────────────────────────────────────────────

  _styles() {
    return `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      :host {
        /* Map our vars to HA theme variables */
        --nic-bg:        var(--card-background-color, var(--ha-card-background, #fff));
        --nic-bg2:       var(--secondary-background-color, #f0f0f0);
        --nic-bg3:       var(--primary-background-color, #fafafa);
        --nic-border:    var(--divider-color, rgba(0,0,0,0.12));
        --nic-accent:    var(--primary-color, #03a9f4);
        --nic-success:   var(--success-color, #4caf50);
        --nic-danger:    var(--error-color, #f44336);
        --nic-warn:      var(--warning-color, #ff9800);
        --nic-text:      var(--primary-text-color, #212121);
        --nic-text2:     var(--secondary-text-color, #727272);
        --nic-text3:     var(--disabled-text-color, #bdbdbd);
        --nic-radius:    var(--ha-card-border-radius, 12px);
        --nic-radius-sm: 8px;
        font-family: var(--paper-font-common-base_-_font-family, inherit);
        color: var(--primary-text-color);
      }

      .card {
        background: var(--nic-bg);
        border-radius: var(--nic-radius);
        overflow: hidden;
      }

      /* Header */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: var(--nic-bg2);
        border-bottom: 1px solid var(--nic-border);
      }
      .header-left { display: flex; align-items: center; gap: 10px; }
      .header-icon {
        width: 32px; height: 32px;
        background: var(--nic-accent);
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 16px;
        opacity: 0.9;
      }
      .header-title { font-size: 15px; font-weight: 500; }
      .header-sub   { font-size: 11px; color: var(--nic-text2); }

      /* Nav tabs */
      .nav {
        display: flex;
        padding: 0 16px;
        background: var(--nic-bg2);
        border-bottom: 1px solid var(--nic-border);
        gap: 4px;
      }
      .nav-btn {
        padding: 10px 12px;
        font-size: 12px;
        font-weight: 500;
        color: var(--nic-text2);
        background: none;
        border: none;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.15s;
        font-family: inherit;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .nav-btn:hover  { color: var(--nic-text); }
      .nav-btn.active { color: var(--nic-accent); border-bottom-color: var(--nic-accent); }

      /* Camera */
      .camera-wrap {
        position: relative;
        background: #000;
        aspect-ratio: 4/3;
        overflow: hidden;
      }
      .camera-wrap img {
        width: 100%; height: 100%;
        object-fit: cover;
        display: block;
      }
      .camera-overlay {
        position: absolute; inset: 0;
        background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.5));
        pointer-events: none;
      }
      .camera-badge {
        position: absolute; top: 10px; left: 10px;
        background: rgba(0,0,0,0.55);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 10px;
        color: #fff;
        display: flex; align-items: center; gap: 5px;
      }
      .live-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: var(--nic-success);
        animation: pulse 2s infinite;
      }
      .camera-refresh {
        position: absolute; top: 10px; right: 10px;
        background: rgba(0,0,0,0.45);
        border: none;
        border-radius: 6px;
        padding: 6px 8px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        color: #fff;
        transition: background 0.15s;
      }
      .camera-refresh:hover { background: rgba(0,0,0,0.7); }
      .camera-no-feed {
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        height: 200px;
        gap: 8px; color: var(--nic-text2);
        font-size: 13px;
        background: var(--nic-bg2);
      }
      .camera-no-feed .icon { font-size: 36px; }

      /* Switch row */
      .switches {
        display: flex; gap: 8px;
        padding: 10px 16px;
        background: var(--nic-bg2);
        border-bottom: 1px solid var(--nic-border);
        flex-wrap: wrap;
      }
      .switch-btn {
        flex: 1; min-width: 100px;
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px;
        background: var(--nic-bg3);
        border: 1px solid var(--nic-border);
        border-radius: var(--nic-radius-sm);
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
        font-size: 13px;
        color: var(--nic-text);
      }
      .switch-btn:hover { border-color: var(--nic-accent); }
      .switch-btn.on    { border-color: var(--nic-success); }
      .switch-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .switch-dot.on  { background: var(--nic-success); }
      .switch-dot.off { background: var(--nic-text3); }
      .switch-label { font-weight: 500; font-size: 12px; flex: 1; }
      .switch-trigger {
        margin-left: auto;
        background: var(--nic-accent);
        border: none;
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 11px;
        color: #fff;
        cursor: pointer;
        font-family: inherit;
        opacity: 0.85;
        transition: opacity 0.15s;
      }
      .switch-trigger:hover { opacity: 1; }

      /* Content */
      .content { padding: 16px; }

      /* User list */
      .user-list-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 12px;
      }
      .section-title {
        font-size: 11px; font-weight: 500;
        color: var(--nic-text2);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .btn-add {
        display: flex; align-items: center; gap: 5px;
        padding: 6px 12px;
        background: var(--nic-accent);
        color: #fff;
        border: none; border-radius: var(--nic-radius-sm);
        font-size: 12px; font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        transition: opacity 0.15s;
      }
      .btn-add:hover { opacity: 0.85; }

      .user-card {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 12px;
        background: var(--nic-bg2);
        border: 1px solid var(--nic-border);
        border-radius: var(--nic-radius-sm);
        margin-bottom: 8px;
        transition: border-color 0.15s;
        cursor: pointer;
      }
      .user-card:hover { border-color: var(--nic-accent); }
      .user-avatar {
        width: 36px; height: 36px;
        border-radius: 50%;
        background: var(--nic-accent);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: 500; flex-shrink: 0;
        text-transform: uppercase;
        color: #fff;
        opacity: 0.85;
      }
      .user-info { flex: 1; min-width: 0; }
      .user-name  { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--nic-text); }
      .user-meta  { font-size: 11px; color: var(--nic-text2); margin-top: 2px; }
      .user-badges { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
      .badge {
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
      }
      .badge-pin    { background: rgba(3,169,244,0.15);  color: var(--nic-accent); }
      .badge-code   { background: rgba(156,39,176,0.12); color: #9c27b0; }
      .badge-card   { background: rgba(255,152,0,0.12);  color: var(--nic-warn); }
      .badge-virt   { background: rgba(76,175,80,0.12);  color: var(--nic-success); }
      .user-actions { display: flex; gap: 6px; flex-shrink: 0; }
      .icon-btn {
        width: 30px; height: 30px;
        border-radius: 6px;
        border: 1px solid var(--nic-border);
        background: transparent;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px;
        transition: all 0.15s;
        color: var(--nic-text2);
      }
      .icon-btn:hover { border-color: var(--nic-text2); color: var(--nic-text); }

      .no-users {
        text-align: center; padding: 40px 20px;
        color: var(--nic-text2); font-size: 13px;
      }
      .no-users .icon { font-size: 40px; margin-bottom: 10px; }

      /* Form */
      .form-header {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 20px;
      }
      .back-btn {
        width: 30px; height: 30px;
        border-radius: 6px;
        border: 1px solid var(--nic-border);
        background: transparent;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 16px;
        color: var(--nic-text2);
        transition: all 0.15s;
      }
      .back-btn:hover { border-color: var(--nic-text2); color: var(--nic-text); }
      .form-title { font-size: 16px; font-weight: 500; color: var(--nic-text); }

      .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .form-group { display: flex; flex-direction: column; gap: 5px; }
      .form-group.span2 { grid-column: span 2; }
      .form-label {
        font-size: 11px; font-weight: 500;
        color: var(--nic-text2);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .form-input {
        padding: 8px 10px;
        background: var(--nic-bg2);
        border: 1px solid var(--nic-border);
        border-radius: var(--nic-radius-sm);
        color: var(--nic-text);
        font-size: 13px;
        font-family: inherit;
        transition: border-color 0.15s;
        outline: none;
        width: 100%;
      }
      .form-input:focus { border-color: var(--nic-accent); }
      .form-hint { font-size: 10px; color: var(--nic-text3); }

      .form-section-title {
        font-size: 11px; font-weight: 500;
        color: var(--nic-text2);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: 16px 0 10px;
        padding-top: 16px;
        border-top: 1px solid var(--nic-border);
      }

      .codes-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .code-label { font-size: 10px; color: var(--nic-text2); margin-bottom: 4px; }

      .form-actions {
        display: flex; gap: 8px; justify-content: flex-end;
        margin-top: 20px; padding-top: 16px;
        border-top: 1px solid var(--nic-border);
      }
      .btn {
        padding: 8px 16px;
        border-radius: var(--nic-radius-sm);
        font-size: 13px; font-weight: 500;
        cursor: pointer;
        border: none;
        font-family: inherit;
        transition: opacity 0.15s;
      }
      .btn-primary { background: var(--nic-accent); color: #fff; }
      .btn-primary:hover { opacity: 0.85; }
      .btn-danger  { background: var(--nic-danger); color: #fff; }
      .btn-danger:hover  { opacity: 0.85; }
      .btn-ghost   {
        background: transparent;
        color: var(--nic-text2);
        border: 1px solid var(--nic-border);
      }
      .btn-ghost:hover { border-color: var(--nic-text2); color: var(--nic-text); }
      .btn:disabled { opacity: 0.4; cursor: not-allowed; }

      /* Confirm dialog */
      .dialog-backdrop {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 1000;
        display: flex; align-items: center; justify-content: center;
      }
      .dialog {
        background: var(--nic-bg);
        border: 1px solid var(--nic-border);
        border-radius: var(--nic-radius);
        padding: 24px;
        max-width: 380px; width: 90%;
        box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,0.15));
        animation: fadeIn 0.15s ease;
      }
      .dialog-title { font-size: 16px; font-weight: 500; margin-bottom: 8px; color: var(--nic-text); }
      .dialog-body  { font-size: 13px; color: var(--nic-text2); margin-bottom: 20px; line-height: 1.5; }
      .dialog-name  { color: var(--nic-text); font-weight: 600; }
      .dialog-actions { display: flex; gap: 8px; justify-content: flex-end; }

      /* Toast */
      .toast {
        position: fixed; bottom: 20px; right: 20px;
        padding: 10px 14px;
        border-radius: var(--nic-radius-sm);
        font-size: 13px; font-weight: 500;
        z-index: 9999;
        animation: slideUp 0.2s ease;
        display: flex; align-items: center; gap: 8px;
        min-width: 200px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        color: #fff;
      }
      .toast.success { background: var(--nic-success); }
      .toast.error   { background: var(--nic-danger); }

      /* Loading spinner */
      .spinner {
        width: 14px; height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
        flex-shrink: 0;
        display: inline-block;
      }

      /* Stats row */
      .stats {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 1px;
        background: var(--nic-border);
        margin-bottom: 16px;
        border-radius: var(--nic-radius-sm);
        overflow: hidden;
        border: 1px solid var(--nic-border);
      }
      .stat {
        background: var(--nic-bg2);
        padding: 12px;
        text-align: center;
      }
      .stat-value { font-size: 20px; font-weight: 400; color: var(--nic-accent); }
      .stat-label { font-size: 10px; color: var(--nic-text2); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }

      /* Scroll */
      .user-scroll { max-height: 320px; overflow-y: auto; padding-right: 2px; }
      .user-scroll::-webkit-scrollbar { width: 4px; }
      .user-scroll::-webkit-scrollbar-track { background: transparent; }
      .user-scroll::-webkit-scrollbar-thumb { background: var(--nic-border); border-radius: 2px; }

      @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
      @keyframes spin   { to{transform:rotate(360deg)} }
      @keyframes fadeIn { from{opacity:0;transform:scale(0.97)} to{opacity:1;transform:scale(1)} }
      @keyframes slideUp{ from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card" id="card-root"></div>
        <div id="toast-container"></div>
        <div id="dialog-container"></div>
      </ha-card>
    `;
    this._updateDynamic();
  }

  _updateDynamic() {
    const root = this.shadowRoot?.getElementById("card-root");
    if (!root) return;

    const title   = this._config.title || "2N Intercom";
    const showCam = this._config.show_camera !== false;

    root.innerHTML = `
      ${this._renderHeader(title)}
      ${this._renderNav()}
      ${showCam && this._view === "dashboard" ? this._renderCamera() : ""}
      ${this._view === "dashboard" ? this._renderSwitches() : ""}
      <div class="content">
        ${this._view === "dashboard" ? this._renderDashboard() : ""}
        ${this._view === "users"     ? this._renderUserList()  : ""}
        ${this._view === "add_user"  ? this._renderUserForm(null) : ""}
        ${this._view === "edit_user" ? this._renderUserForm(this._editingUser) : ""}
      </div>
    `;

    this._attachListeners();

    // Auto-refresh camera
    if (showCam && this._view === "dashboard") {
      this._startCameraRefresh();
    } else {
      this._stopCameraRefresh();
    }
  }

  _renderHeader(title) {
    const d = this._hass?.states;
    const countEntity = d ? Object.entries(d).find(
      ([id]) => id.includes("user_count") &&
        (this._config.entity_prefix ? id.includes(this._config.entity_prefix.toLowerCase().replace(/ /g,"_")) : true)
    ) : null;
    const count = countEntity ? countEntity[1].state : this._users.length;

    return `
      <div class="header">
        <div class="header-left">
          <div class="header-icon">🔒</div>
          <div>
            <div class="header-title">${title}</div>
            <div class="header-sub">${count} users · ${this._switches.length} switch${this._switches.length !== 1 ? "es" : ""}</div>
          </div>
        </div>
      </div>
    `;
  }

  _renderNav() {
    const tabs = [
      { id: "dashboard", label: "Dashboard" },
      { id: "users",     label: `Users (${this._users.length})` },
    ];
    return `
      <div class="nav">
        ${tabs.map(t => `
          <button class="nav-btn ${this._view === t.id || (this._view === "add_user" && t.id === "users") || (this._view === "edit_user" && t.id === "users") ? "active" : ""}"
                  data-view="${t.id}">${t.label}</button>
        `).join("")}
      </div>
    `;
  }

  _renderCamera() {
    const url = this._getSnapshotUrl();
    if (!url) {
      return `
        <div class="camera-wrap">
          <div class="camera-no-feed">
            <div class="icon">📷</div>
            <div>No camera entity found</div>
            <div style="font-size:11px;margin-top:4px">Set camera_entity in card config</div>
          </div>
        </div>
      `;
    }
    return `
      <div class="camera-wrap">
        <img id="cam-img" src="${url}&_t=${Date.now()}" alt="Camera feed"
             onerror="this.style.opacity='0.3'" style="transition:opacity 0.3s" />
        <div class="camera-overlay"></div>
        <div class="camera-badge">
          <div class="live-dot"></div>
          LIVE
        </div>
        <button class="camera-refresh" id="cam-refresh" title="Refresh">⟳</button>
      </div>
    `;
  }

  _renderSwitches() {
    if (!this._switches.length) return "";
    return `
      <div class="switches">
        ${this._switches.map(sw => `
          <div class="switch-btn ${sw.state === "on" ? "on" : ""}" data-entity="${sw.entity_id}">
            <div class="switch-dot ${sw.state === "on" ? "on" : "off"}"></div>
            <span class="switch-label">${this._shortSwitchName(sw.name)}</span>
            <button class="switch-trigger" data-trigger="${sw.attributes.switch_id || 1}">TRIGGER</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  _shortSwitchName(name) {
    return name.replace(/.*switch\s*/i, "Switch ").replace(/2n intercom\s*/i, "");
  }

  _renderDashboard() {
    const withPin   = this._users.filter(u => u.attributes.has_pin).length;
    const withCodes = this._users.filter(u => (u.attributes.switch_code_slots || []).some(Boolean)).length;
    const withCard  = this._users.filter(u => u.attributes.has_card).length;

    return `
      <div class="stats">
        <div class="stat">
          <div class="stat-value">${this._users.length}</div>
          <div class="stat-label">Users</div>
        </div>
        <div class="stat">
          <div class="stat-value">${withPin}</div>
          <div class="stat-label">Have PIN</div>
        </div>
        <div class="stat">
          <div class="stat-value">${withCodes}</div>
          <div class="stat-label">Have Codes</div>
        </div>
      </div>
      <div class="user-list-header">
        <div class="section-title">Recent Users</div>
        <button class="btn-add" id="btn-add-dash">+ Add User</button>
      </div>
      <div class="user-scroll">
        ${this._users.slice(0, 5).map(u => this._renderUserCard(u)).join("") || this._renderNoUsers()}
      </div>
      ${this._users.length > 5 ? `<div style="text-align:center;margin-top:8px"><button class="nav-btn" data-view="users" style="font-size:11px">View all ${this._users.length} users →</button></div>` : ""}
    `;
  }

  _renderUserList() {
    return `
      <div class="user-list-header">
        <div class="section-title">${this._users.length} Directory Users</div>
        <button class="btn-add" id="btn-add-users">+ Add User</button>
      </div>
      <div class="user-scroll">
        ${this._users.map(u => this._renderUserCard(u)).join("") || this._renderNoUsers()}
      </div>
    `;
  }

  _renderUserCard(u) {
    const attrs = u.attributes || {};
    const slots = attrs.switch_code_slots || [];
    const initials = (u.name || "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
    const codeCount = slots.filter(Boolean).length;

    return `
      <div class="user-card" data-uuid="${u.uuid}">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">${u.name}</div>
          <div class="user-meta">${attrs.email || attrs.virt_number ? `${attrs.email || ""}${attrs.virt_number ? " · #" + attrs.virt_number : ""}` : attrs.uuid?.slice(0,8) || ""}</div>
          <div class="user-badges">
            ${attrs.has_pin  ? '<span class="badge badge-pin">PIN</span>' : ""}
            ${codeCount > 0  ? `<span class="badge badge-code">${codeCount} Code${codeCount > 1 ? "s" : ""}</span>` : ""}
            ${attrs.has_card ? '<span class="badge badge-card">Card</span>' : ""}
            ${attrs.virt_number ? `<span class="badge badge-virt">#${attrs.virt_number}</span>` : ""}
          </div>
        </div>
        <div class="user-actions">
          <button class="icon-btn edit"   data-action="edit"   data-uuid="${u.uuid}" title="Edit">✏️</button>
          <button class="icon-btn delete" data-action="delete" data-uuid="${u.uuid}" data-name="${u.name}" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  }

  _renderNoUsers() {
    return `
      <div class="no-users">
        <div class="icon">👤</div>
        <div>No users in directory</div>
        <div style="font-size:11px;margin-top:6px;color:var(--nic-text3)">Add your first user to get started</div>
      </div>
    `;
  }

  _renderUserForm(user) {
    const isEdit = !!user;
    const attrs  = user?.attributes || {};
    const codes  = attrs.switch_code_slots || [false, false, false, false];
    // Note: we never pre-fill actual code values (security) — user must re-enter codes to change them

    return `
      <div class="form-header">
        <button class="back-btn" id="btn-back">←</button>
        <div class="form-title">${isEdit ? `Edit: ${user.name}` : "Add New User"}</div>
      </div>

      ${isEdit ? `<input type="hidden" id="f-uuid" value="${user.uuid}">` : ""}

      <div class="form-grid">
        <div class="form-group span2">
          <label class="form-label">Full Name *</label>
          <input class="form-input" id="f-name" type="text" placeholder="Jane Smith" value="${isEdit ? user.name : ""}">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" id="f-email" type="email" placeholder="jane@example.com" value="${attrs.email || ""}">
        </div>
        <div class="form-group">
          <label class="form-label">Virtual Number</label>
          <input class="form-input" id="f-virt" type="text" placeholder="101" value="${attrs.virt_number || ""}">
          <span class="form-hint">Dial number on keypad</span>
        </div>
        <div class="form-group">
          <label class="form-label">SIP Call Peer</label>
          <input class="form-input" id="f-peer" type="text" placeholder="sip:100@192.168.1.10" value="${attrs.call_peers?.[0] || ""}">
        </div>
        <div class="form-group">
          <label class="form-label">Directory Path</label>
          <input class="form-input" id="f-tree" type="text" placeholder="/" value="${attrs.treepath || "/"}">
          <span class="form-hint">e.g. /Floor 1/ or /</span>
        </div>
      </div>

      <div class="form-section-title">Access Credentials</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">PIN Code</label>
          <input class="form-input" id="f-pin" type="password" placeholder="${isEdit && attrs.has_pin ? "••••  (leave blank to keep)" : "2–15 digits"}">
          <span class="form-hint">${isEdit && attrs.has_pin ? "Leave blank to keep existing PIN" : "2–15 digits"}</span>
        </div>
        <div class="form-group">
          <label class="form-label">Clear PIN</label>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;color:var(--nic-text2)">
            <input type="checkbox" id="f-clear-pin" style="accent-color:var(--accent)">
            Remove existing PIN
          </label>
        </div>
      </div>

      <div class="form-section-title">Switch Codes (for door triggers)</div>
      <div class="codes-grid">
        ${[1,2,3,4].map(i => `
          <div>
            <div class="code-label">Slot ${i} ${codes[i-1] ? "●" : "○"}</div>
            <input class="form-input" id="f-code-${i}" type="password"
                   placeholder="${codes[i-1] ? "••••" : "empty"}"
                   style="font-family:inherit">
          </div>
        `).join("")}
      </div>
      <div style="font-size:11px;color:var(--nic-text3);margin-top:6px">Leave blank to keep existing codes. Enter a space to clear a slot.</div>

      <div class="form-section-title">Access Validity (optional)</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Valid From</label>
          <input class="form-input" id="f-from" type="datetime-local"
                 value="${this._tsToLocal(attrs.valid_from)}">
          <span class="form-hint">Leave blank for always</span>
        </div>
        <div class="form-group">
          <label class="form-label">Valid Until</label>
          <input class="form-input" id="f-to" type="datetime-local"
                 value="${this._tsToLocal(attrs.valid_to)}">
          <span class="form-hint">Leave blank for no expiry</span>
        </div>
      </div>

      <div class="form-actions">
        ${isEdit ? `<button class="btn btn-danger" id="btn-delete-form" data-uuid="${user.uuid}" data-name="${user.name}">Delete User</button>` : ""}
        <button class="btn btn-ghost"   id="btn-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-save">
          <span id="btn-save-label">${isEdit ? "Save Changes" : "Create User"}</span>
        </button>
      </div>
    `;
  }

  _tsToLocal(ts) {
    if (!ts || ts === "0") return "";
    try {
      const d = new Date(parseInt(ts) * 1000);
      if (isNaN(d.getTime())) return "";
      return d.toISOString().slice(0, 16);
    } catch { return ""; }
  }

  _localToTs(val) {
    if (!val) return 0;
    try { return Math.floor(new Date(val).getTime() / 1000); } catch { return 0; }
  }

  // ── Event Listeners ───────────────────────────────────────────────────────

  _attachListeners() {
    const root = this.shadowRoot;

    // Nav tabs
    root.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        this._view = btn.dataset.view;
        this._editingUser = null;
        this._updateDynamic();
      });
    });

    // Add user buttons
    ["btn-add-dash", "btn-add-users"].forEach(id => {
      root.getElementById(id)?.addEventListener("click", () => {
        this._view = "add_user";
        this._editingUser = null;
        this._updateDynamic();
      });
    });

    // Back / cancel
    root.getElementById("btn-back")?.addEventListener("click", () => {
      this._view = "users";
      this._editingUser = null;
      this._updateDynamic();
    });
    root.getElementById("btn-cancel")?.addEventListener("click", () => {
      this._view = "users";
      this._editingUser = null;
      this._updateDynamic();
    });

    // Edit buttons
    root.querySelectorAll("[data-action='edit']").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const uuid = btn.dataset.uuid;
        this._editingUser = this._users.find(u => u.uuid === uuid);
        this._view = "edit_user";
        this._updateDynamic();
      });
    });

    // Delete buttons (from list)
    root.querySelectorAll("[data-action='delete']").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showDeleteDialog(btn.dataset.uuid, btn.dataset.name);
      });
    });

    // Delete from form
    root.getElementById("btn-delete-form")?.addEventListener("click", (e) => {
      this._showDeleteDialog(e.target.dataset.uuid, e.target.dataset.name);
    });

    // Save
    root.getElementById("btn-save")?.addEventListener("click", () => {
      this._handleSave();
    });

    // Camera refresh
    root.getElementById("cam-refresh")?.addEventListener("click", () => {
      this._refreshCamera();
    });

    // Switch trigger buttons
    root.querySelectorAll("[data-trigger]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const switchId = parseInt(btn.dataset.trigger);
        this._callService("2n_intercom", "trigger_switch", {
          switch_id: switchId,
          action: "trigger",
          ...(this._entryId ? { entry_id: this._entryId } : {}),
        });
        this._showToast("🔓 Switch triggered", "success");
      });
    });

    // Switch toggle
    root.querySelectorAll(".switch-btn[data-entity]").forEach(sw => {
      sw.addEventListener("click", (e) => {
        if (e.target.dataset.trigger) return; // handled above
        const entityId = sw.dataset.entity;
        const state    = this._hass?.states[entityId]?.state;
        const svc      = state === "on" ? "turn_off" : "turn_on";
        this._hass?.callService("switch", svc, {}, { entity_id: entityId });
      });
    });
  }

  // ── Save handler ──────────────────────────────────────────────────────────

  async _handleSave() {
    const root    = this.shadowRoot;
    const isEdit  = this._view === "edit_user";
    const uuid    = root.getElementById("f-uuid")?.value;

    const name    = root.getElementById("f-name")?.value?.trim();
    const email   = root.getElementById("f-email")?.value?.trim();
    const virt    = root.getElementById("f-virt")?.value?.trim();
    const peer    = root.getElementById("f-peer")?.value?.trim();
    const tree    = root.getElementById("f-tree")?.value?.trim() || "/";
    const pin     = root.getElementById("f-pin")?.value;
    const clearPin = root.getElementById("f-clear-pin")?.checked;
    const fromDt  = root.getElementById("f-from")?.value;
    const toDt    = root.getElementById("f-to")?.value;

    const codes = [1,2,3,4].map(i =>
      root.getElementById(`f-code-${i}`)?.value ?? ""
    );

    if (!name) {
      this._showToast("⚠️ Name is required", "error");
      return;
    }

    // Build service data
    const data = { user_name: name };
    if (this._entryId) data.entry_id = this._entryId;
    if (isEdit)        data.user_uuid = uuid;
    if (email)         data.user_email = email;
    if (virt)          data.virt_number = virt;
    if (peer)          data.call_peer = peer;
    if (tree)          data.treepath = tree;
    if (fromDt)        data.valid_from = this._localToTs(fromDt);
    if (toDt)          data.valid_to   = this._localToTs(toDt);

    // PIN handling
    if (clearPin) {
      data.pin = "";
    } else if (pin) {
      data.pin = pin;
    }

    // Switch codes — only include if user typed something
    const hasCodeInput = codes.some(c => c !== "");
    if (hasCodeInput) {
      data.switch_codes = codes.map(c => c === " " ? "" : c);  // space = clear
    }

    // Show loading state
    const saveBtn   = root.getElementById("btn-save");
    const saveLabel = root.getElementById("btn-save-label");
    if (saveBtn) saveBtn.disabled = true;
    if (saveLabel) saveLabel.innerHTML = '<div class="spinner"></div>';

    try {
      const service = isEdit ? "update_user" : "create_user";
      await this._callService("2n_intercom", service, data);
      this._showToast(isEdit ? "✅ User updated" : "✅ User created", "success");
      this._view = "users";
      this._editingUser = null;
      setTimeout(() => this._updateDynamic(), 1500);
    } catch (err) {
      this._showToast(`❌ Failed: ${err.message || err}`, "error");
      if (saveBtn)  saveBtn.disabled = false;
      if (saveLabel) saveLabel.textContent = isEdit ? "Save Changes" : "Create User";
    }
  }

  // ── Delete dialog ─────────────────────────────────────────────────────────

  _showDeleteDialog(uuid, name) {
    const container = this.shadowRoot.getElementById("dialog-container");
    container.innerHTML = `
      <div class="dialog-backdrop" id="dialog-backdrop">
        <div class="dialog">
          <div class="dialog-title">Delete User</div>
          <div class="dialog-body">
            Are you sure you want to remove <span class="dialog-name">${name}</span>
            from the 2N directory? This cannot be undone.
          </div>
          <div class="dialog-actions">
            <button class="btn btn-ghost" id="dialog-cancel">Cancel</button>
            <button class="btn btn-danger" id="dialog-confirm">Delete</button>
          </div>
        </div>
      </div>
    `;

    container.querySelector("#dialog-cancel").addEventListener("click", () => {
      container.innerHTML = "";
    });
    container.querySelector("#dialog-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "dialog-backdrop") container.innerHTML = "";
    });
    container.querySelector("#dialog-confirm").addEventListener("click", async () => {
      container.innerHTML = "";
      try {
        await this._callService("2n_intercom", "delete_user", {
          user_uuid: uuid,
          ...(this._entryId ? { entry_id: this._entryId } : {}),
        });
        this._showToast("🗑️ User deleted", "success");
        if (this._view === "edit_user") {
          this._view = "users";
          this._editingUser = null;
        }
        setTimeout(() => this._updateDynamic(), 1500);
      } catch (err) {
        this._showToast(`❌ Delete failed: ${err.message || err}`, "error");
      }
    });
  }

  // ── Camera refresh ────────────────────────────────────────────────────────

  _startCameraRefresh() {
    this._stopCameraRefresh();
    this._cameraRefresh = setInterval(() => this._refreshCamera(), 5000);
  }

  _stopCameraRefresh() {
    if (this._cameraRefresh) {
      clearInterval(this._cameraRefresh);
      this._cameraRefresh = null;
    }
  }

  _refreshCamera() {
    const img = this.shadowRoot?.getElementById("cam-img");
    if (img) {
      const base = img.src.split("&_t=")[0];
      img.src    = `${base}&_t=${Date.now()}`;
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  _showToast(message, type = "success") {
    const container = this.shadowRoot.getElementById("toast-container");
    const toast     = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ── HA service call ───────────────────────────────────────────────────────

  _callService(domain, service, data) {
    if (!this._hass) return Promise.reject(new Error("HA not connected"));
    return this._hass.callService(domain, service, data);
  }

  // ── Card config ───────────────────────────────────────────────────────────

  static getConfigElement() {
    return document.createElement("div");
  }

  static getStubConfig() {
    return {
      type: "custom:twon-intercom-card",
      entity_prefix: "",
      title: "2N Intercom",
      show_camera: true,
    };
  }

  getCardSize() { return 8; }

  disconnectedCallback() {
    this._stopCameraRefresh();
  }
}

customElements.define("twon-intercom-card", TwoNIntercomCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type:        "twon-intercom-card",
  name:        "2N Intercom Manager",
  description: "Manage 2N IP intercom users, camera, and door switches",
  preview:     false,
});
