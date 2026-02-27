const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace")
);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

const MODE_COLOURS = {
  load_first: "#4CAF50",
  battery_first: "#2196F3",
  grid_first: "#FF9800",
};

const MODE_LABELS = {
  load_first: "Load First",
  battery_first: "Battery First",
  grid_first: "Grid First",
};

const TOTAL_MINUTES = 24 * 60;

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minutesToPct(minutes) {
  return (minutes / TOTAL_MINUTES) * 100;
}

class GrowattTouScheduleCard extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      _config: { state: true },
      _segments: { state: true },
      _selectedSegmentId: { state: true },
      _loading: { state: true },
      _error: { state: true },
      _saveStatus: { state: true },
      _editValues: { state: true },
      _validationError: { state: true },
      _refreshStatus: { state: true },
    };
  }

  static getConfigForm() {
    return {
      schema: [
        {
          name: "device_id",
          required: true,
          selector: {
            device: {
              filter: [{ integration: "growatt_server" }],
            },
          },
        },
        {
          name: "title",
          selector: { text: {} },
        },
      ],
    };
  }

  static getStubConfig() {
    return { device_id: "", title: "TOU Schedule" };
  }

  constructor() {
    super();
    this._segments = [];
    this._selectedSegmentId = null;
    this._loading = false;
    this._error = null;
    this._saveStatus = null;
    this._editValues = {};
    this._validationError = null;
    this._refreshStatus = null;
  }

  setConfig(config) {
    this._config = { title: "TOU Schedule", ...config };
  }

  getCardSize() {
    return this._selectedSegmentId ? 5 : 3;
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!oldHass && hass && this._config?.device_id) {
      this._loadSegments();
    }
  }

  get hass() {
    return this._hass;
  }

  async _loadSegments(showRefreshStatus = false) {
    if (!this._config?.device_id || !this._hass) return;
    this._loading = true;
    this._error = null;
    try {
      const result = await this._hass.callService(
        "growatt_server",
        "read_time_segments",
        { device_id: this._config.device_id },
        undefined,
        false,
        true
      );
      this._segments = result.response?.time_segments ?? [];
      if (showRefreshStatus) {
        this._selectedSegmentId = null;
        this._editValues = {};
        this._saveStatus = null;
        this._validationError = null;
        this._refreshStatus = "done";
        setTimeout(() => {
          this._refreshStatus = null;
        }, 1500);
      }
    } catch (e) {
      this._error = e.message || "Failed to load segments";
    }
    this._loading = false;
  }

  _closeEditForm() {
    this._selectedSegmentId = null;
    this._editValues = {};
    this._saveStatus = null;
    this._validationError = null;
  }

  _selectSegment(segmentId) {
    if (this._selectedSegmentId === segmentId) {
      this._closeEditForm();
      return;
    }
    this._selectedSegmentId = segmentId;
    this._saveStatus = null;
    this._validationError = null;
    const seg = this._segments.find((s) => s.segment_id === segmentId);
    if (seg) {
      this._editValues = { ...seg };
    }
  }

  _isSpareSlot(seg) {
    return seg.start_time === "00:00" && seg.end_time === "00:00";
  }

  _addSegment() {
    const spare = this._segments.find((s) => this._isSpareSlot(s));
    if (!spare) return;
    this._selectedSegmentId = spare.segment_id;
    this._saveStatus = null;
    this._validationError = null;
    this._editValues = {
      segment_id: spare.segment_id,
      batt_mode: "load_first",
      enabled: true,
      start_time: "08:00",
      end_time: "08:05",
    };
  }

  async _saveSegment() {
    if (!this._editValues || !this._hass) return;
    const startMin = timeToMinutes(this._editValues.start_time);
    const endMin = timeToMinutes(this._editValues.end_time);
    if (endMin - startMin < 5) {
      this._validationError = "End time must be at least 5 minutes after start time";
      return;
    }
    this._validationError = null;
    this._saveStatus = "saving";
    try {
      await this._hass.callService(
        "growatt_server",
        "update_time_segment",
        {
          device_id: this._config.device_id,
          segment_id: this._editValues.segment_id,
          batt_mode: this._editValues.batt_mode,
          start_time: this._editValues.start_time,
          end_time: this._editValues.end_time,
          enabled: this._editValues.enabled,
        }
      );
      this._saveStatus = "success";
      await this._loadSegments();
      // Re-sync edit values with refreshed data
      const updated = this._segments.find(
        (s) => s.segment_id === this._selectedSegmentId
      );
      if (updated) this._editValues = { ...updated };
      setTimeout(() => {
        this._saveStatus = null;
      }, 2000);
    } catch (e) {
      this._saveStatus = "error: " + (e.message || "Save failed");
    }
  }

  _renderTimeline() {
    const blocks = [];
    for (const seg of this._segments) {
      const start = timeToMinutes(seg.start_time);
      const end = timeToMinutes(seg.end_time);

      // Skip empty segments (00:00–00:00) on the timeline
      if (start === 0 && end === 0) continue;

      const colour = MODE_COLOURS[seg.batt_mode] || "#999";
      const selected = seg.segment_id === this._selectedSegmentId;
      const opacity = seg.enabled ? 1 : 0.3;

      if (start < end) {
        // Normal segment
        blocks.push(html`
          <div
            class="seg-block ${selected ? "selected" : ""}"
            style="left:${minutesToPct(start)}%;width:${minutesToPct(
              end - start
            )}%;background:${colour};opacity:${opacity};"
            @click=${(e) => { e.stopPropagation(); this._selectSegment(seg.segment_id); }}
            title="Slot ${seg.segment_id}: ${seg.start_time}–${seg.end_time} (${MODE_LABELS[seg.batt_mode]})"
          >
            ${seg.enabled ? "" : html`<div class="hatched"></div>`}
            <span class="seg-label">${seg.segment_id}</span>
          </div>
        `);
      } else if (start > end) {
        // Overnight segment — render as two blocks
        blocks.push(html`
          <div
            class="seg-block ${selected ? "selected" : ""}"
            style="left:${minutesToPct(start)}%;width:${minutesToPct(
              TOTAL_MINUTES - start
            )}%;background:${colour};opacity:${opacity};"
            @click=${(e) => { e.stopPropagation(); this._selectSegment(seg.segment_id); }}
            title="Slot ${seg.segment_id}: ${seg.start_time}–${seg.end_time} (${MODE_LABELS[seg.batt_mode]})"
          >
            ${seg.enabled ? "" : html`<div class="hatched"></div>`}
            <span class="seg-label">${seg.segment_id}</span>
          </div>
          <div
            class="seg-block ${selected ? "selected" : ""}"
            style="left:0%;width:${minutesToPct(
              end
            )}%;background:${colour};opacity:${opacity};"
            @click=${(e) => { e.stopPropagation(); this._selectSegment(seg.segment_id); }}
            title="Slot ${seg.segment_id}: ${seg.start_time}–${seg.end_time} (overnight)"
          >
            ${seg.enabled ? "" : html`<div class="hatched"></div>`}
          </div>
        `);
      }
    }

    return html`
      <div class="timeline-container">
        <div class="timeline">${blocks}</div>
        <div class="hour-markers">
          <span style="left:0%">0</span>
          <span style="left:25%">6</span>
          <span style="left:50%">12</span>
          <span style="left:75%">18</span>
          <span style="left:100%">24</span>
        </div>
      </div>
    `;
  }

  _renderEditForm() {
    if (!this._selectedSegmentId) return "";
    const ev = this._editValues;
    if (!ev.segment_id) return "";

    const originalSeg = this._segments.find((s) => s.segment_id === ev.segment_id);
    const isSpare = originalSeg && this._isSpareSlot(originalSeg);
    const formTitle = isSpare ? `New Slot ${ev.segment_id}` : `Slot ${ev.segment_id}`;
    const hasUnsavedChanges = originalSeg && (
      ev.start_time !== originalSeg.start_time ||
      ev.end_time !== originalSeg.end_time ||
      ev.batt_mode !== originalSeg.batt_mode ||
      ev.enabled !== originalSeg.enabled
    );
    const closeLabel = hasUnsavedChanges ? "Discard" : "Close";

    return html`
      <div class="edit-form" @click=${(e) => e.stopPropagation()}>
        <div class="form-header">
          <div class="form-title">${formTitle}</div>
        </div>
        <div class="form-row">
          <label>Start Time</label>
          <input
            type="time"
            .value=${ev.start_time}
            @change=${(e) => {
              this._editValues = { ...this._editValues, start_time: e.target.value };
              this._validationError = null;
            }}
          />
        </div>
        <div class="form-row">
          <label>End Time</label>
          <input
            type="time"
            .value=${ev.end_time}
            @change=${(e) => {
              this._editValues = { ...this._editValues, end_time: e.target.value };
              this._validationError = null;
            }}
          />
        </div>
        ${this._validationError
          ? html`<div class="validation-error">${this._validationError}</div>`
          : ""}
        <div class="form-row">
          <label>Mode</label>
          <select
            .value=${ev.batt_mode}
            @change=${(e) => {
              this._editValues = { ...this._editValues, batt_mode: e.target.value };
            }}
          >
            <option value="load_first" ?selected=${ev.batt_mode === "load_first"}>Load First</option>
            <option value="battery_first" ?selected=${ev.batt_mode === "battery_first"}>Battery First</option>
            <option value="grid_first" ?selected=${ev.batt_mode === "grid_first"}>Grid First</option>
          </select>
        </div>
        <div class="form-row">
          <label>Enabled</label>
          <ha-switch
            .checked=${ev.enabled}
            @change=${(e) => {
              this._editValues = { ...this._editValues, enabled: e.target.checked };
            }}
          ></ha-switch>
        </div>
        <div class="form-actions">
          ${this._saveStatus === "success"
            ? html`<span class="status-success">Saved!</span>`
            : ""}
          ${this._saveStatus?.startsWith("error")
            ? html`<span class="status-error">${this._saveStatus}</span>`
            : ""}
          <button class="close-btn" @click=${() => this._closeEditForm()}>
            <ha-icon icon="mdi:close"></ha-icon>
            <span>${closeLabel}</span>
          </button>
          <ha-icon-button @click=${() => this._saveSegment()}>
            <ha-icon icon=${this._saveStatus === "saving" ? "mdi:loading" : "mdi:content-save"}></ha-icon>
          </ha-icon-button>
        </div>
      </div>
    `;
  }

  _renderLegend() {
    return html`
      <div class="legend">
        ${Object.entries(MODE_LABELS).map(
          ([mode, label]) => html`
            <span class="legend-item">
              <span
                class="legend-dot"
                style="background:${MODE_COLOURS[mode]}"
              ></span>
              ${label}
            </span>
          `
        )}
      </div>
    `;
  }

  render() {
    if (!this._config?.device_id) {
      return html`
        <ha-card header="TOU Schedule">
          <div class="card-content">
            <p>Please configure a Growatt device in card settings.</p>
          </div>
        </ha-card>
      `;
    }

    return html`
      <ha-card header=${this._config.title}>
        <div class="card-content" @click=${() => { if (this._selectedSegmentId) this._closeEditForm(); }}>
          ${this._loading ? html`<ha-circular-progress indeterminate size="small"></ha-circular-progress>` : ""}
          ${this._error ? html`<div class="error">${this._error}</div>` : ""}
          ${this._renderLegend()}
          ${this._renderTimeline()}
          ${this._segments.some((s) => this._isSpareSlot(s))
            ? html`<div class="add-btn" @click=${(e) => { e.stopPropagation(); this._addSegment(); }}>
                <ha-icon icon="mdi:plus"></ha-icon>
                <span>Add Slot</span>
              </div>`
            : ""}
          ${this._renderEditForm()}
        </div>
        <div class="card-actions">
          <mwc-button @click=${() => this._loadSegments(true)}>Refresh</mwc-button>
          ${this._refreshStatus === "done"
            ? html`<span class="refresh-status">Refreshed</span>`
            : ""}
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host {
        --tl-height: 40px;
      }
      .card-content {
        padding: 16px;
      }
      .legend {
        display: flex;
        gap: 16px;
        margin-bottom: 8px;
        font-size: 12px;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .legend-dot {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 2px;
      }
      .timeline-container {
        position: relative;
        margin-bottom: 16px;
      }
      .timeline {
        position: relative;
        height: var(--tl-height);
        background: var(--divider-color, #e0e0e0);
        border-radius: 4px;
        overflow: hidden;
      }
      .seg-block {
        position: absolute;
        top: 0;
        height: 100%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: outline 0.15s;
        min-width: 2px;
        box-sizing: border-box;
      }
      .seg-block.selected {
        outline: 3px solid var(--primary-color, #03a9f4);
        outline-offset: -1px;
        z-index: 1;
      }
      .seg-block:hover {
        filter: brightness(1.15);
      }
      .seg-label {
        font-size: 11px;
        font-weight: bold;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        pointer-events: none;
      }
      .hatched {
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
          45deg,
          transparent,
          transparent 3px,
          rgba(0, 0, 0, 0.2) 3px,
          rgba(0, 0, 0, 0.2) 6px
        );
        pointer-events: none;
      }
      .hour-markers {
        position: relative;
        height: 16px;
        font-size: 10px;
        color: var(--secondary-text-color, #666);
      }
      .hour-markers span {
        position: absolute;
        transform: translateX(-50%);
      }
      .edit-form {
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 8px;
        padding: 16px;
        margin-top: 8px;
      }
      .form-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .form-title {
        font-weight: bold;
      }
      .form-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .form-row label {
        font-size: 14px;
        min-width: 80px;
      }
      .form-row input[type="time"],
      .form-row select {
        padding: 6px 8px;
        border: 1px solid var(--divider-color, #ccc);
        border-radius: 4px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #000);
        font-size: 14px;
      }
      .form-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 12px;
      }
      .validation-error {
        color: #f44336;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .add-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        margin-top: 8px;
        cursor: pointer;
        font-size: 14px;
        color: var(--primary-color, #03a9f4);
      }
      .add-btn:hover {
        opacity: 0.8;
      }
      .close-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--secondary-text-color, #666);
        font-size: 13px;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .close-btn:hover {
        background: var(--divider-color, #e0e0e0);
      }
      .refresh-status {
        color: #4caf50;
        font-size: 14px;
      }
      .status-success {
        color: #4caf50;
        font-size: 14px;
      }
      .status-error {
        color: #f44336;
        font-size: 14px;
      }
      .error {
        color: #f44336;
        margin-bottom: 8px;
      }
      .card-actions {
        padding: 8px;
        display: flex;
        justify-content: flex-end;
      }
    `;
  }
}

customElements.define("growatt-tou-schedule-card", GrowattTouScheduleCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "growatt-tou-schedule-card",
  name: "Growatt TOU Schedule",
  description: "Manage Time of Use battery charge/discharge schedules for Growatt MIN inverters",
  preview: false,
});

console.info(
  "%c GROWATT-TOU-SCHEDULE-CARD %c loaded ",
  "color: white; background: #4CAF50; font-weight: bold;",
  ""
);
