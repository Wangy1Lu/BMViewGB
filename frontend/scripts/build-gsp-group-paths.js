const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_GEOJSON = path.join(ROOT, 'public', 'GSP_regions_4326_20260209.geojson');
const OUTPUT_JS = path.join(ROOT, 'src', 'components', 'Map', 'gspGroupPaths.js');

const ZONE_IDS = [
  '_P',
  '_N',
  '_G',
  '_F',
  '_M',
  '_D',
  '_E',
  '_B',
  '_A',
  '_K',
  '_L',
  '_H',
  '_J',
  '_C',
];

const WIDTH = 520;
const HEIGHT = 820;
const PADDING = 16;
const COORD_PRECISION = 6;
const PATH_PRECISION = 1;
const SIMPLIFICATION_TOLERANCE = 0.15;

function isCoordinate(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function collectCoordinates(value, output) {
  const stack = [value];

  while (stack.length) {
    const item = stack.pop();

    if (isCoordinate(item)) {
      output.push(item);
    } else if (Array.isArray(item)) {
      for (let i = item.length - 1; i >= 0; i -= 1) {
        stack.push(item[i]);
      }
    }
  }

  return output;
}

function coordinateKey(coord) {
  return `${Number(coord[0]).toFixed(COORD_PRECISION)},${Number(coord[1]).toFixed(COORD_PRECISION)}`;
}

function parseCoordinateKey(key) {
  return key.split(',').map(Number);
}

function lonLatToMercatorPoint([lon, lat]) {
  const lonRad = (Number(lon) * Math.PI) / 180;
  const latRad = (Number(lat) * Math.PI) / 180;

  return {
    x: lonRad,
    y: Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
  };
}

function createProjection(features) {
  const lonLatPairs = [];

  features.forEach(feature => {
    collectCoordinates(feature.geometry?.coordinates, lonLatPairs);
  });

  const projected = lonLatPairs.map(lonLatToMercatorPoint);
  const bounds = projected.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      maxX: Math.max(acc.maxX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxY: Math.max(acc.maxY, point.y),
    }),
    {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    }
  );

  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const scale = Math.min(
    (WIDTH - PADDING * 2) / rangeX,
    (HEIGHT - PADDING * 2) / rangeY
  );
  const fittedWidth = rangeX * scale;
  const fittedHeight = rangeY * scale;
  const offsetX = (WIDTH - fittedWidth) / 2;
  const offsetY = (HEIGHT - fittedHeight) / 2;

  return coordKey => {
    const point = lonLatToMercatorPoint(parseCoordinateKey(coordKey));

    return [
      offsetX + (point.x - bounds.minX) * scale,
      offsetY + (bounds.maxY - point.y) * scale,
    ];
  };
}

function getGeometryPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function buildBoundaryEdges(features) {
  const edgeMap = new Map();

  features.forEach(feature => {
    getGeometryPolygons(feature.geometry).forEach(polygon => {
      polygon.forEach(ring => {
        for (let i = 0; i < ring.length - 1; i += 1) {
          const start = coordinateKey(ring[i]);
          const end = coordinateKey(ring[i + 1]);

          if (start === end) continue;

          const edgeKey = start < end ? `${start}|${end}` : `${end}|${start}`;
          const existing = edgeMap.get(edgeKey) || [];
          existing.push({ start, end });
          edgeMap.set(edgeKey, existing);
        }
      });
    });
  });

  const boundaryEdges = [];
  const ambiguousEdges = [];

  edgeMap.forEach(edges => {
    if (edges.length === 1) {
      boundaryEdges.push(edges[0]);
    } else if (edges.length > 2) {
      ambiguousEdges.push(edges);
    }
  });

  return { boundaryEdges, ambiguousEdges };
}

function rebuildRings(edges) {
  const adjacency = new Map();

  edges.forEach((edge, index) => {
    edge.index = index;

    if (!adjacency.has(edge.start)) {
      adjacency.set(edge.start, []);
    }

    adjacency.get(edge.start).push(edge);
  });

  const used = new Set();
  const rings = [];
  const openRings = [];

  edges.forEach(edge => {
    if (used.has(edge.index)) return;

    const start = edge.start;
    const ring = [edge.start, edge.end];

    used.add(edge.index);

    while (ring[ring.length - 1] !== start) {
      const current = ring[ring.length - 1];
      const nextEdge = (adjacency.get(current) || []).find(candidate => (
        !used.has(candidate.index)
      ));

      if (!nextEdge) {
        openRings.push(ring);
        break;
      }

      used.add(nextEdge.index);
      ring.push(nextEdge.end);
    }

    rings.push(ring);
  });

  return { rings, openRings };
}

function squaredDistance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];

  if (dx === 0 && dy === 0) {
    return Math.sqrt(squaredDistance(point, start));
  }

  const t = Math.max(0, Math.min(1, (
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
    (dx * dx + dy * dy)
  )));

  const projection = [start[0] + t * dx, start[1] + t * dy];
  return Math.sqrt(squaredDistance(point, projection));
}

function simplifyOpenLine(points, tolerance) {
  if (points.length <= 2) return points;

  let maxDistance = -1;
  let index = -1;

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);

    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points[points.length - 1]];
  }

  const first = simplifyOpenLine(points.slice(0, index + 1), tolerance);
  const second = simplifyOpenLine(points.slice(index), tolerance);

  return first.slice(0, -1).concat(second);
}

function simplifyClosedRing(points, tolerance) {
  if (points.length <= 4) return points;

  const closed = squaredDistance(points[0], points[points.length - 1]) < 0.000001;
  const uniquePoints = closed ? points.slice(0, -1) : points;

  if (uniquePoints.length <= 4) return points;

  let farthestIndex = 1;
  let farthestDistance = -1;

  for (let i = 1; i < uniquePoints.length; i += 1) {
    const distance = squaredDistance(uniquePoints[i], uniquePoints[0]);

    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = i;
    }
  }

  const first = simplifyOpenLine(uniquePoints.slice(0, farthestIndex + 1), tolerance);
  const second = simplifyOpenLine(
    uniquePoints.slice(farthestIndex).concat([uniquePoints[0]]),
    tolerance
  );
  const simplified = first.slice(0, -1).concat(second);

  if (simplified.length < 4) return points;
  return simplified;
}

function ringArea(points) {
  let sum = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    sum += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }

  return Math.abs(sum / 2);
}

function pointsToPath(points) {
  return points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command}${point[0].toFixed(PATH_PRECISION)} ${point[1].toFixed(PATH_PRECISION)}`;
    })
    .join(' ')
    .concat(' Z');
}

function buildZonePaths(features, projection) {
  const { boundaryEdges, ambiguousEdges } = buildBoundaryEdges(features);
  const { rings, openRings } = rebuildRings(boundaryEdges);

  const paths = rings
    .map(ring => ring.map(projection))
    .map(points => simplifyClosedRing(points, SIMPLIFICATION_TOLERANCE))
    .sort((a, b) => ringArea(b) - ringArea(a))
    .map(pointsToPath);

  return {
    paths,
    edgeCount: boundaryEdges.length,
    ringCount: rings.length,
    openRingCount: openRings.length,
    ambiguousEdgeCount: ambiguousEdges.length,
  };
}

function main() {
  const geoJson = JSON.parse(fs.readFileSync(INPUT_GEOJSON, 'utf8'));
  const zoneIdSet = new Set(ZONE_IDS);
  const features = (geoJson.features || []).filter(feature => (
    zoneIdSet.has(String(feature.properties?.GSPGroup || '').trim())
  ));
  const projection = createProjection(features);
  const pathsByZone = {};
  const buildStats = {};

  ZONE_IDS.forEach(zoneId => {
    const zoneFeatures = features.filter(feature => (
      String(feature.properties?.GSPGroup || '').trim() === zoneId
    ));
    const zoneResult = buildZonePaths(zoneFeatures, projection);

    pathsByZone[zoneId] = zoneResult.paths;
    buildStats[zoneId] = {
      featureCount: zoneFeatures.length,
      pathCount: zoneResult.paths.length,
      ringCount: zoneResult.ringCount,
      edgeCount: zoneResult.edgeCount,
      openRingCount: zoneResult.openRingCount,
      ambiguousEdgeCount: zoneResult.ambiguousEdgeCount,
    };
  });

  const content = [
    '// Generated by frontend/scripts/build-gsp-group-paths.js.',
    '// Source: NESO GIS Boundaries for GB Grid Supply Points, GSP_regions_4326_20260209.geojson.',
    '',
    'export const GSP_GROUP_BOUNDARY_SOURCE = Object.freeze({',
    "  name: 'NESO GIS Boundaries for GB Grid Supply Points',",
    "  file: 'GSP_regions_4326_20260209.geojson',",
    "  groupedBy: 'GSPGroup',",
    `  viewBox: '0 0 ${WIDTH} ${HEIGHT}',`,
    `  generatedAt: '${new Date().toISOString()}',`,
    '});',
    '',
    `export const GSP_GROUP_BOUNDARY_BUILD_STATS = Object.freeze(${JSON.stringify(buildStats, null, 2)});`,
    '',
    `export const GSP_GROUP_ZONE_PATHS = Object.freeze(${JSON.stringify(pathsByZone, null, 2)});`,
    '',
  ].join('\n');

  fs.writeFileSync(OUTPUT_JS, content);
  console.log(`Wrote ${OUTPUT_JS}`);
}

main();
