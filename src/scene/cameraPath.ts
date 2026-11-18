import { CatmullRomCurve3, Vector3 } from 'three';

/** One camera station per page section: [azimuth°, elevation°, distance] around the hub. */
const STATIONS: [number, number, number][] = [
  [0, 4, 10.5],
  [30, 12, 8.2],
  [-14, 22, 8.0],
  [-34, -10, 8.6],
  [16, 24, 7.4],
  [-22, 8, 9.2],
  [0, -2, 11.5],
];
/** Nebula hue per station (0 = blue, 1 = violet). */
export const STATION_HUE = [0, 0.3, 0.22, 0.12, 0.45, 0.08, 0.2];

const toVec = ([az, el, d]: [number, number, number]) => {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  return new Vector3(d * Math.sin(a) * Math.cos(e), d * Math.sin(e), d * Math.cos(a) * Math.cos(e));
};

export class CameraPath {
  private curve: CatmullRomCurve3;
  readonly count: number;

  constructor(sections: number) {
    const pts = Array.from({ length: sections }, (_, i) => toVec(STATIONS[i % STATIONS.length]));
    if (pts.length === 1) pts.push(pts[0].clone().multiplyScalar(1.01));
    this.curve = new CatmullRomCurve3(pts, false, 'centripetal');
    this.count = sections;
  }

  /** u in 0..count-1 */
  at(u: number, out: Vector3) {
    return this.curve.getPoint(Math.min(1, Math.max(0, u / Math.max(1, this.count - 1))), out);
  }
}
