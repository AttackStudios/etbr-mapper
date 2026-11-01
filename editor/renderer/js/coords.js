// Unreal (cm, Z-up, left-handed, FRotator) <-> Three.js (m, Y-up, right-handed)
// three = (ue.x, ue.z, ue.y) / 100   — axis swap, see format/ETBRMAP.md
import * as THREE from 'three';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function ueToThreePos(p, out = new THREE.Vector3()) {
  return out.set(p[0] / 100, p[2] / 100, p[1] / 100);
}
export function threeToUePos(v) {
  return [round(v.x * 100), round(v.z * 100), round(v.y * 100)];
}
export function ueToThreeScale(s, out = new THREE.Vector3()) {
  return out.set(s[0], s[2], s[1]);
}
export function threeToUeScale(v) {
  return [round(v.x, 1000), round(v.z, 1000), round(v.y, 1000)];
}
function round(x, k = 10) { return Math.round(x * k) / k; }

// FRotationMatrix rows (UE): local X, Y, Z axes expressed in world UE coords
function ueAxes(pitch, yaw, roll) {
  const SP = Math.sin(pitch * D2R), CP = Math.cos(pitch * D2R);
  const SY = Math.sin(yaw * D2R), CY = Math.cos(yaw * D2R);
  const SR = Math.sin(roll * D2R), CR = Math.cos(roll * D2R);
  return [
    [CP * CY, CP * SY, SP],
    [SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP],
    [-(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP],
  ];
}
const sw = (a) => [a[0], a[2], a[1]];

const _m = new THREE.Matrix4();
export function ueRotToQuat(r, out = new THREE.Quaternion()) {
  const [X, Y, Z] = ueAxes(r[0] || 0, r[1] || 0, r[2] || 0);
  // three local axes: x = ueX, y = ueZ, z = ueY  (each converted to three world space)
  const bx = sw(X), by = sw(Z), bz = sw(Y);
  _m.set(bx[0], by[0], bz[0], 0, bx[1], by[1], bz[1], 0, bx[2], by[2], bz[2], 0, 0, 0, 0, 1);
  return out.setFromRotationMatrix(_m);
}
export function quatToUeRot(q) {
  _m.makeRotationFromQuaternion(q);
  const e = _m.elements; // column-major
  const bx = [e[0], e[1], e[2]], by = [e[4], e[5], e[6]], bz = [e[8], e[9], e[10]];
  const X = sw(bx), Y = sw(bz), Z = sw(by);
  const pitch = Math.atan2(X[2], Math.hypot(X[0], X[1])) * R2D;
  const yaw = Math.atan2(X[1], X[0]) * R2D;
  const SY = [-Math.sin(yaw * D2R), Math.cos(yaw * D2R), 0];
  const roll = Math.atan2(Z[0] * SY[0] + Z[1] * SY[1] + Z[2] * SY[2], Y[0] * SY[0] + Y[1] * SY[1] + Y[2] * SY[2]) * R2D;
  const c = (a) => { a = round(a, 100); return Object.is(a, -0) ? 0 : a; };
  return [c(pitch), c(yaw), c(roll)];
}
