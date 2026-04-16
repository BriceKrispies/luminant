/**
 * Studio web components — reusable, self-contained controls.
 *
 * All controls extend StudioControl and emit `studio-change` events
 * with `{ name, value }` detail. Any control can be swapped for any
 * other in the same slot (Liskov) — the parent only cares about
 * the event shape, not the control type.
 */

// ── Format helper ──

function formatValue(v, fmt) {
  if (!fmt) return String(v);
  if (fmt === '%') return Math.round(v * 100) + '%';
  const m = fmt.match(/^\.?(\d+)(?:\|(.+))?$/);
  if (m) return Number(v).toFixed(parseInt(m[1], 10)) + (m[2] || '');
  return v + fmt;
}

// ── Tag color helper (bone dots) ──

function boneColor(tags) {
  if (tags.includes('anchor')) return '#999';
  if (tags.includes('face'))   return '#ffdc3c';
  if (tags.includes('accent')) return '#b450ff';
  return '#50b4ff';
}

// ── Base class ──

class StudioControl extends HTMLElement {
  get name() { return this.getAttribute('name'); }

  emit(value) {
    this.dispatchEvent(new CustomEvent('studio-change', {
      detail: { name: this.name, value },
      bubbles: true,
      composed: true,
    }));
  }
}

// ── <studio-panel label="..."> ──

class StudioPanel extends HTMLElement {
  constructor() {
    super();
    const s = this.attachShadow({ mode: 'open' });
    s.innerHTML = `
<style>
  :host {
    display: block;
    border: 1px solid var(--sp-border, #2a2a30);
    border-radius: 5px;
    overflow: hidden;
  }
  header {
    display: flex; align-items: center; gap: 6px;
    padding: 7px 10px;
    background: var(--sp-header-bg, #1e1e24);
    cursor: pointer; user-select: none;
    font: 600 11px/1 var(--studio-font, system-ui);
    text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--sp-header-color, #999);
  }
  header:hover { background: #242430; color: #bbb; }
  .arrow {
    font-size: 8px; color: #666;
    transition: transform 0.15s;
  }
  :host([collapsed]) .arrow { transform: rotate(-90deg); }
  :host([collapsed]) .body  { display: none; }
  .body {
    padding: 8px 10px;
    display: flex; flex-direction: column; gap: 6px;
  }
</style>
<header part="header">
  <span class="arrow">\u25BC</span>
  <span class="label"></span>
</header>
<div class="body" part="body"><slot></slot></div>`;
    s.querySelector('header').addEventListener('click', () => {
      this.toggleAttribute('collapsed');
    });
  }

  connectedCallback() {
    this.shadowRoot.querySelector('.label').textContent =
      this.getAttribute('label') || '';
  }
}

// ── <studio-slider name label min max step value format disabled> ──

class StudioSlider extends StudioControl {
  constructor() {
    super();
    const s = this.attachShadow({ mode: 'open' });
    s.innerHTML = `
<style>
  :host { display: flex; align-items: center; gap: 6px; }
  label {
    font: 11px var(--studio-font, system-ui);
    width: 64px; flex-shrink: 0;
    color: var(--ss-label, #999);
  }
  input[type="range"] {
    flex: 1; height: 14px;
    accent-color: var(--studio-accent, #5a8abf);
  }
  .val {
    font: 10px var(--studio-font, system-ui);
    color: #777; width: 36px; text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
<label part="label"></label>
<input type="range" part="input">
<span class="val" part="value"></span>`;
    this._input = s.querySelector('input');
    this._val   = s.querySelector('.val');
    this._label = s.querySelector('label');

    this._input.addEventListener('input', () => {
      const v = parseFloat(this._input.value);
      this._val.textContent = formatValue(v, this.getAttribute('format'));
      this.emit(v);
    });
  }

  connectedCallback() {
    const a = (k, fallback) => this.getAttribute(k) ?? fallback;
    this._label.textContent = a('label', '');
    this._input.min      = a('min', '0');
    this._input.max      = a('max', '1');
    this._input.step     = a('step', '1');
    this._input.value    = a('value', '0');
    this._input.disabled = this.hasAttribute('disabled');
    this._val.textContent = formatValue(
      parseFloat(this._input.value), this.getAttribute('format')
    );
  }

  get value()    { return parseFloat(this._input.value); }
  set value(v)   {
    this._input.value = v;
    this._val.textContent = formatValue(v, this.getAttribute('format'));
  }
  get disabled() { return this._input.disabled; }
  set disabled(v){ this._input.disabled = v; }
}

// ── <studio-toggle name label checked> ──

class StudioToggle extends StudioControl {
  constructor() {
    super();
    const s = this.attachShadow({ mode: 'open' });
    s.innerHTML = `
<style>
  :host { display: flex; align-items: center; gap: 6px; }
  label {
    font: 11px var(--studio-font, system-ui);
    cursor: pointer;
  }
  input {
    accent-color: var(--studio-accent, #5a8abf);
    width: 13px; height: 13px; cursor: pointer;
  }
</style>
<input type="checkbox" part="input">
<label part="label"></label>`;
    this._input = s.querySelector('input');
    this._labelEl = s.querySelector('label');

    this._input.addEventListener('change', () => this.emit(this._input.checked));
    this._labelEl.addEventListener('click', () => {
      this._input.checked = !this._input.checked;
      this.emit(this._input.checked);
    });
  }

  connectedCallback() {
    this._labelEl.textContent = this.getAttribute('label') || '';
    this._input.checked = this.hasAttribute('checked');
  }

  get checked()  { return this._input.checked; }
  set checked(v) { this._input.checked = v; }
}

// ── <studio-select name label> with <option> children ──

class StudioSelect extends StudioControl {
  constructor() {
    super();
    const s = this.attachShadow({ mode: 'open' });
    s.innerHTML = `
<style>
  :host { display: block; }
  .label {
    font: 600 10px/1 var(--studio-font, system-ui);
    text-transform: uppercase; letter-spacing: 0.4px;
    color: #666; margin-bottom: 4px;
  }
  .label:empty { display: none; }
  .buttons { display: flex; gap: 3px; flex-wrap: wrap; }
  button {
    padding: 4px 8px;
    background: #2a2a30; border: 1px solid #444; border-radius: 3px;
    color: #ccc; font: 11px var(--studio-font, system-ui);
    cursor: pointer; transition: all 0.1s;
  }
  button:hover { background: #3a3a42; border-color: #666; }
  button[aria-pressed="true"] {
    background: #3a5a8a; border-color: #5a8abf; color: #fff;
  }
</style>
<div class="label" part="label"></div>
<div class="buttons" part="buttons"></div>`;
    this._buttons = s.querySelector('.buttons');
    this._labelEl = s.querySelector('.label');
    this._value = null;

    this._buttons.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      this.value = btn.dataset.value;
      this.emit(this._value);
    });
  }

  connectedCallback() {
    this._labelEl.textContent = this.getAttribute('label') || '';
    this._buildFromChildren();
  }

  _buildFromChildren() {
    const opts = this.querySelectorAll('option');
    if (!opts.length) return;
    this._buttons.innerHTML = '';
    for (const opt of opts) {
      const btn = document.createElement('button');
      btn.dataset.value = opt.value;
      btn.textContent = opt.textContent;
      const sel = opt.hasAttribute('selected');
      btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
      if (sel) this._value = opt.value;
      this._buttons.appendChild(btn);
    }
  }

  /** Programmatic option replacement (e.g., archetypes from JS data). */
  setOptions(opts, selectedValue) {
    this._buttons.innerHTML = '';
    for (const { value, label } of opts) {
      const btn = document.createElement('button');
      btn.dataset.value = value;
      btn.textContent = label;
      btn.setAttribute('aria-pressed',
        value === selectedValue ? 'true' : 'false');
      this._buttons.appendChild(btn);
    }
    this._value = selectedValue ?? opts[0]?.value ?? null;
  }

  get value() { return this._value; }
  set value(v) {
    this._value = v;
    for (const btn of this._buttons.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed',
        btn.dataset.value === v ? 'true' : 'false');
    }
  }
}

// ── <studio-bone-list name> ──

class StudioBoneList extends StudioControl {
  constructor() {
    super();
    const s = this.attachShadow({ mode: 'open' });
    this._visibility = {};
    s.innerHTML = `
<style>
  :host { display: block; }
  :host([hidden]) { display: none; }
  .header {
    font: 600 10px/1 var(--studio-font, system-ui);
    text-transform: uppercase; letter-spacing: 0.4px;
    color: #666; margin-bottom: 4px;
  }
  .actions { display: flex; gap: 3px; margin-bottom: 4px; }
  .actions button {
    padding: 2px 6px;
    font: 10px var(--studio-font, system-ui);
    background: #2a2a30; border: 1px solid #444; border-radius: 3px;
    color: #ccc; cursor: pointer;
  }
  .actions button:hover { background: #3a3a42; border-color: #666; }
  .list {
    display: flex; flex-direction: column; gap: 2px;
    max-height: 180px; overflow-y: auto;
    padding: 4px; background: #151518; border-radius: 3px;
  }
  .list::-webkit-scrollbar { width: 4px; }
  .list::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
  .bone {
    display: flex; align-items: center; gap: 5px;
    font: 10px var(--studio-font, system-ui);
    padding: 1px 0; color: #aaa; cursor: pointer;
  }
  .bone input {
    accent-color: var(--studio-accent, #5a8abf);
    width: 12px; height: 12px;
  }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    flex-shrink: 0;
  }
</style>
<div class="header">Bone Visibility</div>
<div class="actions">
  <button data-action="all">All</button>
  <button data-action="none">None</button>
  <button data-action="invert">Invert</button>
</div>
<div class="list"></div>`;
    this._list = s.querySelector('.list');

    s.querySelector('.actions').addEventListener('click', (e) => {
      const a = e.target.dataset.action;
      if (a === 'all')    this._setAll(true);
      if (a === 'none')   this._setAll(false);
      if (a === 'invert') this._invert();
    });
  }

  get visibility() { return this._visibility; }

  setBones(bones) {
    this._list.innerHTML = '';
    this._visibility = {};
    for (const bone of bones) {
      this._visibility[bone.name] = true;
      const row = document.createElement('label');
      row.className = 'bone';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.bone = bone.name;
      cb.addEventListener('change', () => {
        this._visibility[bone.name] = cb.checked;
        this._emitAll();
      });

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = boneColor(bone.tags);

      const span = document.createElement('span');
      span.textContent = bone.name;

      row.append(cb, dot, span);
      this._list.appendChild(row);
    }
    this._emitAll();
  }

  _emitAll() { this.emit({ ...this._visibility }); }

  _setAll(val) {
    for (const k in this._visibility) this._visibility[k] = val;
    for (const cb of this._list.querySelectorAll('input')) cb.checked = val;
    this._emitAll();
  }

  _invert() {
    for (const k in this._visibility) this._visibility[k] = !this._visibility[k];
    for (const cb of this._list.querySelectorAll('input'))
      cb.checked = this._visibility[cb.dataset.bone];
    this._emitAll();
  }
}

// ── Register ──

customElements.define('studio-panel',     StudioPanel);
customElements.define('studio-slider',    StudioSlider);
customElements.define('studio-toggle',    StudioToggle);
customElements.define('studio-select',    StudioSelect);
customElements.define('studio-bone-list', StudioBoneList);
