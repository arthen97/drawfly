/**
 * One command door for every Three.js element.
 * Each channel has one owner. An agent write claims it; the sim keeps writing
 * only while the owner is "sim". Concurrent actors share a queue and apply in order.
 */

const MESH_CHANNELS = ["position", "rotation", "scale", "visible", "color", "opacity"];
const LIGHT_CHANNELS = ["color", "intensity", "position"];

export const SCENE_SCHEMA = {
  submit: { actor: "稳定id，例如 user-a", op: "set | camera | control | release", target: "catalog 里的 id", props: {}, ifRev: "可选，必须等于该要素当前 rev" },
  ops: {
    set: "改物体或灯光。position / rotation / scale 是长度为 3 的数组，rotation 用弧度。color 用 #rrggbb。",
    camera: "target 固定为 camera。preset 取 desk、top、side、brain。follow 跟随果蝇，orbit 环绕。",
    control: "target 固定为 fly.control。throttle 与 pressure 是 0..1，steering 是 -1..1，pen_down 是布尔。",
    release: "channels 列出要交还的通道。省略时交还这个 actor 在 target 上占有的全部通道。",
  },
  rule: "写入成功后，actor 成为这些通道的 owner。owner 为 sim 时，每帧动画继续写该通道。多个 actor 按提交顺序执行，后写的值留下。ifRev 与要素 rev 不一致时整条命令不生效。",
};

function round(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function round3(values) {
  return [round(values[0]), round(values[1]), round(values[2])];
}

function fail(message) {
  const err = new Error(message);
  err.code = "bad-value";
  throw err;
}

export function asVec3(value) {
  if (!Array.isArray(value) || value.length !== 3) fail("需要 [x, y, z]");
  const v = value.map(Number);
  if (v.some((n) => !Number.isFinite(n))) fail("需要 [x, y, z]");
  return v;
}

export function asNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) fail("需要数字");
  return Math.max(min, Math.min(max, n));
}

export function asBool(value) {
  if (typeof value === "boolean") return value;
  fail("需要 true 或 false");
}

export function parseColor(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const s = value.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
    if (/^0x[0-9a-fA-F]{6}$/.test(s)) return Number(s);
  }
  fail("颜色用 #rrggbb");
}

function materialsOf(object) {
  if (!object.material) return [];
  return Array.isArray(object.material) ? object.material : [object.material];
}

function colorOf(object) {
  const color = object.color || materialsOf(object)[0]?.color;
  return color?.getHexString ? `#${color.getHexString()}` : null;
}

function paint(object, value) {
  const parsed = parseColor(value);
  if (object.color?.set) object.color.set(parsed);
  for (const mat of materialsOf(object)) {
    if (mat.color?.set) mat.color.set(parsed);
  }
}

export function objectBinding(id, object, { kind = "object", channels, hint = "" } = {}) {
  const use = channels || (object.isLight ? LIGHT_CHANNELS : MESH_CHANNELS);
  return {
    id,
    kind,
    hint,
    channels: use,
    get(channel) {
      if (channel === "position") return round3(object.position.toArray());
      if (channel === "rotation") return round3([object.rotation.x, object.rotation.y, object.rotation.z]);
      if (channel === "scale") return round3(object.scale.toArray());
      if (channel === "visible") return Boolean(object.visible);
      if (channel === "color") return colorOf(object);
      if (channel === "intensity") return round(object.intensity ?? 0);
      if (channel === "opacity") return round(materialsOf(object)[0]?.opacity ?? 1);
      return null;
    },
    set(channel, value) {
      if (channel === "position") {
        const v = asVec3(value);
        object.position.set(v[0], v[1], v[2]);
      } else if (channel === "rotation") {
        const v = asVec3(value);
        object.rotation.set(v[0], v[1], v[2]);
      } else if (channel === "scale") {
        const v = asVec3(value);
        object.scale.set(v[0], v[1], v[2]);
      } else if (channel === "visible") {
        object.visible = asBool(value);
      } else if (channel === "color") {
        paint(object, value);
      } else if (channel === "intensity") {
        object.intensity = asNumber(value, 0, 20);
      } else if (channel === "opacity") {
        const opacity = asNumber(value, 0, 1);
        for (const mat of materialsOf(object)) {
          mat.opacity = opacity;
          mat.transparent = opacity < 1;
        }
      } else {
        fail(`没有通道 ${channel}`);
      }
    },
  };
}

function safeGet(node, channel) {
  try {
    return node.get(channel);
  } catch {
    return null;
  }
}

export class SceneControl {
  constructor() {
    this.nodes = new Map();
    this.queue = [];
    this.recent = [];
    this.seq = 0;
  }

  register(spec) {
    const prev = this.nodes.get(spec.id);
    const owners = {};
    for (const channel of spec.channels) {
      owners[channel] = prev?.owners?.[channel] || "sim";
    }
    this.nodes.set(spec.id, {
      ...spec,
      owners,
      rev: prev?.rev || 0,
    });
  }

  simCan(id, channel) {
    const node = this.nodes.get(id);
    if (!node) return true;
    return (node.owners[channel] || "sim") === "sim";
  }

  give(id, channels, owner) {
    const node = this.nodes.get(id);
    if (!node) return;
    for (const channel of channels) {
      if (node.channels.includes(channel)) node.owners[channel] = owner;
    }
  }

  writeSim(id, props) {
    const node = this.nodes.get(id);
    if (!node || !props) return;
    for (const [channel, value] of Object.entries(props)) {
      if (value === undefined || !this.simCan(id, channel)) continue;
      try {
        node.set(channel, value);
      } catch {
        // Sim values stay on their own objects when a channel rejects them.
      }
    }
  }

  submit(cmd, { flush = false } = {}) {
    const list = Array.isArray(cmd) ? cmd : [cmd];
    for (const raw of list) {
      this.seq += 1;
      this.queue.push({ ...raw, seq: this.seq });
    }
    if (flush) return this.flush();
    return { ok: true, queued: list.length };
  }

  flush() {
    const batch = this.queue.splice(0, this.queue.length);
    const results = batch.map((cmd) => this._apply(cmd));
    return { ok: results.every((item) => item.ok), results };
  }

  _remember(result) {
    this.recent.push({ t: Date.now(), ...result });
    if (this.recent.length > 50) this.recent.shift();
    return result;
  }

  _apply(cmd) {
    const actor = String(cmd.actor || "").trim();
    if (!actor) return this._remember({ ok: false, error: "actor required", seq: cmd.seq });
    if (cmd.op === "release") return this._release(cmd, actor);

    const op = cmd.op;
    if (op !== "set" && op !== "camera" && op !== "control") {
      return this._remember({ ok: false, error: "unknown op", op, seq: cmd.seq });
    }
    const target = op === "camera" ? "camera" : cmd.target;
    if (op === "camera" && cmd.target && cmd.target !== "camera") {
      return this._remember({ ok: false, error: "camera op uses target camera", seq: cmd.seq });
    }
    const node = this.nodes.get(target);
    if (!node) return this._remember({ ok: false, error: "unknown target", target, seq: cmd.seq });
    if (cmd.ifRev != null && Number(cmd.ifRev) !== node.rev) {
      return this._remember({
        ok: false,
        error: "rev mismatch",
        target: node.id,
        rev: node.rev,
        seq: cmd.seq,
      });
    }

    const props = cmd.props && typeof cmd.props === "object" ? cmd.props : {};
    const keys = Object.keys(props);
    const ordered = keys.includes("preset") ? ["preset", ...keys.filter((key) => key !== "preset")] : keys;
    const applied = [];
    const skipped = [];
    for (const channel of ordered) {
      if (!node.channels.includes(channel)) {
        skipped.push({ channel, reason: "no such channel" });
        continue;
      }
      try {
        node.set(channel, props[channel]);
        node.owners[channel] = actor;
        applied.push(channel);
      } catch (err) {
        skipped.push({ channel, reason: err.message || "bad value" });
      }
    }
    if (applied.length) {
      node.rev += 1;
      if (typeof node.after === "function") node.after(props, actor, this);
    }
    return this._remember({
      ok: applied.length > 0,
      error: applied.length ? undefined : "nothing applied",
      seq: cmd.seq,
      actor,
      op,
      target: node.id,
      applied,
      skipped,
      rev: node.rev,
    });
  }

  _release(cmd, actor) {
    const node = this.nodes.get(cmd.target);
    if (!node) return this._remember({ ok: false, error: "unknown target", target: cmd.target, seq: cmd.seq });
    const requested = Array.isArray(cmd.channels)
      ? cmd.channels
      : node.channels.filter((channel) => node.owners[channel] === actor);
    const released = [];
    const skipped = [];
    for (const channel of requested) {
      if (!node.channels.includes(channel) || node.owners[channel] !== actor) {
        skipped.push({ channel, owner: node.owners[channel] || null });
        continue;
      }
      node.owners[channel] = "sim";
      released.push(channel);
    }
    if (released.length) node.rev += 1;
    return this._remember({
      ok: released.length > 0,
      seq: cmd.seq,
      actor,
      op: "release",
      target: node.id,
      released,
      skipped,
      rev: node.rev,
    });
  }

  catalog() {
    return [...this.nodes.values()].map((node) => ({
      id: node.id,
      kind: node.kind,
      hint: node.hint || "",
      rev: node.rev,
      channels: Object.fromEntries(
        node.channels.map((channel) => [
          channel,
          { owner: node.owners[channel] || "sim", value: safeGet(node, channel) },
        ])
      ),
    }));
  }

  snapshot() {
    return { seq: this.seq, catalog: this.catalog(), recent: this.recent.slice(-12) };
  }

  schema() {
    return SCENE_SCHEMA;
  }
}
