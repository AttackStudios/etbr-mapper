// Avatar for players testing the level in the real game (shown in every editor).
import * as THREE from 'three';

// ---------- remote wanderer avatar (seen by collaborators) ----------
export function wandererAvatar(name, color) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e0b48f', roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 4, 10), cloth); torso.position.y = 1.1; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin); head.position.y = 1.6; body.add(head);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.16), new THREE.MeshStandardMaterial({ color: '#3b3a2e' })); pack.position.set(0, 1.15, 0.22); body.add(pack);
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55, 4, 8), new THREE.MeshStandardMaterial({ color: '#2d2b22' })); leg.position.set(0.11 * s, 0.4, 0); leg.name = 'leg' + s; body.add(leg); }
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#fff4c0', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.x = Math.PI / 2; beam.position.set(0, 1.45, -2.2); beam.visible = false; body.add(beam);
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = color; x.beginPath(); x.roundRect(0, 8, 256, 48, 24); x.fill(); x.fillStyle = '#111'; x.font = '700 28px Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🎮 ' + name.slice(0, 12), 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); tag.scale.set(1.2, 0.3, 1); tag.position.y = 2.05; tag.renderOrder = 22; tag.userData.isLabel = true; g.add(tag);
  g.userData = { body, beam, target: new THREE.Vector3(), yaw: 0, t: 0 };
  return g;
}
