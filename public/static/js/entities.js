/* =========================================================================
 *  VOXELCRAFT — Entités (mobs, objets au sol, particules)
 *
 *  Les mobs sont des machines à états finis simples : IDLE → WANDER →
 *  (CHASE | FLEE) → ATTACK. Le pathfinding est volontairement local
 *  (saut d'obstacle 1 bloc + évitement de vide), suffisant pour un monde
 *  voxel ouvert et infiniment moins coûteux qu'un A* complet par tick.
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const P = root.VCPhys;
  const B = V.B, I = V.I;

  /* ------------------------------------------------------ Types de mobs */
  const MOB = {
    PIG: 'pig', COW: 'cow', SHEEP: 'sheep', CHICKEN: 'chicken',
    ZOMBIE: 'zombie', SKELETON: 'skeleton', SPIDER: 'spider', CREEPER: 'creeper'
  };

  const MOB_DEF = {
    pig: {
      hp: 10, speed: 1.6, w: 0.62, h: 0.86, hostile: false, flee: true,
      body: [0.92, 0.60, 0.62], head: [0.50, 0.50, 0.42],
      color: [0.94, 0.62, 0.66], color2: [0.85, 0.52, 0.56],
      drops: [[I.PORKCHOP, 1, 3]], xp: 1
    },
    cow: {
      hp: 10, speed: 1.4, w: 0.72, h: 1.20, hostile: false, flee: true,
      body: [1.10, 0.78, 0.70], head: [0.52, 0.52, 0.48],
      color: [0.35, 0.26, 0.20], color2: [0.92, 0.90, 0.86],
      drops: [[I.BEEF, 1, 3], [I.LEATHER, 0, 2]], xp: 1
    },
    sheep: {
      hp: 8, speed: 1.5, w: 0.68, h: 1.10, hostile: false, flee: true,
      body: [1.00, 0.78, 0.68], head: [0.46, 0.46, 0.44],
      color: [0.93, 0.93, 0.90], color2: [0.86, 0.75, 0.68],
      drops: [[B.WOOL, 1, 1]], xp: 1
    },
    chicken: {
      hp: 4, speed: 1.5, w: 0.40, h: 0.68, hostile: false, flee: true,
      body: [0.42, 0.40, 0.44], head: [0.30, 0.30, 0.28],
      color: [0.96, 0.96, 0.94], color2: [0.90, 0.55, 0.15],
      drops: [[I.CHICKEN, 1, 1], [I.FEATHER, 0, 2]], xp: 1, floaty: true
    },
    zombie: {
      hp: 20, speed: 1.55, w: 0.58, h: 1.85, hostile: true, damage: 3, reach: 1.6,
      body: [0.62, 0.86, 0.36], head: [0.52, 0.52, 0.52],
      color: [0.18, 0.42, 0.22], color2: [0.30, 0.55, 0.85],
      drops: [[I.FLESH, 0, 2]], xp: 5, burnsInDay: true
    },
    skeleton: {
      hp: 20, speed: 1.7, w: 0.56, h: 1.90, hostile: true, damage: 2, reach: 1.6, ranged: true,
      body: [0.56, 0.86, 0.30], head: [0.50, 0.50, 0.50],
      color: [0.85, 0.85, 0.82], color2: [0.70, 0.70, 0.67],
      drops: [[I.BONE, 0, 2], [I.ARROW, 0, 2]], xp: 5, burnsInDay: true
    },
    spider: {
      hp: 16, speed: 2.1, w: 0.90, h: 0.68, hostile: true, damage: 2, reach: 1.6,
      body: [1.00, 0.50, 0.86], head: [0.48, 0.44, 0.44],
      color: [0.22, 0.16, 0.14], color2: [0.62, 0.12, 0.10],
      drops: [[I.STRING, 0, 2]], xp: 5, climber: true
    },
    creeper: {
      hp: 20, speed: 1.5, w: 0.58, h: 1.70, hostile: true, damage: 0, reach: 2.2, explodes: true,
      body: [0.58, 1.10, 0.42], head: [0.52, 0.52, 0.52],
      color: [0.24, 0.66, 0.26], color2: [0.16, 0.48, 0.18],
      drops: [[I.GUNPOWDER, 0, 2]], xp: 5
    }
  };

  const PASSIVE = [MOB.PIG, MOB.COW, MOB.SHEEP, MOB.CHICKEN];
  const HOSTILE = [MOB.ZOMBIE, MOB.SKELETON, MOB.SPIDER, MOB.CREEPER];

  /* =============================================================== Mob == */
  let nextId = 1;
  function Mob(type, x, y, z) {
    const d = MOB_DEF[type];
    this.id = nextId++;
    this.type = type;
    this.def = d;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = d.hp;
    this.state = 'idle';
    this.timer = 0;
    this.onGround = false;
    this.hurtTime = 0;
    this.attackCd = 0;
    this.fuse = -1;
    this.walkPhase = 0;
    this.age = 0;
    this.dead = false;
    this.inWater = false;
  }

  Mob.prototype.hurt = function (dmg, kx, kz) {
    if (this.hurtTime > 0.25) return false;
    this.hp -= dmg;
    this.hurtTime = 0.5;
    const l = Math.hypot(kx, kz) || 1;
    this.vx += (kx / l) * 4.2;
    this.vz += (kz / l) * 4.2;
    this.vy = Math.max(this.vy, 3.4);
    if (this.hp <= 0) this.dead = true;
    // les passifs fuient après une attaque
    if (!this.def.hostile) { this.state = 'flee'; this.timer = 5 + Math.random() * 3; }
    else { this.state = 'chase'; }
    return true;
  };

  Mob.prototype.update = function (dt, world, player, isDay) {
    this.age += dt;
    if (this.hurtTime > 0) this.hurtTime -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    const d = this.def;

    const dx = player.x - this.x, dz = player.z - this.z, dy = player.y - this.y;
    const dist = Math.hypot(dx, dy * 0.5, dz);

    /* ---- machine à états ---- */
    this.timer -= dt;
    if (d.hostile) {
      if (dist < 16 && this.canSee(world, player)) {
        this.state = 'chase';
      } else if (this.state === 'chase' && dist > 24) {
        this.state = 'wander'; this.timer = 2;
      }
    } else if (this.state === 'flee' && this.timer <= 0) {
      this.state = 'wander'; this.timer = 0;
    }

    if (this.timer <= 0 && this.state !== 'chase' && this.state !== 'flee') {
      if (Math.random() < 0.55) { this.state = 'wander'; this.yaw = Math.random() * Math.PI * 2; this.timer = 2 + Math.random() * 4; }
      else { this.state = 'idle'; this.timer = 1 + Math.random() * 3; }
    }

    /* ---- intention de déplacement ---- */
    let mx = 0, mz = 0, speed = d.speed;
    if (this.state === 'chase') {
      const l = Math.hypot(dx, dz) || 1;
      mx = dx / l; mz = dz / l;
      this.yaw = Math.atan2(mx, mz);
      if (d.explodes && dist < 2.6) {
        if (this.fuse < 0) this.fuse = 1.5;
        mx = mz = 0;
      } else if (d.explodes) this.fuse = -1;
      if (dist < (d.reach || 1.6) && this.attackCd <= 0 && !d.explodes) {
        this.attackCd = 1.0;
        this.pendingAttack = d.damage;
      }
      speed *= 1.15;
    } else if (this.state === 'flee') {
      const l = Math.hypot(dx, dz) || 1;
      mx = -dx / l; mz = -dz / l;
      this.yaw = Math.atan2(mx, mz);
      speed *= 1.4;
    } else if (this.state === 'wander') {
      mx = Math.sin(this.yaw); mz = Math.cos(this.yaw);
      speed *= 0.55;
    }

    if (this.fuse > 0) { this.fuse -= dt; if (this.fuse <= 0) { this.exploding = true; } }

    /* ---- physique ---- */
    const feetId = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z));
    this.inWater = V.T_LIQUID[feetId] === 1;

    const accel = this.onGround ? 22 : 5;
    this.vx += (mx * speed - this.vx) * Math.min(1, accel * dt);
    this.vz += (mz * speed - this.vz) * Math.min(1, accel * dt);

    if (this.inWater) {
      this.vy += (1.0 - this.vy) * Math.min(1, 6 * dt);   // flotte
      this.vx *= 0.86; this.vz *= 0.86;
    } else {
      this.vy -= (d.floaty ? 12 : 26) * dt;
      if (d.floaty && this.vy < -3.2) this.vy = -3.2;    // poule plane
      if (this.vy < -55) this.vy = -55;
    }

    // saut d'obstacle
    if (this.onGround && (mx || mz)) {
      const fx = this.x + mx * (d.w * 0.5 + 0.35);
      const fz = this.z + mz * (d.w * 0.5 + 0.35);
      const ahead = world.getBlock(Math.floor(fx), Math.floor(this.y + 0.2), Math.floor(fz));
      const aheadUp = world.getBlock(Math.floor(fx), Math.floor(this.y + 1.2), Math.floor(fz));
      if (V.T_SOLID[ahead] && !V.T_SOLID[aheadUp]) this.vy = 7.6;
      // évite de tomber d'une falaise en errance
      if (this.state === 'wander') {
        const below = world.getBlock(Math.floor(fx), Math.floor(this.y - 1.2), Math.floor(fz));
        const below2 = world.getBlock(Math.floor(fx), Math.floor(this.y - 3.2), Math.floor(fz));
        if (!V.T_SOLID[below] && !V.T_SOLID[below2]) { this.vx = 0; this.vz = 0; this.yaw += 2.2; }
      }
    }
    if (d.climber && (this.vx || this.vz)) {
      const fx = this.x + Math.sin(this.yaw) * (d.w * 0.5 + 0.2);
      const fz = this.z + Math.cos(this.yaw) * (d.w * 0.5 + 0.2);
      if (V.T_SOLID[world.getBlock(Math.floor(fx), Math.floor(this.y + 0.5), Math.floor(fz))]) this.vy = Math.max(this.vy, 3.2);
    }

    const pos = { x: this.x, y: this.y, z: this.z };
    const move = { x: this.vx * dt, y: this.vy * dt, z: this.vz * dt };
    const r = P.moveAABB(world, pos, move, d.w * 0.5, d.h, 0.6);
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.onGround = r.onGround;
    if (r.hitY) this.vy = 0;
    if (r.hitX) this.vx = 0;
    if (r.hitZ) this.vz = 0;

    this.walkPhase += Math.hypot(this.vx, this.vz) * dt * 3.2;

    // combustion diurne des morts-vivants
    if (d.burnsInDay && isDay) {
      const sky = world.isSkyExposed(Math.floor(this.x), Math.floor(this.y + d.h), Math.floor(this.z));
      if (sky) { this.hp -= dt * 2.4; this.burning = true; if (this.hp <= 0) this.dead = true; }
      else this.burning = false;
    }
    // noyade / lave
    if (this.y < -8) this.dead = true;
  };

  Mob.prototype.canSee = function (world, player) {
    const dx = player.x - this.x, dy = (player.y + 1.4) - (this.y + this.def.h * 0.85), dz = player.z - this.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 0.001) return true;
    const hit = P.raycast(world, this.x, this.y + this.def.h * 0.85, this.z, dx / l, dy / l, dz / l, Math.min(l, 18), false);
    return !hit || hit.dist >= l - 0.6;
  };

  Mob.prototype.rollDrops = function () {
    const out = [];
    (this.def.drops || []).forEach(d => {
      const min = d[1], max = d[2];
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n > 0) out.push({ id: d[0], n });
    });
    return out;
  };

  /* ==================================================== Item au sol ===== */
  function ItemEntity(x, y, z, id, count) {
    this.id = nextId++;
    this.x = x; this.y = y; this.z = z;
    this.vx = (Math.random() - 0.5) * 2.4;
    this.vy = 2.6 + Math.random() * 1.2;
    this.vz = (Math.random() - 0.5) * 2.4;
    this.item = id; this.count = count;
    this.age = 0; this.onGround = false; this.dead = false;
    this.pickupDelay = 0.55;
  }
  ItemEntity.prototype.update = function (dt, world, player) {
    this.age += dt;
    if (this.pickupDelay > 0) this.pickupDelay -= dt;
    this.vy -= 24 * dt;
    if (this.vy < -50) this.vy = -50;

    const feet = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z));
    if (V.T_LIQUID[feet]) { this.vy += 40 * dt; this.vy = Math.min(this.vy, 1.4); this.vx *= 0.9; this.vz *= 0.9; }

    const pos = { x: this.x, y: this.y, z: this.z };
    const r = P.moveAABB(world, pos, { x: this.vx * dt, y: this.vy * dt, z: this.vz * dt }, 0.12, 0.24, 0);
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    if (r.onGround) { this.vx *= 0.72; this.vz *= 0.72; this.vy = 0; this.onGround = true; }
    if (r.hitX) this.vx = 0;
    if (r.hitZ) this.vz = 0;

    // attraction magnétique vers le joueur
    if (this.pickupDelay <= 0) {
      const dx = player.x - this.x, dy = (player.y + 0.6) - this.y, dz = player.z - this.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 2.4) {
        const k = (2.4 - d) / 2.4 * 22 * dt;
        this.x += dx * k * 0.4; this.y += dy * k * 0.4; this.z += dz * k * 0.4;
      }
    }
    if (this.age > 300) this.dead = true;
    if (this.y < -12) this.dead = true;
  };

  /* ==================================================== Particules ====== */
  function ParticleSystem(max) {
    max = max || 900;
    this.max = max;
    this.n = 0;
    this.x = new Float32Array(max); this.y = new Float32Array(max); this.z = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.r = new Float32Array(max); this.g = new Float32Array(max); this.b = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.tile = new Int16Array(max);
  }
  ParticleSystem.prototype.spawn = function (x, y, z, vx, vy, vz, life, size, col, grav, tile) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = (Math.random() * this.max) | 0;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.r[i] = col[0]; this.g[i] = col[1]; this.b[i] = col[2];
    this.grav[i] = grav === undefined ? 18 : grav;
    this.tile[i] = tile === undefined ? -1 : tile;
  };
  /** Éclats de bloc cassé. */
  ParticleSystem.prototype.blockBreak = function (x, y, z, tile, count) {
    for (let i = 0; i < (count || 22); i++) {
      this.spawn(
        x + Math.random(), y + Math.random(), z + Math.random(),
        (Math.random() - 0.5) * 4.2, Math.random() * 4.4, (Math.random() - 0.5) * 4.2,
        0.5 + Math.random() * 0.6, 0.11 + Math.random() * 0.07, [1, 1, 1], 20, tile);
    }
  };
  ParticleSystem.prototype.update = function (dt, world) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vy[i] -= this.grav[i] * dt;
      const nx = this.x[i] + this.vx[i] * dt;
      const ny = this.y[i] + this.vy[i] * dt;
      const nz = this.z[i] + this.vz[i] * dt;
      if (V.T_SOLID[world.getBlock(Math.floor(nx), Math.floor(this.y[i]), Math.floor(this.z[i]))]) { this.vx[i] *= -0.3; }
      else this.x[i] = nx;
      if (V.T_SOLID[world.getBlock(Math.floor(this.x[i]), Math.floor(ny), Math.floor(this.z[i]))]) { this.vy[i] *= -0.22; this.vx[i] *= 0.7; this.vz[i] *= 0.7; }
      else this.y[i] = ny;
      if (V.T_SOLID[world.getBlock(Math.floor(this.x[i]), Math.floor(this.y[i]), Math.floor(nz))]) { this.vz[i] *= -0.3; }
      else this.z[i] = nz;
    }
    // compactage
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] > 0) {
        if (w !== i) {
          this.x[w] = this.x[i]; this.y[w] = this.y[i]; this.z[w] = this.z[i];
          this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i]; this.vz[w] = this.vz[i];
          this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i];
          this.size[w] = this.size[i]; this.grav[w] = this.grav[i]; this.tile[w] = this.tile[i];
          this.r[w] = this.r[i]; this.g[w] = this.g[i]; this.b[w] = this.b[i];
        }
        w++;
      }
    }
    this.n = w;
  };

  root.VCEnt = { Mob, ItemEntity, ParticleSystem, MOB, MOB_DEF, PASSIVE, HOSTILE };
})(typeof self !== 'undefined' ? self : this);
