/* =========================================================================
 *  VOXELCRAFT — Interface utilisateur
 *  Inventaire (drag & drop, clic droit = moitié), établi 2×2/3×3, fourneau,
 *  HUD dessiné en DOM/canvas. Les icônes proviennent de l'atlas procédural.
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const C = root.VCCraft;
  const B = V.B, I = V.I;

  const ATLAS_PX = 256, TILE = 16, COLS = 16;

  /* ------------------------------------------------------- Inventaire -- */
  function Inventory(size) {
    this.size = size;
    this.slots = new Array(size).fill(null);   // {id, n, dur?}
  }
  Inventory.prototype.get = function (i) { return this.slots[i]; };
  Inventory.prototype.set = function (i, s) { this.slots[i] = s; };
  Inventory.prototype.count = function (id) {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.slots[i] && this.slots[i].id === id) n += this.slots[i].n;
    return n;
  };
  /** Ajoute en empilant d'abord ; retourne le reste non placé. */
  Inventory.prototype.add = function (id, n, preferStart, preferEnd) {
    const max = V.maxStack(id);
    const s0 = preferStart || 0, s1 = preferEnd === undefined ? this.size : preferEnd;
    // 1) empilement
    for (let pass = 0; pass < 2 && n > 0; pass++) {
      const from = pass === 0 ? s0 : 0, to = pass === 0 ? s1 : this.size;
      for (let i = from; i < to && n > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.n < max) {
          const add = Math.min(max - s.n, n);
          s.n += add; n -= add;
        }
      }
    }
    // 2) cases vides
    for (let pass = 0; pass < 2 && n > 0; pass++) {
      const from = pass === 0 ? s0 : 0, to = pass === 0 ? s1 : this.size;
      for (let i = from; i < to && n > 0; i++) {
        if (!this.slots[i]) {
          const add = Math.min(max, n);
          this.slots[i] = { id, n: add };
          n -= add;
        }
      }
    }
    return n;
  };
  Inventory.prototype.remove = function (i, n) {
    const s = this.slots[i];
    if (!s) return 0;
    const take = Math.min(s.n, n);
    s.n -= take;
    if (s.n <= 0) this.slots[i] = null;
    return take;
  };
  Inventory.prototype.consume = function (id, n) {
    for (let i = 0; i < this.size && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) n -= this.remove(i, n);
    }
    return n === 0;
  };
  Inventory.prototype.serialize = function () {
    return this.slots.map(s => s ? [s.id, s.n, s.dur || 0] : 0);
  };
  Inventory.prototype.deserialize = function (a) {
    for (let i = 0; i < this.size; i++) {
      const v = a[i];
      this.slots[i] = (v && v !== 0) ? { id: v[0], n: v[1], dur: v[2] || 0 } : null;
    }
  };

  /* ------------------------------------------------------------- UI ---- */
  function UI(game) {
    this.game = game;
    this.atlasCanvas = null;
    this.cursor = null;          // pile tenue par la souris
    this.open = null;            // null | 'inventory' | 'crafting' | 'furnace' | 'chest'
    this.craftGrid = new Array(9).fill(null);
    this.craftSize = 2;
    this.craftOut = null;
    this.furnace = null;         // référence au bloc fourneau actif
    this.hoverSlot = null;
    this.el = {};
    this.recipeFilter = '';
  }

  UI.prototype.init = function (atlasCanvas) {
    this.atlasCanvas = atlasCanvas;
    this.el.root = document.getElementById('ui-root');
    this.el.hotbar = document.getElementById('hotbar');
    this.el.panel = document.getElementById('panel');
    this.el.panelBody = document.getElementById('panel-body');
    this.el.panelTitle = document.getElementById('panel-title');
    this.el.cursor = document.getElementById('drag-cursor');
    this.el.tooltip = document.getElementById('tooltip');
    this.buildHotbar();
    const self = this;
    document.addEventListener('mousemove', e => {
      if (self.cursor) {
        self.el.cursor.style.left = (e.clientX - 20) + 'px';
        self.el.cursor.style.top = (e.clientY - 20) + 'px';
      }
      if (self.el.tooltip.style.display === 'block') {
        self.el.tooltip.style.left = (e.clientX + 16) + 'px';
        self.el.tooltip.style.top = (e.clientY + 14) + 'px';
      }
    });
  };

  /** Style CSS positionnant l'atlas pour afficher une tuile donnée. */
  UI.prototype.iconStyle = function (tile, px) {
    const tx = tile % COLS, ty = (tile / COLS) | 0;
    const scale = px / TILE;
    return `background-image:url(${this.atlasURL});` +
      `background-size:${ATLAS_PX * scale}px ${ATLAS_PX * scale}px;` +
      `background-position:${-tx * TILE * scale}px ${-ty * TILE * scale}px;` +
      `width:${px}px;height:${px}px;image-rendering:pixelated;`;
  };

  UI.prototype.setAtlasURL = function (url) { this.atlasURL = url; };

  UI.prototype.slotHTML = function (stack, px) {
    if (!stack) return '';
    const tile = V.itemTile(stack.id);
    let h = `<div class="icon" style="${this.iconStyle(tile, px || 34)}"></div>`;
    if (stack.n > 1) h += `<span class="cnt">${stack.n}</span>`;
    if (stack.dur && stack.dur > 0) {
      const it = V.items[stack.id];
      if (it && it.durability) {
        const p = 1 - stack.dur / it.durability;
        const col = p > 0.5 ? '#4caf50' : p > 0.25 ? '#ffc107' : '#f44336';
        h += `<div class="dur"><i style="width:${(p * 100).toFixed(0)}%;background:${col}"></i></div>`;
      }
    }
    return h;
  };

  /* -------------------------------------------------------- Hotbar ----- */
  UI.prototype.buildHotbar = function () {
    const el = this.el.hotbar;
    el.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'hslot';
      d.dataset.i = i;
      el.appendChild(d);
    }
  };
  UI.prototype.refreshHotbar = function () {
    const inv = this.game.player.inv;
    const sel = this.game.player.selected;
    const kids = this.el.hotbar.children;
    for (let i = 0; i < 9; i++) {
      const k = kids[i];
      k.className = 'hslot' + (i === sel ? ' sel' : '');
      k.innerHTML = this.slotHTML(inv.get(i), 34);
    }
  };

  /* ------------------------------------------------------- Panneaux ---- */
  UI.prototype.openPanel = function (type, data) {
    this.open = type;
    this.craftSize = (type === 'crafting') ? 3 : 2;
    if (type === 'furnace') this.furnace = data;
    if (type === 'chest') this.chest = data;
    this.el.panel.style.display = 'flex';
    this.render();
    // Sortie volontaire du verrou : on la signale au jeu (_exitByUI) afin que
    // le gestionnaire `pointerlockchange` ne la confonde pas avec une perte
    // fortuite, qui déclencherait à tort la mise en pause.
    if (document.exitPointerLock && document.pointerLockElement) {
      this.game._exitByUI = true;
      document.exitPointerLock();
      const g = this.game;
      setTimeout(() => { g._exitByUI = false; }, 0);
    }
  };
  UI.prototype.closePanel = function () {
    // renvoie les items du craft dans l'inventaire
    const inv = this.game.player.inv;
    for (let i = 0; i < 9; i++) {
      const s = this.craftGrid[i];
      if (s) { inv.add(s.id, s.n); this.craftGrid[i] = null; }
    }
    if (this.cursor) { inv.add(this.cursor.id, this.cursor.n); this.cursor = null; this.el.cursor.style.display = 'none'; }
    this.open = null;
    this.furnace = null; this.chest = null;
    this.el.panel.style.display = 'none';
    this.el.tooltip.style.display = 'none';
    this.refreshHotbar();
  };

  UI.prototype.render = function () {
    if (!this.open) return;
    const inv = this.game.player.inv;
    const t = this.open;
    const titles = { inventory: 'Inventaire', crafting: 'Établi', furnace: 'Fourneau', chest: 'Coffre' };
    this.el.panelTitle.textContent = titles[t] || 'Inventaire';

    let h = '';
    /* ---- zone haute spécifique ---- */
    if (t === 'inventory' || t === 'crafting') {
      const n = this.craftSize;
      this.craftOut = C.findRecipe(this.padGrid(n), 3);
      h += '<div class="craft-area">';
      h += `<div class="craft-grid g${n}">`;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const gi = y * 3 + x;
        h += `<div class="slot" data-zone="craft" data-i="${gi}">${this.slotHTML(this.craftGrid[gi])}</div>`;
      }
      h += '</div>';
      h += '<div class="arrow">➜</div>';
      h += `<div class="slot out" data-zone="out" data-i="0">${this.slotHTML(this.craftOut ? { id: this.craftOut.id, n: this.craftOut.n } : null)}</div>`;
      h += '</div>';
    } else if (t === 'furnace') {
      const f = this.furnace;
      const prog = f.cookTime > 0 ? Math.min(1, f.progress / f.cookTime) : 0;
      const fuelP = f.fuelMax > 0 ? f.fuel / f.fuelMax : 0;
      h += '<div class="furnace-area">';
      h += `<div class="fcol"><div class="slot" data-zone="fin" data-i="0">${this.slotHTML(f.input)}</div>`;
      h += `<div class="flame"><i style="height:${(fuelP * 100).toFixed(0)}%"></i></div>`;
      h += `<div class="slot" data-zone="ffuel" data-i="0">${this.slotHTML(f.fuelSlot)}</div></div>`;
      h += `<div class="fprog"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>`;
      h += `<div class="slot out" data-zone="fout" data-i="0">${this.slotHTML(f.output)}</div>`;
      h += '</div>';
    } else if (t === 'chest') {
      h += '<div class="chest-grid">';
      for (let i = 0; i < 27; i++) h += `<div class="slot" data-zone="chest" data-i="${i}">${this.slotHTML(this.chest.items[i])}</div>`;
      h += '</div>';
    }

    /* ---- inventaire principal ---- */
    h += '<div class="inv-label">Inventaire</div><div class="inv-grid">';
    for (let i = 9; i < 36; i++) h += `<div class="slot" data-zone="inv" data-i="${i}">${this.slotHTML(inv.get(i))}</div>`;
    h += '</div>';
    h += '<div class="inv-grid hot">';
    for (let i = 0; i < 9; i++) h += `<div class="slot" data-zone="inv" data-i="${i}">${this.slotHTML(inv.get(i))}</div>`;
    h += '</div>';

    /* ---- livre de recettes ---- */
    if (t === 'inventory' || t === 'crafting') {
      h += `<div class="inv-label">Recettes réalisables <input id="rf" class="rfilter" placeholder="filtrer…" value="${this.recipeFilter}"></div>`;
      h += '<div class="recipes">' + this.recipeListHTML() + '</div>';
    }

    this.el.panelBody.innerHTML = h;
    this.bindSlots();
    this.refreshHotbar();
  };

  UI.prototype.padGrid = function (n) {
    if (n === 3) return this.craftGrid;
    // 2×2 mappé sur les indices 0,1,3,4 de la grille 3×3
    const g = new Array(9).fill(null);
    g[0] = this.craftGrid[0]; g[1] = this.craftGrid[1];
    g[3] = this.craftGrid[3]; g[4] = this.craftGrid[4];
    return g;
  };

  UI.prototype.recipeListHTML = function () {
    const inv = this.game.player.inv;
    const have = {};
    for (let i = 0; i < inv.size; i++) { const s = inv.get(i); if (s) have[s.id] = (have[s.id] || 0) + s.n; }
    const all = C.allRecipes();
    const max = this.craftSize === 3 ? 9 : 4;
    const seen = {};
    let h = '';
    all.forEach((r, ri) => {
      // vérifie la taille
      let w = 0, hh = 0;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (r.grid[y * 3 + x]) { if (x + 1 > w) w = x + 1; if (y + 1 > hh) hh = y + 1; }
      if (this.craftSize === 2 && (w > 2 || hh > 2)) return;
      const need = {};
      r.grid.forEach(id => { if (id) need[id] = (need[id] || 0) + 1; });
      let ok = true;
      for (const k in need) if ((have[k] || 0) < need[k]) { ok = false; break; }
      if (!ok) return;
      const label = V.itemLabel(r.out.id);
      if (this.recipeFilter && label.toLowerCase().indexOf(this.recipeFilter.toLowerCase()) < 0) return;
      if (seen[r.out.id]) return;
      seen[r.out.id] = 1;
      h += `<div class="rec" data-r="${ri}" title="${label}">
        <div class="icon" style="${this.iconStyle(V.itemTile(r.out.id), 26)}"></div>
        <span>${r.out.n > 1 ? r.out.n + '×' : ''}${label}</span></div>`;
    });
    return h || '<div class="none">Aucune recette réalisable avec l\'inventaire actuel.</div>';
  };

  /* -------------------------------------------------- Interactions ----- */
  UI.prototype.bindSlots = function () {
    const self = this;
    const slots = this.el.panelBody.querySelectorAll('.slot');
    slots.forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        self.clickSlot(el.dataset.zone, +el.dataset.i, e.button, e.shiftKey);
      });
      el.addEventListener('mouseenter', () => {
        const s = self.getSlot(el.dataset.zone, +el.dataset.i);
        if (s) {
          const it = V.items[s.id];
          let extra = '';
          if (it) {
            if (it.food) extra += `<br><small>Nourriture : ${it.food}</small>`;
            if (it.damage > 1) extra += `<br><small>Dégâts : ${it.damage}</small>`;
            if (it.durability) extra += `<br><small>Durabilité : ${it.durability - (s.dur || 0)}/${it.durability}</small>`;
            if (it.fuel) extra += `<br><small>Combustible : ${(it.fuel / 200).toFixed(1)} objets</small>`;
          } else {
            const bl = V.blocks[s.id];
            if (bl) {
              extra += `<br><small>Dureté : ${bl.hardness < 0 ? '∞' : bl.hardness}</small>`;
              if (bl.light) extra += `<br><small>Luminosité : ${bl.light}</small>`;
            }
          }
          self.el.tooltip.innerHTML = `<b>${V.itemLabel(s.id)}</b>${extra}`;
          self.el.tooltip.style.display = 'block';
        }
      });
      el.addEventListener('mouseleave', () => { self.el.tooltip.style.display = 'none'; });
    });
    const rf = document.getElementById('rf');
    if (rf) {
      rf.addEventListener('input', e => {
        self.recipeFilter = e.target.value;
        const box = self.el.panelBody.querySelector('.recipes');
        if (box) box.innerHTML = self.recipeListHTML();
        self.bindRecipes();
      });
      rf.addEventListener('mousedown', e => e.stopPropagation());
    }
    this.bindRecipes();
  };

  UI.prototype.bindRecipes = function () {
    const self = this;
    this.el.panelBody.querySelectorAll('.rec').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        self.autoFill(+el.dataset.r, e.shiftKey);
      });
    });
  };

  /** Place automatiquement les ingrédients d'une recette dans la grille. */
  UI.prototype.autoFill = function (ri, all) {
    const r = C.allRecipes()[ri];
    if (!r) return;
    const inv = this.game.player.inv;
    // vide la grille
    for (let i = 0; i < 9; i++) if (this.craftGrid[i]) { inv.add(this.craftGrid[i].id, this.craftGrid[i].n); this.craftGrid[i] = null; }
    let ok = true;
    for (let i = 0; i < 9 && ok; i++) {
      const id = r.grid[i];
      if (!id) continue;
      if (inv.consume(id, 1)) this.craftGrid[i] = { id, n: 1 };
      else ok = false;
    }
    this.render();
  };

  UI.prototype.getSlot = function (zone, i) {
    const inv = this.game.player.inv;
    switch (zone) {
      case 'inv': return inv.get(i);
      case 'craft': return this.craftGrid[i];
      case 'out': return this.craftOut ? { id: this.craftOut.id, n: this.craftOut.n } : null;
      case 'fin': return this.furnace.input;
      case 'ffuel': return this.furnace.fuelSlot;
      case 'fout': return this.furnace.output;
      case 'chest': return this.chest.items[i];
    }
    return null;
  };
  UI.prototype.setSlot = function (zone, i, s) {
    const inv = this.game.player.inv;
    switch (zone) {
      case 'inv': inv.set(i, s); break;
      case 'craft': this.craftGrid[i] = s; break;
      case 'fin': this.furnace.input = s; break;
      case 'ffuel': this.furnace.fuelSlot = s; break;
      case 'fout': this.furnace.output = s; break;
      case 'chest': this.chest.items[i] = s; break;
    }
  };

  UI.prototype.clickSlot = function (zone, i, button, shift) {
    const inv = this.game.player.inv;

    /* --- sortie de craft : on ne peut que prendre --- */
    if (zone === 'out' || zone === 'fout') {
      const out = zone === 'out' ? this.craftOut : (this.furnace.output ? { id: this.furnace.output.id, n: this.furnace.output.n } : null);
      if (!out) return;
      if (zone === 'out') {
        const take = () => {
          if (this.cursor && (this.cursor.id !== out.id || this.cursor.n + out.n > V.maxStack(out.id))) return false;
          // consomme un exemplaire de chaque ingrédient
          for (let k = 0; k < 9; k++) {
            const s = this.craftGrid[k];
            if (s) { s.n--; if (s.n <= 0) this.craftGrid[k] = null; }
          }
          if (this.cursor) this.cursor.n += out.n;
          else this.cursor = { id: out.id, n: out.n };
          return true;
        };
        if (shift) {
          let guard = 0;
          while (guard++ < 64) {
            const rec = C.findRecipe(this.padGrid(this.craftSize), 3);
            if (!rec) break;
            for (let k = 0; k < 9; k++) { const s = this.craftGrid[k]; if (s) { s.n--; if (s.n <= 0) this.craftGrid[k] = null; } }
            inv.add(rec.id, rec.n);
          }
        } else {
          take();
        }
        this.game.audio.craft();
      } else {
        const f = this.furnace;
        if (shift) { inv.add(f.output.id, f.output.n); f.output = null; }
        else if (!this.cursor) { this.cursor = f.output; f.output = null; }
        else if (this.cursor.id === f.output.id) {
          const max = V.maxStack(this.cursor.id);
          const add = Math.min(max - this.cursor.n, f.output.n);
          this.cursor.n += add; f.output.n -= add;
          if (f.output.n <= 0) f.output = null;
        }
      }
      this.updateCursorEl();
      this.render();
      return;
    }

    const cur = this.getSlot(zone, i);

    /* --- shift-clic : transfert rapide --- */
    if (shift && cur) {
      if (zone === 'inv') {
        if (this.open === 'chest') {
          const rest = this.addToChest(cur.id, cur.n);
          if (rest === 0) this.setSlot(zone, i, null); else cur.n = rest;
        } else if (this.open === 'furnace') {
          // essaie fuel puis input
          const f = this.furnace;
          if (V.fuelValue(cur.id) > 0 && (!f.fuelSlot || f.fuelSlot.id === cur.id)) {
            if (!f.fuelSlot) f.fuelSlot = { id: cur.id, n: cur.n };
            else f.fuelSlot.n += cur.n;
            this.setSlot(zone, i, null);
          } else if (!f.input || f.input.id === cur.id) {
            if (!f.input) f.input = { id: cur.id, n: cur.n }; else f.input.n += cur.n;
            this.setSlot(zone, i, null);
          }
        } else {
          // hotbar <-> inventaire
          const from = i < 9, s0 = from ? 9 : 0, s1 = from ? 36 : 9;
          const rest = inv.add(cur.id, cur.n, s0, s1);
          if (rest === 0) this.setSlot(zone, i, null); else cur.n = rest;
        }
      } else {
        const rest = inv.add(cur.id, cur.n);
        if (rest === 0) this.setSlot(zone, i, null); else cur.n = rest;
      }
      this.render();
      return;
    }

    /* --- clic gauche : échange / dépôt complet --- */
    if (button === 0) {
      if (this.cursor && cur && this.cursor.id === cur.id) {
        const max = V.maxStack(cur.id);
        const add = Math.min(max - cur.n, this.cursor.n);
        cur.n += add; this.cursor.n -= add;
        if (this.cursor.n <= 0) this.cursor = null;
      } else {
        const tmp = this.cursor;
        this.cursor = cur;
        this.setSlot(zone, i, tmp);
      }
    }
    /* --- clic droit : moitié / un par un --- */
    else if (button === 2) {
      if (this.cursor) {
        if (!cur) { this.setSlot(zone, i, { id: this.cursor.id, n: 1 }); this.cursor.n--; }
        else if (cur.id === this.cursor.id && cur.n < V.maxStack(cur.id)) { cur.n++; this.cursor.n--; }
        if (this.cursor && this.cursor.n <= 0) this.cursor = null;
      } else if (cur) {
        const half = Math.ceil(cur.n / 2);
        this.cursor = { id: cur.id, n: half };
        cur.n -= half;
        if (cur.n <= 0) this.setSlot(zone, i, null);
      }
    }
    this.updateCursorEl();
    this.render();
  };

  UI.prototype.addToChest = function (id, n) {
    const items = this.chest.items;
    const max = V.maxStack(id);
    for (let i = 0; i < 27 && n > 0; i++) {
      const s = items[i];
      if (s && s.id === id && s.n < max) { const a = Math.min(max - s.n, n); s.n += a; n -= a; }
    }
    for (let i = 0; i < 27 && n > 0; i++) {
      if (!items[i]) { const a = Math.min(max, n); items[i] = { id, n: a }; n -= a; }
    }
    return n;
  };

  UI.prototype.updateCursorEl = function () {
    const el = this.el.cursor;
    if (this.cursor) {
      el.style.display = 'block';
      el.innerHTML = this.slotHTML(this.cursor, 38);
    } else el.style.display = 'none';
  };

  root.VCUI = { UI, Inventory };
})(typeof self !== 'undefined' ? self : this);
