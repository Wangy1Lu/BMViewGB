import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styled from '@emotion/styled';
import DateSelector from './DateSelector';
import SettlementPeriodSlider from './SettlementPeriodSlider';
import { fetchNodeMetrics } from '../services/api';
import { getZoneColor } from './Map';

const GSP_BOUNDARY_GEOJSON_PATH = '/GSP_regions_4326_20260209.geojson';
const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 8;
const MAP_ZOOM_STEP = 1.35;
const MAP_PAN_MARGIN_RATIO = 0.35;
const DEFAULT_MAP_TRANSFORM = Object.freeze({ scale: 1, x: 0, y: 0 });

let gspBoundaryGeoJsonCache = null;

async function loadGspBoundaryGeoJson() {
  if (!gspBoundaryGeoJsonCache) {
    gspBoundaryGeoJsonCache = fetch(GSP_BOUNDARY_GEOJSON_PATH).then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load ${GSP_BOUNDARY_GEOJSON_PATH}`);
      }
      return response.json();
    });
  }

  return gspBoundaryGeoJsonCache;
}

const PaneContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border: 1px solid #e0e0e0;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid #eaeaea;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
`;

const TitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const Title = styled.h2`
  margin: 0;
  color: #0f172a;
  font-size: 1.45rem;
  font-weight: 850;
  line-height: 1.15;
`;

const TitleMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 0.84rem;
  font-weight: 650;
`;

const ZoneBadge = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  background: #e0f2fe;
  color: #075985;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 0.82rem;
  font-weight: 800;
`;

const CloseButton = styled.button`
  padding: 8px 12px;
  font-size: 0.9rem;
  cursor: pointer;
  background-color: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;

  &:hover {
    background-color: #e5e7eb;
  }
`;

const Content = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`;

const MapArea = styled.div`
  flex: 3;
  position: relative;
  padding: 16px;
  border-right: 1px solid #eaeaea;
  min-height: 600px;
`;

const InfoArea = styled.div`
  flex: 2;
  padding: 16px;
  overflow-y: auto;
  background: #fafafa;
`;

const RightControls = styled.div`
  margin-bottom: 16px;
  padding: 0;
  background: transparent;

  & > div:first-of-type {
    margin-bottom: 12px;
  }
`;

const LayerSelector = styled.div`
  display: inline-flex;
  gap: 4px;
  margin-bottom: 12px;
  padding: 3px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
`;

const LayerButton = styled.button`
  min-width: 96px;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
  font-weight: 600;
  color: ${props => (props.$active ? '#ffffff' : '#334155')};
  background: ${props => (props.$active ? '#0f766e' : 'transparent')};

  &:hover {
    background: ${props => (props.$active ? '#0f766e' : '#f1f5f9')};
  }
`;

const Status = styled.div`
  padding: 12px;
  border-radius: 6px;
  background: ${props => (props.error ? '#ffeeee' : '#f5f5f5')};
  border: 1px solid ${props => (props.error ? '#ffcccc' : '#e0e0e0')};
  margin-bottom: 10px;
`;

const Svg = styled.svg`
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #fbfdff 0%, #f7fbff 100%);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: ${props => (props.$isPanning || props.$isDraggable ? 'move' : 'default')};
  touch-action: none;
  user-select: none;
`;

const GuideText = styled.div`
  position: absolute;
  top: 28px;
  left: 28px;
  z-index: 3;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #dbe4ee;
  border-radius: 10px;
  padding: 8px 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  color: #334155;
  font-size: 0.92rem;
  max-width: 360px;
  line-height: 1.4;
`;

const ZoomControls = styled.div`
  position: absolute;
  top: 28px;
  right: 28px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #dbe4ee;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
`;

const ZoomButton = styled.button`
  min-width: 30px;
  height: 30px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: ${props => (props.disabled ? '#f1f5f9' : '#ffffff')};
  color: ${props => (props.disabled ? '#94a3b8' : '#0f172a')};
  font-size: 0.88rem;
  font-weight: 700;
  cursor: ${props => (props.disabled ? 'not-allowed' : 'pointer')};

  &:hover {
    background: ${props => (props.disabled ? '#f1f5f9' : '#eaf6ff')};
  }
`;

const ZoomLevel = styled.div`
  min-width: 44px;
  padding: 0 5px;
  color: #334155;
  font-size: 0.82rem;
  font-weight: 700;
  text-align: center;
`;

const NodeLegend = styled.div`
  position: absolute;
  left: 28px;
  bottom: 28px;
  z-index: 4;
  width: min(285px, calc(100% - 56px));
  padding: 10px 12px;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  pointer-events: none;
`;

const LegendTitle = styled.div`
  margin-bottom: 7px;
  color: #0f172a;
  font-size: 0.82rem;
  font-weight: 800;
`;

const LegendRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  color: #334155;
  font-size: 0.78rem;
  line-height: 1.25;
`;

const LegendMarker = styled.svg`
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  overflow: visible;
`;

const Tooltip = styled.div`
  position: absolute;
  left: ${props => props.x}px;
  top: ${props => props.y}px;
  width: 320px;
  max-width: calc(100% - 24px);
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  pointer-events: none;
  overflow-wrap: anywhere;
  z-index: 5;
`;

const Small = styled.div`
  font-size: 0.9rem;
  color: #4b5563;
  margin-top: 4px;
`;

const MetricsPanelContainer = styled.div`
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
`;

const MetricsTitle = styled.h3`
  margin-top: 0;
  margin-bottom: 15px;
  border-bottom: 2px solid #007bff;
  padding-bottom: 5px;
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 20px;
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
`;

const StatLabel = styled.span`
  font-size: 0.9rem;
  color: #6c757d;
`;

const StatValue = styled.span`
  font-size: 1.2rem;
  font-weight: bold;
  color: #343a40;
`;

const SubStatItem = styled(StatItem)`
  margin-left: 15px;
  margin-top: -5px;
`;

const SectionTitle = styled.div`
  grid-column: 1 / -1;
  font-weight: bold;
  margin-top: 10px;
  margin-bottom: -5px;
  color: #333;
  border-bottom: 1px solid #ddd;
  padding-bottom: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: ${(props) => (props.isCollapsible ? 'pointer' : 'default')};

  &:hover {
    background-color: ${(props) => (props.isCollapsible ? '#f0f0f0' : 'transparent')};
  }
`;

const CollapseIcon = styled.span`
  font-size: 1.2rem;
  font-weight: bold;
`;

const CollapsibleContent = styled.div`
  grid-column: 1 / -1;
  display: contents;
`;

const MessageBlock = styled.div`
  color: #4b5563;
  font-size: 0.95rem;
  line-height: 1.5;
  margin-bottom: 12px;
`;

const ContributionButton = styled.button`
  padding: 8px 10px;
  border: 1px solid #0f766e;
  border-radius: 6px;
  color: #0f766e;
  background: #f0fdfa;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    background: #ccfbf1;
  }
`;

const ContributionToolbar = styled.div`
  display: flex;
  justify-content: flex-end;
  margin: -2px 0 14px;
`;

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(15, 23, 42, 0.34);
`;

const ContributionDialog = styled.div`
  width: min(1060px, calc(100vw - 56px));
  max-height: min(780px, calc(100vh - 56px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
`;

const DialogHeader = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 22px;
  border-bottom: 1px solid #e5e7eb;
`;

const DialogTitle = styled.div`
  font-weight: 800;
  color: #111827;
  font-size: 1.05rem;
`;

const DialogSubtitle = styled.div`
  margin-top: 4px;
  color: #64748b;
  font-size: 0.9rem;
`;

const DialogCloseButton = styled.button`
  align-self: flex-start;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  cursor: pointer;

  &:hover {
    background: #f8fafc;
  }
`;

const DialogBody = styled.div`
  padding: 18px 22px 22px;
  overflow: auto;
`;

const ContributionSummary = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const SummaryTile = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  background: #f8fafc;
`;

const SummaryLabel = styled.div`
  font-size: 0.78rem;
  color: #64748b;
  margin-bottom: 4px;
`;

const SummaryValue = styled.div`
  font-size: 1rem;
  color: #111827;
  font-weight: 800;
`;

const TableWrap = styled.div`
  overflow-x: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
`;

const ContributionTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 900px;
  font-size: 0.86rem;

  th,
  td {
    padding: 9px 10px;
    border-bottom: 1px solid #e5e7eb;
    text-align: right;
    white-space: nowrap;
  }

  th {
    color: #475569;
    background: #f8fafc;
    font-weight: 800;
  }

  th:first-of-type,
  td:first-of-type,
  th:nth-of-type(3),
  td:nth-of-type(3) {
    text-align: left;
  }

  tbody tr:last-of-type td {
    border-bottom: 0;
  }

  tbody tr:hover {
    background: #f8fafc;
  }
`;

const BmuId = styled.span`
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-weight: 700;
  color: #0f172a;
`;

const MutedText = styled.span`
  color: #94a3b8;
`;

function isMetricsEnabledNode(node) {
  return node?.node_view_mode === 'direct_metrics_enabled';
}

function getNodeType(node) {
  return node?.node_type || 'gnode';
}

function getNodeId(node) {
  return node?.node_id || node?.gnode_id || node?.nms_node_id || '';
}

function getNodeName(node) {
  return node?.node_name || node?.gnode_name || node?.nms_node_name || getNodeId(node);
}

function getNodeVisualForState(node, selectedNodeId = '') {
  const isSelected = selectedNodeId && getNodeId(node) === selectedNodeId;
  const isEnabled = isMetricsEnabledNode(node);
  const isNmsNode = getNodeType(node) === 'nms_node';
  const usesEnrichedCoordinate = isNmsNode && Boolean(node?.coordinate_enriched);
  const isOutsideZoneBoundary = Boolean(node?.is_outside_zone_boundary);

  if (isEnabled) {
    return {
      fill: isSelected ? '#c2410c' : (isNmsNode ? '#0f766e' : '#2563eb'),
      stroke: isSelected
        ? '#ffffff'
        : (isOutsideZoneBoundary || usesEnrichedCoordinate ? '#d97706' : (isNmsNode ? '#042f2e' : '#0f172a')),
      strokeDasharray: isOutsideZoneBoundary ? '3 2' : (usesEnrichedCoordinate ? '2 1.5' : undefined),
      radius: isSelected ? 7 : 5,
      cursor: 'pointer',
      haloFill: isOutsideZoneBoundary || usesEnrichedCoordinate ? '#f59e0b' : (isNmsNode ? '#2dd4bf' : '#60a5fa'),
      haloOpacity: isOutsideZoneBoundary ? (isSelected ? 0.24 : 0.16) : (isSelected ? 0.18 : 0.10),
    };
  }

  return {
    fill: '#9ca3af',
    stroke: isOutsideZoneBoundary ? '#d97706' : '#e5e7eb',
    strokeDasharray: isOutsideZoneBoundary ? '3 2' : undefined,
    radius: isSelected ? 6 : 4.5,
    cursor: 'pointer',
    haloFill: isOutsideZoneBoundary ? '#f59e0b' : '#9ca3af',
    haloOpacity: isOutsideZoneBoundary ? 0.14 : 0.08,
  };
}

function getNodeIdLabel(node) {
  return getNodeType(node) === 'nms_node' ? 'NMS Node ID' : 'GNode ID';
}

function getMetricsAggregationLabel(metrics) {
  if (!metrics) return '';
  if (metrics.aggregation === 'daily') return 'Daily';
  if (metrics.aggregation === 'hourly') return `Hour ${metrics.time_point}`;
  return `Settlement Period ${metrics.time_point}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampMapTransform(transform, width, height, contentBounds = null) {
  const scale = clamp(Number(transform?.scale) || 1, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
  const panMarginX = width * MAP_PAN_MARGIN_RATIO;
  const panMarginY = height * MAP_PAN_MARGIN_RATIO;
  const bounds = contentBounds || {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: height,
  };
  const minAllowedX = width - bounds.maxX * scale - panMarginX;
  const maxAllowedX = -bounds.minX * scale + panMarginX;
  const minAllowedY = height - bounds.maxY * scale - panMarginY;
  const maxAllowedY = -bounds.minY * scale + panMarginY;

  return {
    scale,
    x: clamp(Number(transform?.x) || 0, minAllowedX, maxAllowedX),
    y: clamp(Number(transform?.y) || 0, minAllowedY, maxAllowedY),
  };
}

function formatMwh(value, digits = 2) {
  return `${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} MWh`;
}

function formatCurrency(value) {
  return `GBP ${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value, digits = 1) {
  return `${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function getFeatureZoneId(feature) {
  const props = feature?.properties || {};
  return (
    props.GSPGroup ||
    props.gsp_group ||
    props.GSP_GROUP ||
    props.zone_id ||
    props.ZoneID ||
    ''
  ).toString().trim();
}

function pointInRing([lon, lat], ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;

  let inside = false;
  let previousIndex = ring.length - 1;

  for (let currentIndex = 0; currentIndex < ring.length; currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];

    if (!Array.isArray(current) || !Array.isArray(previous)) {
      previousIndex = currentIndex;
      continue;
    }

    const [currentLon, currentLat] = current;
    const [previousLon, previousLat] = previous;

    if (
      Number.isFinite(currentLon) &&
      Number.isFinite(currentLat) &&
      Number.isFinite(previousLon) &&
      Number.isFinite(previousLat) &&
      ((currentLat > lat) !== (previousLat > lat))
    ) {
      const intersectLon =
        ((previousLon - currentLon) * (lat - currentLat)) /
          ((previousLat - currentLat) || Number.EPSILON) +
        currentLon;

      if (lon < intersectLon) {
        inside = !inside;
      }
    }

    previousIndex = currentIndex;
  }

  return inside;
}

function pointInPolygon(lonLat, polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return false;
  if (!pointInRing(lonLat, polygon[0])) return false;

  return !polygon.slice(1).some(ring => pointInRing(lonLat, ring));
}

function pointInGeometry(lonLat, geometry) {
  if (!lonLat || !geometry) return false;

  if (geometry.type === 'Polygon') {
    return pointInPolygon(lonLat, geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => pointInPolygon(lonLat, polygon));
  }

  return false;
}

function collectLonLatPairs(value, output = []) {
  if (!Array.isArray(value)) return output;

  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    const lon = value[0];
    const lat = value[1];

    if (
      Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      lon >= -10 &&
      lon <= 5 &&
      lat >= 49 &&
      lat <= 62
    ) {
      output.push([lon, lat]);
    }

    return output;
  }

  value.forEach(child => collectLonLatPairs(child, output));
  return output;
}

function lonLatToMercatorPoint(lon, lat) {
  const lonRad = (lon * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;

  return {
    x: lonRad,
    y: Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
  };
}

function createGeoProjection(features, width, height, padding = 36) {
  const allLonLatPairs = [];

  features.forEach(feature => {
    collectLonLatPairs(feature?.geometry?.coordinates, allLonLatPairs);
  });

  if (!allLonLatPairs.length) return null;

  const projected = allLonLatPairs.map(([lon, lat]) => lonLatToMercatorPoint(lon, lat));

  const minX = Math.min(...projected.map(p => p.x));
  const maxX = Math.max(...projected.map(p => p.x));
  const minY = Math.min(...projected.map(p => p.y));
  const maxY = Math.max(...projected.map(p => p.y));

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;

  const scale = Math.min(
    availableWidth / rangeX,
    availableHeight / rangeY
  );

  const fittedWidth = rangeX * scale;
  const fittedHeight = rangeY * scale;

  const offsetX = (width - fittedWidth) / 2;
  const offsetY = (height - fittedHeight) / 2;

  const project = ([lon, lat]) => {
    const p = lonLatToMercatorPoint(Number(lon), Number(lat));

    return [
      offsetX + (p.x - minX) * scale,
      offsetY + (maxY - p.y) * scale,
    ];
  };

  return {
    project,
    bounds: {
      minX,
      maxX,
      minY,
      maxY,
      scale,
      offsetX,
      offsetY,
      fittedWidth,
      fittedHeight,
    },
  };
}

function ringToPath(ring, projection) {
  if (!Array.isArray(ring) || ring.length === 0 || !projection?.project) {
    return '';
  }

  const commands = ring
    .map((coord, index) => {
      if (!Array.isArray(coord) || coord.length < 2) return '';

      const [x, y] = projection.project([coord[0], coord[1]]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return '';

      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .filter(Boolean);

  if (!commands.length) return '';

  return `${commands.join(' ')} Z`;
}

function geometryToSvgPath(geometry, projection) {
  if (!geometry || !projection?.project) return '';

  if (geometry.type === 'Polygon') {
    return geometry.coordinates
      .map(ring => ringToPath(ring, projection))
      .filter(Boolean)
      .join(' ');
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .flatMap(polygon => polygon.map(ring => ringToPath(ring, projection)))
      .filter(Boolean)
      .join(' ');
  }

  return '';
}

function getNodeCoordinates(node) {
  const lon = Number(node?.node_lon ?? node?.gnode_lon ?? node?.nms_node_lon);
  const lat = Number(node?.node_lat ?? node?.gnode_lat ?? node?.nms_node_lat);

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  return [lon, lat];
}

const NodeDrilldownPane = ({
  zone,
  zoneName,
  zoneData,
  loading,
  error,
  nodes,
  nodeLayer,
  onNodeLayerChange,
  excludedMissingCoordinateCount,
  selectedNode,
  onNodeSelect,
  onClearSelectedNode,
  onClose,
  selectedDate,
  onDateChange,
  sliderLabel,
  sliderValueLabel,
  sliderValueMeta,
  sliderMin,
  sliderMax,
  sliderDisabled,
  currentSettlementPeriod,
  onSettlementPeriodChange,
  aggregation,
}) => {
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({
    anchorX: 0,
    anchorY: 0,
    x: 0,
    y: 0,
  });
  const [mapTransform, setMapTransform] = useState(DEFAULT_MAP_TRANSFORM);
  const [isPanningMap, setIsPanningMap] = useState(false);

  const [zoneBoundaryFeatures, setZoneBoundaryFeatures] = useState([]);
  const [boundaryLoading, setBoundaryLoading] = useState(false);
  const [boundaryError, setBoundaryError] = useState('');

  const [nodeMetrics, setNodeMetrics] = useState(null);
  const [nodeMetricsLoading, setNodeMetricsLoading] = useState(false);
  const [nodeMetricsError, setNodeMetricsError] = useState('');
  const [nodeMetricsNotice, setNodeMetricsNotice] = useState('');
  const [nodeSelectionMessage, setNodeSelectionMessage] = useState('');
  const [contributionsOpen, setContributionsOpen] = useState(false);
  const nodeMetricsRequestRef = useRef(0);

  const [zoneCollapsed, setZoneCollapsed] = useState(true);
  const [selectedNodeCollapsed, setSelectedNodeCollapsed] = useState(false);

  const selectedNodeMetricsEnabled = isMetricsEnabledNode(selectedNode);

  const width = 700;
  const height = 600;
  const isMapAtDefault =
    Math.abs(mapTransform.scale - DEFAULT_MAP_TRANSFORM.scale) < 0.001 &&
    Math.abs(mapTransform.x - DEFAULT_MAP_TRANSFORM.x) < 0.001 &&
    Math.abs(mapTransform.y - DEFAULT_MAP_TRANSFORM.y) < 0.001;
  const mapAreaRef = useRef(null);
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const panStartRef = useRef(null);
  const didPanRef = useRef(false);

  const getTooltipPosition = (
    anchorX,
    anchorY,
    tooltipWidth = 320,
    tooltipHeight = 190
  ) => {
    const mapRect = mapAreaRef.current?.getBoundingClientRect();
    const mapWidth = mapRect?.width || width;
    const mapHeight = mapRect?.height || height;
    const margin = 12;
    const offset = 14;

    const preferredRightX = anchorX + offset;
    const preferredLeftX = anchorX - tooltipWidth - offset;
    const x = clamp(
      preferredRightX + tooltipWidth > mapWidth - margin
        ? preferredLeftX
        : preferredRightX,
      margin,
      Math.max(margin, mapWidth - tooltipWidth - margin)
    );

    const preferredBottomY = anchorY + offset;
    const preferredTopY = anchorY - tooltipHeight - offset;
    const y = clamp(
      preferredBottomY + tooltipHeight > mapHeight - margin
        ? preferredTopY
        : preferredBottomY,
      margin,
      Math.max(margin, mapHeight - tooltipHeight - margin)
    );

    return {
      anchorX,
      anchorY,
      x,
      y,
    };
  };

  const updateTooltipPosition = (event) => {
    const mapRect = mapAreaRef.current?.getBoundingClientRect();
    const anchorX = mapRect
      ? event.clientX - mapRect.left
      : event.nativeEvent.offsetX;
    const anchorY = mapRect
      ? event.clientY - mapRect.top
      : event.nativeEvent.offsetY;

    setTooltipPos(getTooltipPosition(anchorX, anchorY));
  };

  useLayoutEffect(() => {
    if (!hoveredNode || !tooltipRef.current) return;

    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    setTooltipPos(current => {
      const nextPosition = getTooltipPosition(
        current.anchorX,
        current.anchorY,
        tooltipRect.width,
        tooltipRect.height
      );

      if (
        Math.abs(nextPosition.x - current.x) < 0.5 &&
        Math.abs(nextPosition.y - current.y) < 0.5
      ) {
        return current;
      }

      return nextPosition;
    });
  }, [hoveredNode, tooltipPos.anchorX, tooltipPos.anchorY]);

  const getSvgPoint = (event) => {
    const svg = svgRef.current;

    if (!svg || typeof svg.createSVGPoint !== 'function') {
      return null;
    }

    const matrix = svg.getScreenCTM();
    if (!matrix) return null;

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;

    const transformedPoint = point.matrixTransform(matrix.inverse());
    return {
      x: transformedPoint.x,
      y: transformedPoint.y,
    };
  };

  const zoomMapAt = (point, nextScale) => {
    if (!point) return;

    setMapTransform(current => {
      const scale = clamp(nextScale, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
      const worldX = (point.x - current.x) / current.scale;
      const worldY = (point.y - current.y) / current.scale;

      return clampMapTransform({
        scale,
        x: point.x - worldX * scale,
        y: point.y - worldY * scale,
      }, width, height, mapContentBounds);
    });
  };

  const handleMapWheel = (event) => {
    event.preventDefault();
    const point = getSvgPoint(event);
    const factor = event.deltaY < 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP;

    setMapTransform(current => {
      const scale = clamp(current.scale * factor, MIN_MAP_ZOOM, MAX_MAP_ZOOM);

      if (!point) {
        return clampMapTransform({ ...current, scale }, width, height, mapContentBounds);
      }

      const worldX = (point.x - current.x) / current.scale;
      const worldY = (point.y - current.y) / current.scale;

      return clampMapTransform({
        scale,
        x: point.x - worldX * scale,
        y: point.y - worldY * scale,
      }, width, height, mapContentBounds);
    });
  };

  const handleZoomButton = (direction) => {
    const focusPoint = { x: width / 2, y: height / 2 };
    const factor = direction > 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP;
    zoomMapAt(focusPoint, mapTransform.scale * factor);
  };

  const resetMapView = () => {
    setMapTransform(DEFAULT_MAP_TRANSFORM);
    setIsPanningMap(false);
    panStartRef.current = null;
    didPanRef.current = false;
  };

  const handleMapPointerDown = (event) => {
    if (event.button !== 0) return;

    if (event.target?.closest?.('[data-node-hit-target="true"]')) {
      return;
    }

    event.preventDefault();
    const point = getSvgPoint(event);
    if (!point) return;

    panStartRef.current = {
      pointerId: event.pointerId,
      point,
      clientX: event.clientX,
      clientY: event.clientY,
      transform: mapTransform,
    };
    didPanRef.current = false;
    setIsPanningMap(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleMapPointerMove = (event) => {
    const panStart = panStartRef.current;
    if (!panStart || panStart.pointerId !== event.pointerId) return;

    event.preventDefault();
    const point = getSvgPoint(event);
    if (!point) return;

    const clientDx = event.clientX - panStart.clientX;
    const clientDy = event.clientY - panStart.clientY;

    if (Math.hypot(clientDx, clientDy) > 2) {
      didPanRef.current = true;
    }

    setMapTransform(clampMapTransform({
      scale: panStart.transform.scale,
      x: panStart.transform.x + point.x - panStart.point.x,
      y: panStart.transform.y + point.y - panStart.point.y,
    }, width, height, mapContentBounds));
  };

  const handleMapPointerEnd = (event) => {
    const panStart = panStartRef.current;
    if (!panStart || panStart.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    panStartRef.current = null;
    setIsPanningMap(false);
  };

  const handleMapPointerCancel = (event) => {
    const panStart = panStartRef.current;
    if (!panStart || panStart.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    panStartRef.current = null;
    setIsPanningMap(false);
    didPanRef.current = false;
  };

  useEffect(() => {
    let cancelled = false;

    const loadBoundary = async () => {
      if (!zone) {
        setZoneBoundaryFeatures([]);
        setBoundaryError('');
        return;
      }

      setBoundaryLoading(true);
      setBoundaryError('');
      setZoneBoundaryFeatures([]);

      try {
        const geoJson = await loadGspBoundaryGeoJson();

        if (cancelled) return;

        const features = Array.isArray(geoJson?.features) ? geoJson.features : [];
        const zoneKey = String(zone).trim();

        const matchedFeatures = features.filter(feature => {
          return getFeatureZoneId(feature) === zoneKey;
        });

        setZoneBoundaryFeatures(matchedFeatures);

        if (!matchedFeatures.length) {
          setBoundaryError(`No GeoJSON boundary found for zone ${zoneKey}.`);
        }
      } catch (err) {
        if (cancelled) return;
        setZoneBoundaryFeatures([]);
        setBoundaryError(
          err?.message ||
          'Failed to load zone boundary GeoJSON.'
        );
      } finally {
        if (!cancelled) {
          setBoundaryLoading(false);
        }
      }
    };

    loadBoundary();

    return () => {
      cancelled = true;
    };
  }, [zone]);

  useEffect(() => {
    setMapTransform(DEFAULT_MAP_TRANSFORM);
    setIsPanningMap(false);
    panStartRef.current = null;
    didPanRef.current = false;
  }, [zone]);

  const geoProjection = useMemo(() => {
    if (!zoneBoundaryFeatures.length) return null;
    return createGeoProjection(zoneBoundaryFeatures, width, height, 34);
  }, [zoneBoundaryFeatures]);

  const zoneBoundaryPaths = useMemo(() => {
    if (!geoProjection) return [];

    return zoneBoundaryFeatures
      .map((feature, index) => ({
        id:
          feature?.properties?.GSPs ||
          feature?.properties?.CDCA_I030 ||
          `boundary-${index}`,
        d: geometryToSvgPath(feature.geometry, geoProjection),
      }))
      .filter(item => item.d);
  }, [zoneBoundaryFeatures, geoProjection]);

  const projectedNodes = useMemo(() => {
    if (!geoProjection?.project) return [];

    return (nodes || [])
      .map(node => {
        const lonLat = getNodeCoordinates(node);
        if (!lonLat) return null;

        const [x, y] = geoProjection.project(lonLat);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return null;
        }

        const isOutsideZoneBoundary =
          zoneBoundaryFeatures.length > 0 &&
          !zoneBoundaryFeatures.some(feature => (
            pointInGeometry(lonLat, feature.geometry)
          ));

        return {
          ...node,
          x,
          y,
          is_outside_zone_boundary: isOutsideZoneBoundary,
        };
      })
      .filter(Boolean);
  }, [nodes, geoProjection, zoneBoundaryFeatures]);

  const mapContentBounds = useMemo(() => {
    const xs = [0, width];
    const ys = [0, height];

    projectedNodes.forEach(node => {
      if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
        xs.push(node.x);
        ys.push(node.y);
      }
    });

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }, [projectedNodes]);

  useEffect(() => {
    setMapTransform(current => (
      clampMapTransform(current, width, height, mapContentBounds)
    ));
  }, [mapContentBounds]);

  const selectedProjectedNode = useMemo(() => {
    if (!selectedNode || !projectedNodes.length) return null;
    const selectedNodeId = getNodeId(selectedNode);
    return projectedNodes.find(n => getNodeId(n) === selectedNodeId) || null;
  }, [selectedNode, projectedNodes]);

  const nodeLegendItems = useMemo(() => {
    const items = [];
    const isSpecialCoordinateNode = (node) => {
      const isNmsNode = getNodeType(node) === 'nms_node';
      const usesEnrichedCoordinate = isNmsNode && Boolean(node?.coordinate_enriched);
      const isOutsideZoneBoundary = Boolean(node?.is_outside_zone_boundary);

      return usesEnrichedCoordinate || isOutsideZoneBoundary;
    };

    const metricsNode = projectedNodes.find(node => (
      isMetricsEnabledNode(node) && !isSpecialCoordinateNode(node)
    ));
    const spatialNode = projectedNodes.find(node => (
      !isMetricsEnabledNode(node) && !isSpecialCoordinateNode(node)
    ));
    const specialMetricsNode = projectedNodes.find(node => (
      isMetricsEnabledNode(node) && isSpecialCoordinateNode(node)
    ));
    const specialSpatialNode = projectedNodes.find(node => (
      !isMetricsEnabledNode(node) && isSpecialCoordinateNode(node)
    ));

    if (metricsNode) {
      items.push({
        key: 'metrics-enabled',
        label: nodeLayer === 'nms' ? 'NMS node with BMU metrics' : 'GNode with BMU metrics',
        visual: getNodeVisualForState(metricsNode),
      });
    }

    if (spatialNode) {
      items.push({
        key: 'spatial-only',
        label: 'Spatial-only node',
        visual: getNodeVisualForState(spatialNode),
      });
    }

    if (specialMetricsNode) {
      items.push({
        key: 'special-coordinate-metrics',
        label: 'BMU metrics, enriched/outside coordinate',
        visual: getNodeVisualForState(specialMetricsNode),
      });
    }

    if (specialSpatialNode) {
      items.push({
        key: 'special-coordinate-spatial',
        label: 'Spatial-only outside-boundary coordinate',
        visual: getNodeVisualForState(specialSpatialNode),
      });
    }

    if (selectedProjectedNode) {
      const selectedNodeId = getNodeId(selectedProjectedNode);

      items.push({
        key: 'selected',
        label: 'Selected node',
        visual: getNodeVisualForState(selectedProjectedNode, selectedNodeId),
        selected: true,
      });
    }

    return items;
  }, [nodeLayer, projectedNodes, selectedProjectedNode]);

  const directConnectCount = useMemo(() => {
    return (nodes || []).filter(n => n.dc_name).length;
  }, [nodes]);

  const gspCount = useMemo(() => {
    return new Set((nodes || []).map(n => n.gsp_name).filter(Boolean)).size;
  }, [nodes]);

  const enabledNodeCount = useMemo(() => {
    return (nodes || []).filter(n => isMetricsEnabledNode(n)).length;
  }, [nodes]);

  const mappedBmuCount = useMemo(() => {
    const bmus = new Set();

    (nodes || []).forEach(node => {
      String(node.direct_bmu_list || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => bmus.add(item));
    });

    return bmus.size;
  }, [nodes]);

  const outsideBoundaryNodeCount = useMemo(() => {
    return projectedNodes.filter(node => node.is_outside_zone_boundary).length;
  }, [projectedNodes]);

  const zoneFill = useMemo(() => {
    return getZoneColor(zone, zoneData);
  }, [zone, zoneData]);

  const zoneStroke = '#52d3b3';

  useEffect(() => {
    setContributionsOpen(false);
  }, [selectedNode]);

  useEffect(() => {
    const requestId = nodeMetricsRequestRef.current + 1;
    nodeMetricsRequestRef.current = requestId;

    const isLatestRequest = () => nodeMetricsRequestRef.current === requestId;

    const loadNodeMetrics = async () => {
      const selectedNodeId = getNodeId(selectedNode);
      const selectedNodeType = getNodeType(selectedNode);

      if (!selectedNodeId || !selectedDate) {
        setNodeMetrics(null);
        setNodeMetricsError('');
        setNodeMetricsNotice('');
        setNodeMetricsLoading(false);
        return;
      }

      if (!isMetricsEnabledNode(selectedNode)) {
        setNodeMetrics(null);
        setNodeMetricsLoading(false);
        setNodeMetricsError('');
        setNodeMetricsNotice('');
        return;
      }

      setNodeMetricsLoading(true);
      setNodeMetricsError('');
      setNodeMetricsNotice('');
      setNodeMetrics(null);

      try {
        const requestedAggregation = aggregation || '30min';
        const requestedTimePoint = requestedAggregation === 'daily'
          ? null
          : Number(currentSettlementPeriod);

        const data = await fetchNodeMetrics({
          nodeType: selectedNodeType,
          nodeId: selectedNodeId,
          zone,
          date: selectedDate,
          aggregation: requestedAggregation,
          timePoint: requestedTimePoint,
        });

        if (!isLatestRequest()) {
          return;
        }

        const hasNodeDataForDay = Number(data?.matched_processed_row_count || 0) > 0;
        const hasNodeDataForSelectedTime = Number(data?.aggregation_source_row_count || 0) > 0;

        if (!hasNodeDataForDay) {
          setNodeMetrics(data);
          setNodeMetricsNotice(
            'No direct BMU actions were found for this node on the selected date.'
          );
        } else if (
          requestedAggregation !== 'daily' &&
          hasNodeDataForDay &&
          !hasNodeDataForSelectedTime
        ) {
          const dailyData = await fetchNodeMetrics({
            nodeType: selectedNodeType,
            nodeId: selectedNodeId,
            zone,
            date: selectedDate,
            aggregation: 'daily',
          });

          if (!isLatestRequest()) {
            return;
          }

          setNodeMetrics(dailyData);
          setNodeMetricsNotice(
            `No direct BMU actions for this node at the selected ${requestedAggregation === 'hourly' ? 'hour' : 'settlement period'}; showing the selected day's node totals.`
          );
        } else {
          setNodeMetrics(data);
        }
      } catch (err) {
        if (!isLatestRequest()) {
          return;
        }

        setNodeMetrics(null);
        setNodeMetricsNotice('');
        setNodeMetricsError(
          err?.response?.data?.error ||
          err.message ||
          'Failed to load node metrics.'
        );
      } finally {
        if (isLatestRequest()) {
          setNodeMetricsLoading(false);
        }
      }
    };

    loadNodeMetrics();

    return () => {
      if (nodeMetricsRequestRef.current === requestId) {
        nodeMetricsRequestRef.current += 1;
      }
    };
  }, [selectedNode, selectedDate, currentSettlementPeriod, aggregation, zone]);

  const handleNodeClick = (node, event) => {
    event.stopPropagation();

    if (!isMetricsEnabledNode(node)) {
      setNodeSelectionMessage(
        'Detailed node metrics are unavailable for this node because no directly connected BMU-to-node mapping is available. This node is shown as spatial context only.'
      );
      onNodeSelect(node);
      setNodeMetrics(null);
      setNodeMetricsError('');
      return;
    }

    setNodeSelectionMessage('');
    setNodeMetricsNotice('');
    onNodeSelect(node);
  };

  const getNodeVisual = (node) => {
    return getNodeVisualForState(node, getNodeId(selectedNode));
  };

  const renderZoneDetails = () => (
    <>
      <SectionTitle
        isCollapsible
        onClick={() => setZoneCollapsed(!zoneCollapsed)}
      >
        Zone
        <CollapseIcon>{zoneCollapsed ? '+' : '-'}</CollapseIcon>
      </SectionTitle>

      {!zoneCollapsed && (
        <CollapsibleContent>
          <StatItem>
            <StatLabel>Zone Name</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>{zoneName || zone}</StatValue>
          </StatItem>

          <StatItem>
            <StatLabel>Total nodes</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>{nodes?.length || 0}</StatValue>
          </StatItem>

          <StatItem>
            <StatLabel>Projected nodes</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>{projectedNodes?.length || 0}</StatValue>
          </StatItem>

          <StatItem>
            <StatLabel>Boundary features</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>{zoneBoundaryFeatures?.length || 0}</StatValue>
          </StatItem>

          {nodeLayer === 'gnode' ? (
            <>
              <StatItem>
                <StatLabel>Unique GSPs</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>{gspCount}</StatValue>
              </StatItem>

              <StatItem>
                <StatLabel>Direct connects</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>{directConnectCount}</StatValue>
              </StatItem>
            </>
          ) : (
            <>
              <StatItem>
                <StatLabel>Mapped BMUs</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>{mappedBmuCount}</StatValue>
              </StatItem>

              <StatItem>
                <StatLabel>Missing coordinates</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>
                  {excludedMissingCoordinateCount || 0}
                </StatValue>
              </StatItem>
            </>
          )}

          <StatItem>
            <StatLabel>Metrics-enabled nodes</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>{enabledNodeCount}</StatValue>
          </StatItem>

          <StatItem>
            <StatLabel>Outside boundary coords</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>{outsideBoundaryNodeCount}</StatValue>
          </StatItem>

          <StatItem>
            <StatLabel>Spatial-only nodes</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>
              {(nodes?.length || 0) - enabledNodeCount}
            </StatValue>
          </StatItem>

          <StatItem>
            <StatLabel>Date</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>
              {selectedDate?.day}-{selectedDate?.month}-{selectedDate?.year}
            </StatValue>
          </StatItem>

          <StatItem>
            <StatLabel>{sliderLabel}</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>
              {sliderValueLabel || currentSettlementPeriod}
            </StatValue>
          </StatItem>

          <StatItem style={{ gridColumn: '1 / -1' }}>
            <StatLabel>Aggregation</StatLabel>
            <StatValue style={{ fontSize: '1rem' }}>{aggregation || '30min'}</StatValue>
          </StatItem>
        </CollapsibleContent>
      )}
    </>
  );

  const renderSelectedNodeDetails = () => (
    <>
      <SectionTitle
        isCollapsible
        onClick={() => setSelectedNodeCollapsed(!selectedNodeCollapsed)}
      >
        Selected node
        <CollapseIcon>{selectedNodeCollapsed ? '+' : '-'}</CollapseIcon>
      </SectionTitle>

      {!selectedNodeCollapsed && (
        <CollapsibleContent>
          {selectedNode ? (
            <>
              <StatItem>
                <StatLabel>Name</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>{getNodeName(selectedNode)}</StatValue>
              </StatItem>

              <StatItem>
                <StatLabel>{getNodeIdLabel(selectedNode)}</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>{getNodeId(selectedNode)}</StatValue>
              </StatItem>

              {getNodeType(selectedNode) === 'gnode' && (
                <>
                  <StatItem>
                    <StatLabel>GSP</StatLabel>
                    <StatValue style={{ fontSize: '1rem' }}>{selectedNode.gsp_name || 'N/A'}</StatValue>
                  </StatItem>

                  <StatItem>
                    <StatLabel>GSP ID</StatLabel>
                    <StatValue style={{ fontSize: '1rem' }}>{selectedNode.gsp_id ?? 'N/A'}</StatValue>
                  </StatItem>

                  <StatItem>
                    <StatLabel>DC</StatLabel>
                    <StatValue style={{ fontSize: '1rem' }}>{selectedNode.dc_name || 'N/A'}</StatValue>
                  </StatItem>
                </>
              )}

              <StatItem>
                <StatLabel>Region</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>{selectedNode.region_name || 'N/A'}</StatValue>
              </StatItem>

              <StatItem>
                <StatLabel>{getNodeType(selectedNode) === 'nms_node' ? 'Zone' : 'PES'}</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>{selectedNode.pes_name || 'N/A'}</StatValue>
              </StatItem>

              <StatItem>
                <StatLabel>Node mode</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>
                  {isMetricsEnabledNode(selectedNode)
                    ? 'Direct BMU metrics enabled'
                    : 'Spatial only'}
                </StatValue>
              </StatItem>

              {getNodeType(selectedNode) !== 'nms_node' && (
                <>
                  <StatItem>
                    <StatLabel>Boundary position</StatLabel>
                    <StatValue style={{ fontSize: '1rem' }}>
                      {selectedNode.is_outside_zone_boundary
                        ? 'Outside displayed zone boundary'
                        : 'Inside displayed zone boundary'}
                    </StatValue>
                  </StatItem>

                  {selectedNode.is_outside_zone_boundary && (
                    <StatItem style={{ gridColumn: '1 / -1' }}>
                      <StatLabel>Boundary note</StatLabel>
                      <StatValue style={{ fontSize: '0.95rem' }}>
                        The node is kept at its source coordinate. Its zone membership comes from the BMU-to-node mapping, so offshore and boundary nodes can sit outside the displayed GSP outline.
                      </StatValue>
                    </StatItem>
                  )}
                </>
              )}

              <StatItem>
                <StatLabel>Direct BMU count</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>
                  {selectedNode.direct_bmu_count || 0}
                </StatValue>
              </StatItem>

              <StatItem style={{ gridColumn: '1 / -1' }}>
                <StatLabel>Direct BMUs</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>
                  {selectedNode.direct_bmu_list || 'N/A'}
                </StatValue>
              </StatItem>

              {getNodeType(selectedNode) !== 'nms_node' && (
                <StatItem style={{ gridColumn: '1 / -1' }}>
                  <StatLabel>Mapping Basis</StatLabel>
                  <StatValue style={{ fontSize: '1rem' }}>
                    {selectedNode.mapping_basis || 'N/A'}
                  </StatValue>
                </StatItem>
              )}

              <StatItem>
                <StatLabel>Lat</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>
                  {selectedNode.node_lat ?? selectedNode.gnode_lat ?? selectedNode.nms_node_lat}
                </StatValue>
              </StatItem>

              <StatItem>
                <StatLabel>Lon</StatLabel>
                <StatValue style={{ fontSize: '1rem' }}>
                  {selectedNode.node_lon ?? selectedNode.gnode_lon ?? selectedNode.nms_node_lon}
                </StatValue>
              </StatItem>
            </>
          ) : (
            <StatItem style={{ gridColumn: '1 / -1' }}>
              <StatLabel>No node selected</StatLabel>
              <StatValue style={{ fontSize: '1rem' }}>
                Click a node to inspect it.
              </StatValue>
            </StatItem>
          )}
        </CollapsibleContent>
      )}
    </>
  );

  const renderContributionDialog = () => {
    if (
      !contributionsOpen ||
      !selectedNode ||
      getNodeType(selectedNode) !== 'nms_node'
    ) {
      return null;
    }

    const contributions = nodeMetrics?.bmu_contributions;
    const rows = Array.isArray(contributions?.rows) ? contributions.rows : [];
    const totals = contributions?.totals || {};

    return (
      <ModalOverlay onClick={() => setContributionsOpen(false)}>
        <ContributionDialog onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <div>
              <DialogTitle>
                BMU Contributions - {getNodeName(selectedNode)}
              </DialogTitle>
              <DialogSubtitle>
                {getNodeId(selectedNode)} - {nodeMetrics ? getMetricsAggregationLabel(nodeMetrics) : 'Loading metrics'}
              </DialogSubtitle>
            </div>

            <DialogCloseButton
              type="button"
              onClick={() => setContributionsOpen(false)}
            >
              Close
            </DialogCloseButton>
          </DialogHeader>

          <DialogBody>
            {nodeMetricsLoading && (
              <MessageBlock>Loading BMU contribution data...</MessageBlock>
            )}

            {!nodeMetricsLoading && nodeMetricsError && (
              <MessageBlock>{nodeMetricsError}</MessageBlock>
            )}

            {!nodeMetricsLoading && !nodeMetricsError && nodeMetrics && (
              <>
                <ContributionSummary>
                  <SummaryTile>
                    <SummaryLabel>Mapped BMUs</SummaryLabel>
                    <SummaryValue>{totals.bmu_count || 0}</SummaryValue>
                  </SummaryTile>

                  <SummaryTile>
                    <SummaryLabel>Active BMUs</SummaryLabel>
                    <SummaryValue>{totals.active_bmu_count || 0}</SummaryValue>
                  </SummaryTile>

                  <SummaryTile>
                    <SummaryLabel>Weighted Net Volume</SummaryLabel>
                    <SummaryValue>{formatMwh(totals.weighted_net_volume)}</SummaryValue>
                  </SummaryTile>

                  <SummaryTile>
                    <SummaryLabel>Total Instructions</SummaryLabel>
                    <SummaryValue>{totals.total_accepted_instructions || 0}</SummaryValue>
                  </SummaryTile>
                </ContributionSummary>

                {nodeMetricsNotice && (
                  <MessageBlock>{nodeMetricsNotice}</MessageBlock>
                )}

                {rows.length ? (
                  <TableWrap>
                    <ContributionTable>
                      <thead>
                        <tr>
                          <th>BMU</th>
                          <th>Metered %</th>
                          <th>Fuel</th>
                          <th>Offers</th>
                          <th>Bids</th>
                          <th>Total Instr.</th>
                          <th>BOA</th>
                          <th>Weighted Net</th>
                          <th>Raw Net</th>
                          <th>Abs Share</th>
                          <th>Cost</th>
                          <th>Rows</th>
                        </tr>
                      </thead>

                      <tbody>
                        {rows.map(row => (
                          <tr key={row.bmu_id}>
                            <td><BmuId>{row.bmu_id}</BmuId></td>
                            <td>{formatPercent(row.metered_volume_percent)}</td>
                            <td>
                              {row.fuel_types?.length
                                ? row.fuel_types.join(', ')
                                : <MutedText>N/A</MutedText>}
                            </td>
                            <td>{row.accepted_offers || 0}</td>
                            <td>{row.accepted_bids || 0}</td>
                            <td>{row.total_accepted_instructions || 0}</td>
                            <td>{row.unique_boa_actions || 0}</td>
                            <td>{formatMwh(row.weighted_net_volume)}</td>
                            <td>{formatMwh(row.unweighted_net_volume)}</td>
                            <td>{formatPercent(row.absolute_volume_share_percent)}</td>
                            <td>{formatCurrency(row.weighted_balancing_cost)}</td>
                            <td>{row.source_row_count || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </ContributionTable>
                  </TableWrap>
                ) : (
                  <MessageBlock>No BMU contribution rows are available for this node.</MessageBlock>
                )}
              </>
            )}
          </DialogBody>
        </ContributionDialog>
      </ModalOverlay>
    );
  };

  return (
    <PaneContainer>
      <Header>
        <TitleBlock>
          <Title>{zoneName || zone}</Title>
          <TitleMeta>
            <ZoneBadge>{zone || 'Zone'}</ZoneBadge>
            <span>Node View</span>
          </TitleMeta>
        </TitleBlock>
        <CloseButton onClick={onClose}>Close</CloseButton>
      </Header>

      <Content>
        <MapArea ref={mapAreaRef}>
          {loading && <Status>Loading node data...</Status>}
          {error && <Status error>{error}</Status>}

          {!loading && boundaryLoading && (
            <Status>Loading geographic boundary...</Status>
          )}

          {!loading && boundaryError && (
            <Status error>{boundaryError}</Status>
          )}

          {!loading && !error && (
            <>
              <GuideText>
                {enabledNodeCount > 0
                  ? nodeLayer === 'nms'
                    ? 'Teal NMS nodes have direct BMU mappings and support aggregated metrics. Volumes and costs use the NMS metered-volume allocation.'
                    : 'Blue GNodes have directly connected BMU mappings and support detailed metrics. Grey nodes are spatial-only.'
                  : 'No node in this zone currently has a directly connected BMU mapping. Nodes are shown as spatial context only.'}
              </GuideText>

              <ZoomControls>
                <ZoomButton
                  type="button"
                  aria-label="Zoom out"
                  title="Zoom out"
                  disabled={mapTransform.scale <= MIN_MAP_ZOOM}
                  onClick={() => handleZoomButton(-1)}
                >
                  -
                </ZoomButton>
                <ZoomLevel>{Math.round(mapTransform.scale * 100)}%</ZoomLevel>
                <ZoomButton
                  type="button"
                  aria-label="Zoom in"
                  title="Zoom in"
                  disabled={mapTransform.scale >= MAX_MAP_ZOOM}
                  onClick={() => handleZoomButton(1)}
                >
                  +
                </ZoomButton>
                <ZoomButton
                  type="button"
                  aria-label="Reset map view"
                  title="Reset map view"
                  disabled={isMapAtDefault}
                  onClick={resetMapView}
                >
                  Fit
                </ZoomButton>
              </ZoomControls>

              {nodeLegendItems.length > 0 && (
                <NodeLegend aria-label="Node legend">
                  <LegendTitle>Node Legend</LegendTitle>
                  {nodeLegendItems.map(item => (
                    <LegendRow key={item.key}>
                      <LegendMarker viewBox="0 0 24 24" aria-hidden="true">
                        {item.selected && (
                          <circle
                            cx="12"
                            cy="12"
                            r={item.visual.radius + 6}
                            fill={item.visual.fill}
                            opacity="0.12"
                          />
                        )}
                        <circle
                          cx="12"
                          cy="12"
                          r={item.visual.radius + 4}
                          fill={item.visual.haloFill}
                          opacity={item.visual.haloOpacity}
                        />
                        <circle
                          cx="12"
                          cy="12"
                          r={item.visual.radius}
                          fill={item.visual.fill}
                          opacity="0.95"
                          stroke={item.visual.stroke}
                          strokeDasharray={item.visual.strokeDasharray}
                          strokeWidth={item.selected ? 2.2 : 1.1}
                        />
                      </LegendMarker>
                      <span>{item.label}</span>
                    </LegendRow>
                  ))}
                </NodeLegend>
              )}

              <Svg
                key={`${zone || zoneName}-geo-node-svg`}
                ref={svgRef}
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="xMidYMid meet"
                $isPanning={isPanningMap}
                $isDraggable
                onWheel={handleMapWheel}
                onPointerDown={handleMapPointerDown}
                onPointerMove={handleMapPointerMove}
                onPointerUp={handleMapPointerEnd}
                onPointerCancel={handleMapPointerCancel}
                onClick={() => {
                  if (didPanRef.current) {
                    didPanRef.current = false;
                    return;
                  }

                  setNodeSelectionMessage('');
                  setContributionsOpen(false);
                  if (selectedNode && onClearSelectedNode) {
                    onClearSelectedNode();
                  }
                }}
              >
                <defs>
                  <filter id="zoneShadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.10" />
                  </filter>
                </defs>

                <g transform={`translate(${mapTransform.x} ${mapTransform.y}) scale(${mapTransform.scale})`}>
                  {zoneBoundaryPaths.length > 0 && (
                    <g filter="url(#zoneShadow)">
                      {zoneBoundaryPaths.map(path => (
                        <path
                          key={path.id}
                          d={path.d}
                          fill={zoneFill}
                          fillOpacity={0.22}
                          stroke={zoneStroke}
                          strokeOpacity={1}
                          strokeWidth={1.3}
                          vectorEffect="non-scaling-stroke"
                          fillRule="evenodd"
                        />
                      ))}
                    </g>
                  )}

                  {projectedNodes.map(node => {
                    const visual = getNodeVisual(node);
                    const nodeId = getNodeId(node);
                    const isSelected = getNodeId(selectedNode) === nodeId;
                    const scaledRadius = visual.radius / mapTransform.scale;
                    const scaledHaloRadius = (visual.radius + 4) / mapTransform.scale;
                    const scaledHitRadius = Math.max(10, visual.radius + 8) / mapTransform.scale;
                    const selectedHaloRadius = (visual.radius + 6) / mapTransform.scale;
                    const strokeWidth = (isSelected ? 2.2 : 1.1) / mapTransform.scale;

                    return (
                      <g
                        key={`${getNodeType(node)}-${nodeId}-${node.gsp_id ?? 'nogsp'}`}
                        data-node-hit-target="true"
                        style={{ cursor: visual.cursor }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(e) => handleNodeClick(node, e)}
                        onMouseEnter={(e) => {
                          setHoveredNode(node);
                          updateTooltipPosition(e);
                        }}
                        onMouseMove={(e) => {
                          updateTooltipPosition(e);
                        }}
                        onMouseLeave={() => setHoveredNode(null)}
                      >
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={scaledHitRadius}
                          fill="none"
                          stroke="none"
                          pointerEvents="all"
                          style={{ cursor: visual.cursor }}
                        />

                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={scaledHaloRadius}
                          fill={visual.haloFill}
                          opacity={visual.haloOpacity}
                          pointerEvents="none"
                        />

                        {isSelected && (
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={selectedHaloRadius}
                            fill={visual.fill}
                            opacity="0.12"
                            pointerEvents="none"
                          />
                        )}

                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={scaledRadius}
                          fill={visual.fill}
                          opacity="0.95"
                          stroke={visual.stroke}
                          strokeDasharray={visual.strokeDasharray}
                          strokeWidth={strokeWidth}
                          pointerEvents="none"
                        />
                      </g>
                    );
                  })}

                  {selectedProjectedNode && (() => {
                    const labelText = String(
                      getNodeName(selectedProjectedNode) || getNodeId(selectedProjectedNode)
                    );

                    const charWidth = 7.4 / mapTransform.scale;
                    const horizontalPadding = 10 / mapTransform.scale;
                    const labelWidth = Math.max(56 / mapTransform.scale, labelText.length * charWidth + horizontalPadding * 2);
                    const labelHeight = 22 / mapTransform.scale;
                    const labelX = selectedProjectedNode.x - labelWidth / 2;
                    const labelY = selectedProjectedNode.y - 36 / mapTransform.scale;

                    return (
                      <g pointerEvents="none">
                        <rect
                          x={labelX}
                          y={labelY}
                          rx={10 / mapTransform.scale}
                          ry={10 / mapTransform.scale}
                          width={labelWidth}
                          height={labelHeight}
                          fill="rgba(17, 24, 39, 0.94)"
                        />
                        <text
                          x={selectedProjectedNode.x}
                          y={labelY + labelHeight / 2 + 1 / mapTransform.scale}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={11 / mapTransform.scale}
                          fill="#ffffff"
                          fontWeight="600"
                        >
                          {labelText}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              </Svg>

              {hoveredNode && (
                <Tooltip ref={tooltipRef} x={tooltipPos.x} y={tooltipPos.y}>
                  <div><strong>{getNodeName(hoveredNode)}</strong></div>
                  <Small>{getNodeIdLabel(hoveredNode)}: {getNodeId(hoveredNode)}</Small>
                  {getNodeType(hoveredNode) !== 'nms_node' && (
                    <>
                      <Small>GSP: {hoveredNode.gsp_name || 'N/A'}</Small>
                      <Small>DC: {hoveredNode.dc_name || 'N/A'}</Small>
                      <Small>
                        Mode:{' '}
                        {isMetricsEnabledNode(hoveredNode)
                          ? 'Direct BMU metrics enabled'
                          : 'Spatial only'}
                      </Small>
                    </>
                  )}
                  {hoveredNode.is_outside_zone_boundary && (
                    <Small>Boundary: outside displayed zone outline</Small>
                  )}

                  {isMetricsEnabledNode(hoveredNode) && (
                    <>
                      <Small>Direct BMU count: {hoveredNode.direct_bmu_count || 0}</Small>
                      <Small>BMUs: {hoveredNode.direct_bmu_list || 'N/A'}</Small>
                    </>
                  )}
                </Tooltip>
              )}
            </>
          )}
        </MapArea>

        <InfoArea>
          <RightControls>
            <LayerSelector aria-label="Node layer selector">
              <LayerButton
                type="button"
                $active={nodeLayer === 'nms'}
                onClick={() => onNodeLayerChange?.('nms')}
              >
                NMS Nodes
              </LayerButton>

              <LayerButton
                type="button"
                $active={nodeLayer === 'gnode'}
                onClick={() => onNodeLayerChange?.('gnode')}
              >
                GNodes
              </LayerButton>
            </LayerSelector>

            <DateSelector
              selectedDate={selectedDate}
              onDateChange={onDateChange}
            />

            <SettlementPeriodSlider
              label={sliderLabel}
              min={sliderMin}
              max={sliderMax}
              disabled={sliderDisabled}
              currentSettlementPeriod={currentSettlementPeriod}
              handleSliderChange={onSettlementPeriodChange}
              valueLabel={sliderValueLabel}
              valueMeta={sliderValueMeta}
            />
          </RightControls>

          {selectedNode &&
            selectedNodeMetricsEnabled &&
            getNodeType(selectedNode) === 'nms_node' && (
            <ContributionToolbar>
              <ContributionButton
                type="button"
                onClick={() => setContributionsOpen(true)}
              >
                BMU Contributions
              </ContributionButton>
            </ContributionToolbar>
          )}

          <MetricsPanelContainer>
            <MetricsTitle>Key Statistics</MetricsTitle>

            {!selectedNode && !nodeSelectionMessage && (
              <MessageBlock>
                {enabledNodeCount > 0
                  ? nodeLayer === 'nms'
                    ? 'Select a teal NMS node to inspect aggregated direct BMU metrics.'
                    : 'Select a blue directly connected BMU node to inspect detailed metrics. Grey nodes are spatial-only.'
                  : 'Detailed node metrics are not currently enabled for this zone because no directly connected BMU-to-node mapping has been found.'}
              </MessageBlock>
            )}

            {!selectedNode && nodeSelectionMessage && (
              <MessageBlock>{nodeSelectionMessage}</MessageBlock>
            )}

            {selectedNode && !selectedNodeMetricsEnabled && (
              <MessageBlock>
                {nodeSelectionMessage ||
                  'Detailed node metrics are unavailable for this node because no directly connected BMU-to-node mapping is available.'}
              </MessageBlock>
            )}

            {selectedNode && selectedNodeMetricsEnabled && nodeMetricsLoading && (
              <MessageBlock>Loading node metrics...</MessageBlock>
            )}

            {selectedNode && selectedNodeMetricsEnabled && nodeMetricsError && (
              <MessageBlock>{nodeMetricsError}</MessageBlock>
            )}

            {selectedNode &&
              selectedNodeMetricsEnabled &&
              !nodeMetricsLoading &&
              !nodeMetricsError &&
              nodeMetricsNotice && (
              <MessageBlock>{nodeMetricsNotice}</MessageBlock>
            )}

            <StatGrid>
              {selectedNode &&
                selectedNodeMetricsEnabled &&
                !nodeMetricsLoading &&
                !nodeMetricsError &&
                nodeMetrics && (
                <>
                  <SectionTitle>Action Count</SectionTitle>

                  <StatItem style={{ gridColumn: '1 / -1' }}>
                    <StatLabel>Metrics Aggregation</StatLabel>
                    <StatValue style={{ fontSize: '1rem' }}>
                      {nodeMetrics.aggregation === 'daily'
                        ? 'Daily'
                        : nodeMetrics.aggregation === 'hourly'
                          ? `Hour ${nodeMetrics.time_point}`
                          : `Settlement Period ${nodeMetrics.time_point}`}
                    </StatValue>
                  </StatItem>

                  <StatItem>
                    <StatLabel>Accepted Offer Actions</StatLabel>
                    <StatValue>{nodeMetrics.metrics.accepted_offers}</StatValue>
                  </StatItem>

                  <StatItem>
                    <StatLabel>Accepted Bid Actions</StatLabel>
                    <StatValue>{nodeMetrics.metrics.accepted_bids}</StatValue>
                  </StatItem>

                  <StatItem style={{ gridColumn: '1 / -1' }}>
                    <StatLabel>Total Accepted Directional Instructions</StatLabel>
                    <StatValue>{nodeMetrics.metrics.total_accepted_instructions}</StatValue>
                  </StatItem>

                  <StatItem style={{ gridColumn: '1 / -1' }}>
                    <StatLabel>Effective Unique BOA Actions</StatLabel>
                    <StatValue>{nodeMetrics.metrics.unique_boa_actions}</StatValue>
                  </StatItem>

                  {nodeMetrics.node_type === 'nms_node' && (
                    <StatItem style={{ gridColumn: '1 / -1' }}>
                      <StatLabel>NMS Allocation</StatLabel>
                      <StatValue style={{ fontSize: '1rem' }}>
                        Metered-volume weighted
                      </StatValue>
                    </StatItem>
                  )}

                  <SectionTitle>Net Imbalance Volume</SectionTitle>

                  <StatItem>
                    <StatLabel>Total</StatLabel>
                    <StatValue>
                      {Number(nodeMetrics.metrics.net_imbalance_volume || 0).toFixed(2)} MWh
                    </StatValue>
                  </StatItem>

                  <StatItem></StatItem>

                  <SubStatItem>
                    <StatLabel>from Energy Actions</StatLabel>
                    <StatValue>
                      {Number(nodeMetrics.metrics.energy_volume || 0).toFixed(2)} MWh
                    </StatValue>
                  </SubStatItem>

                  <SubStatItem>
                    <StatLabel>from System Actions</StatLabel>
                    <StatValue>
                      {Number(nodeMetrics.metrics.system_volume || 0).toFixed(2)} MWh
                    </StatValue>
                  </SubStatItem>

                  <SectionTitle>Balancing Cost</SectionTitle>

                  <StatItem style={{ gridColumn: '1 / -1' }}>
                    <StatLabel>Current Cost</StatLabel>
                    <StatValue>
                      {`GBP ${Number(nodeMetrics.metrics.balancing_cost || 0).toLocaleString('en-GB', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                    </StatValue>
                  </StatItem>
                </>
              )}

              {renderZoneDetails()}
              {renderSelectedNodeDetails()}
            </StatGrid>
          </MetricsPanelContainer>
        </InfoArea>
      </Content>

      {renderContributionDialog()}
    </PaneContainer>
  );
};

export default NodeDrilldownPane;
