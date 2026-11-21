import { advance, bearing, clamp, distance, projection, radians } from './geometry.js';
import { areaBoundary, clearingShape, corners, moveNode, nodePose } from './model.js';
import { resizeRadius, rotateBuilding } from './buildings.js';
import { featureOf } from './landforms.js';
import { insideYard, simpleBoundary } from './yards.js';

export const layerDefaults = {
  network: true,
  coast: false,
  ridges: false,
  zones: false,
  buildings: false,
  sections: true,
  contours: true,
  trees: true,
  labels: true,
  plantingAreas: false,
  issues: true
};
export const layerNames = {
  network: '路网节点与途经点',
  coast: '海岸线',
  ridges: '山脊与山头',
  zones: '台地、院墙与整平区',
  buildings: '建筑占地',
  sections: '剖面线与端点',
  contours: '等高线',
  trees: '植被',
  labels: '地名标注',
  plantingAreas: '绿化区与林间空地',
  issues: '校验标记'
};

export function handles(design, layers, selected) {
  const out = [];
  const add = (kind, id, point, role, index = 0) => out.push({ kind, id, point, role, index });
  if (layers.sections)
    for (const s of design.sections) s.points.forEach((p, i) => add('section', s.id, p, 'vertex', i));
  if (layers.coast) design.coast.points.forEach((p, i) => add('coast', 'coast', p, 'vertex', i));
  if (layers.ridges) {
    for (const r of design.ridges) r.points.forEach((p, i) => add('ridge', r.id, p.point, 'vertex', i));
    design.peaks.forEach(p => add('peak',p.id,p.center,'center'));
  }
  for(const [kind,list] of [['planting',design.vegetation.plantings],['clearing',design.vegetation.clearings]]) {
    for(const item of list) {
      if(!layers.plantingAreas && !(selected?.kind===kind && selected.id===item.id)) continue;
      const shape=kind==='planting'?{type:'polygon',points:item.points}:clearingShape(design,item);
      if(shape.points) shape.points.forEach((p,i)=>add(kind,item.id,p,'vertex',i));
      else {
        add(kind,item.id,shape.center,'center');
        if(shape.type==='ellipse') {
          add(kind,item.id,advance(shape.center,0,shape.radii[0]),'radiusX');
          add(kind,item.id,advance(shape.center,Math.PI/2,shape.radii[1]),'radiusY');
        } else for(const key of ['start','end']) add(kind,item.id,advance(shape.center,shape[key]*radians,shape.outer),key);
      }
    }
  }
  if (layers.zones)
    for (const z of design.zones) {
      const s = z.shape;
      if (s.points) {
        s.points.forEach((p, i) => add('zone', z.id, p, 'vertex', i));
        if (s.type === 'band') add('zone', z.id, advance(s.points[0], bearing(s.points[0], s.points[1]) + Math.PI / 2, s.width / 2), 'width');
      } else {
        add('zone', z.id, s.center, 'center');
        if (s.type === 'ellipse') {
          add('zone', z.id, advance(s.center, 0, s.radii[0]), 'radiusX');
          add('zone', z.id, advance(s.center, Math.PI / 2, s.radii[1]), 'radiusY');
        } else if (s.type === 'sector') {
          for (const key of ['start', 'end']) add('zone', z.id, advance(s.center, s[key] * radians, s.outer), key);
          for (const key of ['inner', 'outer']) add('zone', z.id, advance(s.center, (s.start + s.end) * radians / 2, s[key]), key);
        } else add('zone', z.id, advance(s.center, 0, s.radius), 'radius');
      }
    }
  if (layers.zones) for (const yard of design.yards ?? []) {
    yard.points?.forEach((p, i) => add('yard', yard.id, p, 'vertex', i));
  }
  for (const b of design.buildings) if(layers.buildings || selected?.kind==='building' && selected.id===b.id) {
      if (selected?.id !== b.id) add('building', b.id, b.center, 'center');
      if (b.shape === 'rect') {
        corners(b).forEach((p,i)=>add('building',b.id,p,'size',i));
        add('building', b.id, advance(b.center, b.angle * radians, b.size[0] / 2 + 3), 'rotate');
      } else {
        add('building', b.id, advance(b.center, 0, b.radius), 'radius');
        add('building', b.id, advance(b.center,(b.angle??0)*radians,b.radius+3),'rotate');
        if (b.shape === 'ring') add('building', b.id, advance(b.center, Math.PI, b.inner), 'inner');
      }
      for (const door of b.doors) {
        if (!layers.network || !design.nodes.some(n => n.type === 'door' && n.building === b.id && n.door === door.id)) {
          add('door', b.id, nodePose(design, { type: 'door', building: b.id, door: door.id }).point, door.id);
        }
      }
    }
  if (layers.network) {
    for (const e of design.edges) e.via.forEach((p, i) => add('via', e.id, p, 'vertex', i));
    for (const n of design.nodes) add('node', n.id, nodePose(design, n).point, n.type);
  }
  return out;
}

function slideDoor(d,node,p) {
  const b=d.buildings.find(item=>item.id===node.building), door=b.doors.find(item=>item.id===node.door);
  if(b.shape!=='rect') return moveNode(d,node,p);
  const wall=corners(b);
  door.t=projection(...p,wall[door.wall],wall[(door.wall+1)%wall.length]);
}

export function moveHandle(d, h, p) {
  const { id, index, role } = h;
  p = [clamp(p[0], d.grid.xMin, d.grid.xMax), clamp(p[1], d.grid.yMin, d.grid.yMax)].map(v => Math.round(v * 100) / 100);
  if (h.kind === 'node' || h.kind === 'via') {
    const node = h.kind === 'node' ? d.nodes.find(n => n.id === id) : null;
    if (node?.type !== 'gate' && node?.type !== 'door' && (d.yards ?? []).some(y => insideYard(areaBoundary(d, y), p))) return;
    if (node?.type === 'door') slideDoor(d,node,p);
    else if (node) moveNode(d, node, p);
    else d.edges.find(e => e.id === id).via[index] = p;
  }
  if (h.kind === 'section') {
    const ends = d.sections.find(s => s.id === id).points;
    if (distance(p, ends[1 - index]) >= 1) ends[index] = p;
  }
  if (h.kind === 'coast') d.coast.points[index] = p;
  if (h.kind === 'ridge') d.ridges.find(r => r.id === id).points[index].point = p;
  if (h.kind === 'peak') featureOf(d,h).center=p;
  if(h.kind==='planting' || h.kind==='clearing') {
    const item=featureOf(d,h);
    if(h.kind==='clearing' && !item.shape) {item.shape=clearingShape(d,item);delete item.zone;delete item.radii;}
    const shape=h.kind==='clearing'?item.shape:item;
    if(role==='vertex') {
      const copy=shape.points.slice();copy[index]=p;
      if(simpleBoundary(copy)) shape.points=copy;
    } else if(role==='center') shape.center=p;
    else if(role==='radiusX' || role==='radiusY') {
      const dim=role==='radiusX'?0:1;
      shape.radii[dim]=Math.max(1,Math.abs(p[dim]-shape.center[dim]));
    } else {
      const angle=bearing(shape.center,p)/radians;
      const delta=((angle-shape[role]+540)%360)-180;
      shape[role]=role==='start'?clamp(shape.start+delta,shape.end-359,shape.end-1):clamp(shape.end+delta,shape.start+1,shape.start+359);
      shape.outer=Math.max(1,distance(shape.center,p));
    }
  }
  if (h.kind === 'yard') {
    const yard = d.yards.find(y => y.id === id), next = yard.points.slice();
    next[index] = p;
    if (simpleBoundary(next)) yard.points = next;
  }
  if (h.kind === 'door') slideDoor(d, { type: 'door', building: id, door: role }, p);
  if (h.kind === 'zone') {
    const s = d.zones.find(z => z.id === id).shape;
    if (role === 'vertex') s.points[index] = p;
    else if (role === 'center') s.center = p;
    else if (role === 'width') s.width = Math.max(1, 2 * distance(s.points[0], p));
    else if (role === 'radiusX') s.radii[0] = Math.max(1, Math.abs(p[0] - s.center[0]));
    else if (role === 'radiusY') s.radii[1] = Math.max(1, Math.abs(p[1] - s.center[1]));
    else if (role === 'start' || role === 'end') s[role] = bearing(s.center, p) / radians;
    else {
      const radius = Math.max(1, distance(s.center, p));
      s[role] = role === 'inner' ? Math.min(radius, s.outer - .5) : role === 'outer' ? Math.max(radius, s.inner + .5) : radius;
    }
  }
  if (h.kind === 'building') {
    const b = d.buildings.find(b => b.id === id),
      a = b.angle * radians;
    if (role === 'center' || role==='body') b.center = p;
    else if(role==='title') b.titleOffset=[p[0]-b.center[0],p[1]-b.center[1]];
    else if (role === 'rotate') rotateBuilding(b,bearing(b.center,p)/radians);
    else if (role === 'size') {
      const x = p[0] - b.center[0],
        y = p[1] - b.center[1];
      b.size = [Math.max(1, 2 * Math.abs(x * Math.cos(a) + y * Math.sin(a))), Math.max(1, 2 * Math.abs(-x * Math.sin(a) + y * Math.cos(a)))];
    } else if (role === 'inner') b.inner = clamp(distance(b.center, p), .3, b.radius - .3);
    else resizeRadius(b,Math.max((b.inner ?? 0) + .3,distance(b.center,p)));
  }
}