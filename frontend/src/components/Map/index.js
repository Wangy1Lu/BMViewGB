import React, { useRef, useState } from 'react';
import styled from '@emotion/styled';
import { GB_ZONES } from './zones';
import { GSP_GROUP_BOUNDARY_SOURCE, GSP_GROUP_ZONE_PATHS } from './gspGroupPaths';

const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 8;
const MAP_ZOOM_STEP = 1.35;
const MAP_PAN_MARGIN_RATIO = 0.35;
const DEFAULT_MAP_TRANSFORM = Object.freeze({ scale: 1, x: 0, y: 0 });

const [MAP_VIEWBOX_X, MAP_VIEWBOX_Y, MAP_VIEWBOX_WIDTH, MAP_VIEWBOX_HEIGHT] =
  GSP_GROUP_BOUNDARY_SOURCE.viewBox.split(/\s+/).map(Number);
const MAP_WITH_INTERCONNECTOR_VIEWBOX = '-70 -70 650 980';

const MapContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  overflow: hidden;
`;

const StyledSvg = styled.svg`
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  filter: drop-shadow(0 8px 18px rgba(16, 24, 40, 0.08));
  cursor: ${props => (props.$isPanning || props.$isDraggable ? 'move' : 'default')};
  touch-action: none;
  user-select: none;
  overflow: visible;
`;

const ZonePolygon = styled.path`
  fill: ${props => props.fillColor || '#e8e8e8'};
  stroke: ${props => props.isHovered ? '#172033' : 'rgba(29, 53, 87, 0.62)'};
  stroke-width: ${props => props.isHovered ? 1.6 : 0.8};
  vector-effect: non-scaling-stroke;
  shape-rendering: geometricPrecision;
  transition: fill 0.3s ease, stroke 0.2s ease, stroke-width 0.2s ease;

  &:hover {
    fill: ${props => props.hoverColor || '#d0d0d0'};
    cursor: ${props => (props.$isPanning ? 'move' : 'pointer')};
  }
`;

const ZoneLabelGroup = styled.g`
  pointer-events: none;
`;

const ZoneLabelText = styled.text`
  fill: #102033;
  font-weight: 900;
  text-anchor: middle;
  dominant-baseline: middle;
  paint-order: stroke fill;
  stroke: rgba(255, 255, 255, 0.92);
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  user-select: none;
`;

const InterconnectorLine = styled.line`
  stroke: ${props => props.$color};
  stroke-width: 8;
  stroke-linecap: round;
  stroke-opacity: ${props => (props.$selected ? 0.96 : 0.78)};
  vector-effect: non-scaling-stroke;
  filter: ${props => (props.$selected ? 'drop-shadow(0 2px 5px rgba(15, 23, 42, 0.25))' : 'none')};
  transition: stroke 0.2s ease, stroke-opacity 0.2s ease;
  pointer-events: none;
`;

const InterconnectorLineHitArea = styled.line`
  stroke: transparent;
  stroke-width: 24;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  pointer-events: stroke;
  cursor: ${props => (props.$isPanning ? 'move' : 'pointer')};
`;

const InterconnectorLandingDot = styled.circle`
  fill: ${props => props.$color};
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
`;

const FlagStripe = styled.rect`
  pointer-events: none;
`;

const InterconnectorFlagGroup = styled.g`
  cursor: ${props => (props.$isPanning ? 'move' : 'pointer')};
`;

const InterconnectorFlagCard = styled.rect`
  fill: rgba(255, 255, 255, 0.95);
  stroke: ${props => (props.$selected ? '#102033' : props.$color)};
  stroke-width: ${props => (props.$selected ? 2.4 : 1.4)};
  rx: 8;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 5px 12px rgba(15, 23, 42, 0.14));
`;

const InterconnectorCodeText = styled.text`
  fill: #102033;
  font-size: 10px;
  font-weight: 900;
  text-anchor: middle;
  dominant-baseline: middle;
  paint-order: stroke fill;
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  user-select: none;
  pointer-events: none;
`;

const ZoneInfo = styled.div`
  position: absolute;
  left: ${props => props.x}px;
  top: ${props => props.y}px;
  transform: ${props =>
    props.placement === 'top'
      ? 'translate(14px, calc(-100% - 14px))'
      : 'translate(14px, 14px)'};
  font-size: 16px;
  font-weight: bold;
  color: #333;
  padding: 10px 14px;
  background-color: rgba(255, 255, 255, 0.94);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  text-align: center;
  min-width: 250px;
  max-width: 320px;
  z-index: 20;
  pointer-events: none;
  border: 1px solid rgba(0, 0, 0, 0.08);
`;

const ZoneName = styled.div`
  margin-bottom: 8px;
  font-size: 1.1rem;
  border-bottom: 1px solid #ccc;
  padding-bottom: 5px;
`;

const ZoneVolume = styled.div`
  font-size: 1rem;
  color: ${props => props.value > 0 ? '#c62828' : props.value < 0 ? '#2e7d32' : '#666'};
  margin-top: 5px;
`;

const VolumeBreakdown = styled.div`
  font-size: 1rem;
  color: #555;
  font-weight: normal;
  margin-top: 8px;
`;

const InterconnectorInfo = styled.div`
  position: absolute;
  left: ${props => props.x}px;
  top: ${props => props.y}px;
  transform: ${props =>
    props.placement === 'top'
      ? 'translate(14px, calc(-100% - 14px))'
      : 'translate(14px, 14px)'};
  min-width: 245px;
  max-width: 300px;
  padding: 11px 13px;
  background-color: rgba(255, 255, 255, 0.96);
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
  color: #334155;
  z-index: 22;
  pointer-events: none;
`;

const InterconnectorName = styled.div`
  color: #102033;
  font-size: 0.96rem;
  font-weight: 900;
  margin-bottom: 6px;
`;

const InterconnectorFlow = styled.div`
  color: ${props => {
    if (props.$direction === 'import_to_gb') return '#b30000';
    if (props.$direction === 'export_from_gb') return '#166534';
    return '#64748b';
  }};
  font-size: 0.92rem;
  font-weight: 850;
`;

const InterconnectorMeta = styled.div`
  margin-top: 5px;
  color: #64748b;
  font-size: 0.8rem;
  line-height: 1.35;
`;

const ZoomControls = styled.div`
  position: absolute;
  top: 28px;
  right: 28px;
  z-index: 12;
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

const MapLegend = styled.div`
  position: absolute;
  left: 28px;
  bottom: 28px;
  z-index: 12;
  width: min(330px, calc(100% - 56px));
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #dbe4ee;
  border-radius: 10px;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
  color: #334155;
  pointer-events: none;
`;

const LegendTitle = styled.div`
  color: #102033;
  font-size: 0.9rem;
  font-weight: 850;
  margin-bottom: 8px;
`;

const LegendRows = styled.div`
  display: grid;
  gap: 7px;
`;

const LegendRow = styled.div`
  display: grid;
  grid-template-columns: 24px 1fr;
  align-items: start;
  gap: 8px;
`;

const LegendSwatch = styled.span`
  width: 22px;
  height: 12px;
  margin-top: 3px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.16);
  background: ${props => props.$color};
`;

const LegendText = styled.div`
  font-size: 0.8rem;
  line-height: 1.35;
`;

const LegendStrong = styled.span`
  color: #102033;
  font-weight: 850;
`;

const INTERCONNECTOR_POINTS = Object.freeze({
  france: { x: 330, y: 866 },
  netherlands: { x: 545, y: 520 },
  belgium: { x: 532, y: 702 },
  norway: { x: 372, y: -26 },
  denmark: { x: 548, y: 206 },
  ireland: { x: -30, y: 548 },
  northern_ireland: { x: -34, y: 300 },
});

const COUNTRY_GB_CONNECTION_POINTS = Object.freeze({
  france: { x: 413.4, y: 745.3 },
  netherlands: { x: 456.0, y: 706.9 },
  belgium: { x: 456.2, y: 721.4 },
  norway: { x: 368.0, y: 494.3 },
  denmark: { x: 413.1, y: 595.1 },
  ireland: { x: 193.9, y: 665.3 },
  northern_ireland: { x: 200.0, y: 399.7 },
});

const COUNTRY_CODES = Object.freeze({
  france: 'FR',
  netherlands: 'NL',
  belgium: 'BE',
  norway: 'NO',
  denmark: 'DK',
  ireland: 'IE',
  northern_ireland: 'NI',
});

const GB_MAP_ZONES = GB_ZONES.map(zone => ({
  ...zone,
  paths: GSP_GROUP_ZONE_PATHS[zone.id] || zone.paths,
}));

const ZONE_LABELS = Object.freeze({
  _P: { x: 220, y: 292, lines: ['North', 'Scotland'], fontSize: 13 },
  _N: { x: 258, y: 424, lines: ['South', 'Scotland'], fontSize: 13 },
  _G: { x: 288, y: 522, lines: ['North', 'Western'], fontSize: 11.6 },
  _F: { x: 339, y: 480, lines: ['Northern'], fontSize: 12.2 },
  _M: { x: 358, y: 550, lines: ['Yorkshire'], fontSize: 12 },
  _D: { x: 254, y: 610, lines: ['Merseyside &', 'North Wales'], fontSize: 10.6 },
  _E: { x: 307, y: 646, lines: ['Midlands'], fontSize: 11.6 },
  _B: { x: 366, y: 620, lines: ['East', 'Midlands'], fontSize: 10.8 },
  _A: { x: 418, y: 651, lines: ['Eastern'], fontSize: 11.6 },
  _K: { x: 235, y: 673, lines: ['South', 'Wales'], fontSize: 10.8 },
  _L: { x: 225, y: 749, lines: ['South', 'Western'], fontSize: 11.1 },
  _H: { x: 326, y: 717, lines: ['Southern'], fontSize: 11.2 },
  _J: { x: 420, y: 727, lines: ['South', 'Eastern'], fontSize: 10.6 },
  _C: { x: 393, y: 695, lines: ['London'], fontSize: 9.6 },
});

const renderZoneLabel = (zone, hoveredZoneId) => {
  const label = ZONE_LABELS[zone.id];
  if (!label) return null;

  const lineHeight = label.lineHeight || label.fontSize + 2;
  const startY = -((label.lines.length - 1) * lineHeight) / 2;
  const opacity = hoveredZoneId && hoveredZoneId !== zone.id ? 0.86 : 1;

  return (
    <ZoneLabelGroup
      key={`${zone.id}-label`}
      aria-hidden="true"
      transform={`translate(${label.x} ${label.y})`}
      opacity={opacity}
    >
      {label.lines.map((line, index) => (
        <ZoneLabelText
          key={`${zone.id}-label-${line}`}
          y={startY + index * lineHeight}
          fontSize={label.fontSize}
          strokeWidth={label.strokeWidth || 3.4}
        >
          {line}
        </ZoneLabelText>
      ))}
    </ZoneLabelGroup>
  );
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampMapTransform(transform) {
  const scale = clamp(Number(transform?.scale) || 1, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
  const panMarginX = MAP_VIEWBOX_WIDTH * MAP_PAN_MARGIN_RATIO;
  const panMarginY = MAP_VIEWBOX_HEIGHT * MAP_PAN_MARGIN_RATIO;
  const minX = MAP_VIEWBOX_X + MAP_VIEWBOX_WIDTH - MAP_VIEWBOX_WIDTH * scale - panMarginX;
  const maxX = MAP_VIEWBOX_X + panMarginX;
  const minY = MAP_VIEWBOX_Y + MAP_VIEWBOX_HEIGHT - MAP_VIEWBOX_HEIGHT * scale - panMarginY;
  const maxY = MAP_VIEWBOX_Y + panMarginY;

  return {
    scale,
    x: clamp(Number(transform?.x) || 0, minX, maxX),
    y: clamp(Number(transform?.y) || 0, minY, maxY),
  };
}

export const getZoneColor = (zoneId, zoneData) => {
  if (!zoneData || !zoneData[zoneId] || typeof zoneData[zoneId].net_volume !== 'number') {
    return '#e8e8e8';
  }

  const volumes = Object.values(zoneData)
    .map(z => z?.net_volume)
    .filter(v => typeof v === 'number');

  if (!volumes.length) return '#e8e8e8';

  const maxAbsVolume = Math.max(...volumes.map(Math.abs));
  const netVol = zoneData[zoneId].net_volume;

  if (netVol === 0) return '#eef2f7';
  if (maxAbsVolume === 0) return '#eef2f7';

  const intensity = Math.min(Math.abs(netVol) / maxAbsVolume, 1);

  if (netVol > 0) {
    if (intensity > 0.9) return '#b30000';
    if (intensity > 0.7) return '#ff0000';
    if (intensity > 0.5) return '#ff4d4d';
    if (intensity > 0.3) return '#ff8080';
    if (intensity > 0.1) return '#ffb3b3';
    return '#ffe6e6';
  } else {
    if (intensity > 0.9) return '#004d00';
    if (intensity > 0.7) return '#008000';
    if (intensity > 0.5) return '#00b300';
    if (intensity > 0.3) return '#66ff66';
    if (intensity > 0.1) return '#b3ffb3';
    return '#e6ffe6';
  }
};

const getIntensityStep = (value, maxValue) => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }

  const ratio = Math.min(value / maxValue, 1);
  if (ratio > 0.85) return 5;
  if (ratio > 0.65) return 4;
  if (ratio > 0.45) return 3;
  if (ratio > 0.25) return 2;
  return 1;
};

const getInterconnectorColor = (country, maxFlow) => {
  if (!country || country.flow_mw === null || country.flow_mw === undefined) {
    return '#94a3b8';
  }

  const step = getIntensityStep(Math.abs(Number(country.flow_mw)), maxFlow);

  if (country.direction === 'import_to_gb') {
    return ['#ffe6e6', '#ffb3b3', '#ff8080', '#ff4d4d', '#ff0000', '#b30000'][step];
  }

  if (country.direction === 'export_from_gb') {
    return ['#e6ffe6', '#b3ffb3', '#66ff66', '#00b300', '#008000', '#004d00'][step];
  }

  return '#94a3b8';
};

const formatInteger = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'No data';
  }
  return Math.round(Number(value)).toLocaleString('en-GB');
};

const formatMw = (value) => {
  const formattedValue = formatInteger(value);
  return formattedValue === 'No data' ? formattedValue : `${formattedValue} MW`;
};

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const formatSignedMw = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'No data';
  }

  const numericValue = Number(value);
  const absolute = Math.round(Math.abs(numericValue)).toLocaleString('en-GB');

  if (numericValue > 0) return `+${absolute} MW`;
  if (numericValue < 0) return `-${absolute} MW`;
  return '0 MW';
};

const formatCapacityUsed = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'No data';
  }

  return `${Math.round(Number(value))}% of capacity used`;
};

const getCountryLineFlows = (country) => (
  Array.isArray(country?.interconnectors)
    ? country.interconnectors
        .map(line => Number(line.flow_mw))
        .filter(value => Number.isFinite(value))
    : []
);

const getCountryImportMw = (country) => {
  if (isFiniteNumber(country?.import_mw)) {
    return Number(country.import_mw);
  }

  const lineFlows = getCountryLineFlows(country);
  if (lineFlows.length) {
    return lineFlows.reduce((total, flow) => total + Math.max(flow, 0), 0);
  }

  if (isFiniteNumber(country?.flow_mw)) {
    return Math.max(Number(country.flow_mw), 0);
  }

  return null;
};

const getCountryExportMw = (country) => {
  if (isFiniteNumber(country?.export_mw)) {
    return Number(country.export_mw);
  }

  const lineFlows = getCountryLineFlows(country);
  if (lineFlows.length) {
    return lineFlows.reduce((total, flow) => total + Math.abs(Math.min(flow, 0)), 0);
  }

  if (isFiniteNumber(country?.flow_mw)) {
    return Math.abs(Math.min(Number(country.flow_mw), 0));
  }

  return null;
};

const getGbConnectionPoint = (country) => {
  const backendPoint = (
    country?.gb_connection?.display_position ||
    country?.gb_connection?.map_position
  );

  if (
    backendPoint &&
    Number.isFinite(Number(backendPoint.x)) &&
    Number.isFinite(Number(backendPoint.y))
  ) {
    return {
      x: Number(backendPoint.x),
      y: Number(backendPoint.y),
    };
  }

  return COUNTRY_GB_CONNECTION_POINTS[country?.country_key] || COUNTRY_GB_CONNECTION_POINTS.france;
};

const getCountryPoint = (country) => {
  return INTERCONNECTOR_POINTS[country.country_key] || {
    x: MAP_VIEWBOX_X + MAP_VIEWBOX_WIDTH / 2,
    y: MAP_VIEWBOX_Y + MAP_VIEWBOX_HEIGHT / 2,
  };
};

const renderFlagFace = (countryKey) => {
  const clipId = `interconnector-flag-clip-${countryKey}`;
  const frame = <rect x="-18" y="-22" width="36" height="24" rx="3" />;

  const clipped = (children) => (
    <>
      <defs>
        <clipPath id={clipId}>{frame}</clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{children}</g>
      <rect
        x="-18"
        y="-22"
        width="36"
        height="24"
        rx="3"
        fill="none"
        stroke="rgba(15, 23, 42, 0.2)"
        strokeWidth="0.7"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    </>
  );

  if (countryKey === 'france') {
    return clipped(
      <>
        <FlagStripe x="-18" y="-22" width="12" height="24" fill="#002395" />
        <FlagStripe x="-6" y="-22" width="12" height="24" fill="#ffffff" />
        <FlagStripe x="6" y="-22" width="12" height="24" fill="#ed2939" />
      </>
    );
  }

  if (countryKey === 'netherlands') {
    return clipped(
      <>
        <FlagStripe x="-18" y="-22" width="36" height="8" fill="#ae1c28" />
        <FlagStripe x="-18" y="-14" width="36" height="8" fill="#ffffff" />
        <FlagStripe x="-18" y="-6" width="36" height="8" fill="#21468b" />
      </>
    );
  }

  if (countryKey === 'belgium') {
    return clipped(
      <>
        <FlagStripe x="-18" y="-22" width="12" height="24" fill="#000000" />
        <FlagStripe x="-6" y="-22" width="12" height="24" fill="#ffd90c" />
        <FlagStripe x="6" y="-22" width="12" height="24" fill="#ef3340" />
      </>
    );
  }

  if (countryKey === 'ireland') {
    return clipped(
      <>
        <FlagStripe x="-18" y="-22" width="12" height="24" fill="#169b62" />
        <FlagStripe x="-6" y="-22" width="12" height="24" fill="#ffffff" />
        <FlagStripe x="6" y="-22" width="12" height="24" fill="#ff883e" />
      </>
    );
  }

  if (countryKey === 'northern_ireland') {
    return clipped(
      <>
        <FlagStripe x="-18" y="-22" width="36" height="24" fill="#ffffff" />
        <text
          x="0"
          y="-14"
          fill="#102033"
          fontSize="7"
          fontWeight="900"
          textAnchor="middle"
          dominantBaseline="middle"
          pointerEvents="none"
        >
          Northern
        </text>
        <text
          x="0"
          y="-6"
          fill="#102033"
          fontSize="7"
          fontWeight="900"
          textAnchor="middle"
          dominantBaseline="middle"
          pointerEvents="none"
        >
          Ireland
        </text>
      </>
    );
  }

  if (countryKey === 'denmark') {
    return clipped(
      <>
        <FlagStripe x="-18" y="-22" width="36" height="24" fill="#c60c30" />
        <FlagStripe x="-7" y="-22" width="4" height="24" fill="#ffffff" />
        <FlagStripe x="-18" y="-13" width="36" height="4" fill="#ffffff" />
      </>
    );
  }

  if (countryKey === 'norway') {
    return clipped(
      <>
        <FlagStripe x="-18" y="-22" width="36" height="24" fill="#ba0c2f" />
        <FlagStripe x="-8" y="-22" width="8" height="24" fill="#ffffff" />
        <FlagStripe x="-18" y="-15" width="36" height="8" fill="#ffffff" />
        <FlagStripe x="-6" y="-22" width="4" height="24" fill="#00205b" />
        <FlagStripe x="-18" y="-13" width="36" height="4" fill="#00205b" />
      </>
    );
  }

  return clipped(
    <>
      <FlagStripe x="-18" y="-22" width="36" height="24" fill="#012169" />
      <path d="M -18 -22 L 18 2 M 18 -22 L -18 2" stroke="#ffffff" strokeWidth="7" pointerEvents="none" />
      <path d="M -18 -22 L 18 2 M 18 -22 L -18 2" stroke="#c8102e" strokeWidth="3.5" pointerEvents="none" />
      <FlagStripe x="-18" y="-13.5" width="36" height="7" fill="#ffffff" />
      <FlagStripe x="-3.5" y="-22" width="7" height="24" fill="#ffffff" />
      <FlagStripe x="-18" y="-12" width="36" height="4" fill="#c8102e" />
      <FlagStripe x="-2" y="-22" width="4" height="24" fill="#c8102e" />
    </>
  );
};

const renderInterconnectorLayer = ({
  countries,
  selectedCountryKey,
  onInterconnectorClick,
  onInterconnectorHover,
  onInterconnectorMove,
  onInterconnectorLeave,
  isPanningMap,
}) => {
  if (!countries?.length || !onInterconnectorClick) {
    return null;
  }

  const maxFlow = Math.max(
    ...countries
      .map(country => Math.abs(Number(country.flow_mw || 0)))
      .filter(value => Number.isFinite(value)),
    0
  );

  return (
    <g aria-label="GB interconnector flows">
      {countries.map(country => {
        const countryPoint = getCountryPoint(country);
        const gbPoint = getGbConnectionPoint(country);
        const color = getInterconnectorColor(country, maxFlow);
        const selected = selectedCountryKey === country.country_key;

        return (
          <g key={`${country.country_key}-flow`}>
            <InterconnectorLineHitArea
              x1={gbPoint.x}
              y1={gbPoint.y}
              x2={countryPoint.x}
              y2={countryPoint.y}
              $isPanning={isPanningMap}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onMouseEnter={(event) => onInterconnectorHover?.(country, event)}
              onMouseMove={onInterconnectorMove}
              onMouseLeave={onInterconnectorLeave}
              onClick={(event) => {
                event.stopPropagation();
                onInterconnectorClick(country.country_key);
              }}
            />
            <InterconnectorLine
              x1={gbPoint.x}
              y1={gbPoint.y}
              x2={countryPoint.x}
              y2={countryPoint.y}
              $color={color}
              $selected={selected}
            />
            <InterconnectorLandingDot
              cx={gbPoint.x}
              cy={gbPoint.y}
              r={4.8}
              $color={color}
            />
          </g>
        );
      })}

      {countries.map(country => {
        const point = getCountryPoint(country);
        const color = getInterconnectorColor(country, maxFlow);
        const selected = selectedCountryKey === country.country_key;
        const code = COUNTRY_CODES[country.country_key] || country.country_name?.slice(0, 2)?.toUpperCase();

        return (
          <InterconnectorFlagGroup
            key={`${country.country_key}-flag`}
            role="button"
            tabIndex={0}
            aria-label={`${country.market_label || country.country_name} interconnector flow`}
            transform={`translate(${point.x} ${point.y})`}
            $isPanning={isPanningMap}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onMouseEnter={(event) => onInterconnectorHover?.(country, event)}
            onMouseMove={onInterconnectorMove}
            onMouseLeave={onInterconnectorLeave}
            onClick={(event) => {
              event.stopPropagation();
              onInterconnectorClick(country.country_key);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onInterconnectorClick(country.country_key);
              }
            }}
          >
            <title>{country.market_label || country.country_name}</title>
            <InterconnectorFlagCard
              x="-24"
              y="-28"
              width="48"
              height="56"
              $color={color}
              $selected={selected}
            />
            {renderFlagFace(country.country_key)}
            <InterconnectorCodeText x="0" y="17">{code}</InterconnectorCodeText>
          </InterconnectorFlagGroup>
        );
      })}
    </g>
  );
};

const GBMap = ({
  zoneData,
  onZoneClick,
  isSplitView,
  interconnectorCountries,
  selectedInterconnectorCountryKey,
  onInterconnectorClick,
}) => {
  const [hoveredZone, setHoveredZone] = useState(null);
  const [hoveredInterconnector, setHoveredInterconnector] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [tooltipPlacement, setTooltipPlacement] = useState('bottom');
  const [mapTransform, setMapTransform] = useState(DEFAULT_MAP_TRANSFORM);
  const [isPanningMap, setIsPanningMap] = useState(false);
  const isMapAtDefault =
    Math.abs(mapTransform.scale - DEFAULT_MAP_TRANSFORM.scale) < 0.001 &&
    Math.abs(mapTransform.x - DEFAULT_MAP_TRANSFORM.x) < 0.001 &&
    Math.abs(mapTransform.y - DEFAULT_MAP_TRANSFORM.y) < 0.001;
  const hasInterconnectorLayer = Boolean(interconnectorCountries?.length && !isSplitView);
  const svgViewBox = hasInterconnectorLayer
    ? MAP_WITH_INTERCONNECTOR_VIEWBOX
    : GSP_GROUP_BOUNDARY_SOURCE.viewBox;

  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const panStartRef = useRef(null);
  const didPanRef = useRef(false);
  const suppressNextClickRef = useRef(false);

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
      });
    });
  };

  const handleMapWheel = (event) => {
    event.preventDefault();
    const point = getSvgPoint(event);
    const factor = event.deltaY < 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP;

    setMapTransform(current => {
      const scale = clamp(current.scale * factor, MIN_MAP_ZOOM, MAX_MAP_ZOOM);

      if (!point) {
        return clampMapTransform({ ...current, scale });
      }

      const worldX = (point.x - current.x) / current.scale;
      const worldY = (point.y - current.y) / current.scale;

      return clampMapTransform({
        scale,
        x: point.x - worldX * scale,
        y: point.y - worldY * scale,
      });
    });
  };

  const handleZoomButton = (direction) => {
    const focusPoint = {
      x: MAP_VIEWBOX_X + MAP_VIEWBOX_WIDTH / 2,
      y: MAP_VIEWBOX_Y + MAP_VIEWBOX_HEIGHT / 2,
    };
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

    event.preventDefault();
    const point = getSvgPoint(event);
    if (!point) return;
    const zoneId = event.target?.dataset?.zoneId || null;

    panStartRef.current = {
      pointerId: event.pointerId,
      point,
      clientX: event.clientX,
      clientY: event.clientY,
      zoneId,
      transform: mapTransform,
    };
    didPanRef.current = false;
    setIsPanningMap(true);
    setHoveredZone(null);
    setHoveredInterconnector(null);
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
    }));
  };

  const handleMapPointerEnd = (event) => {
    const panStart = panStartRef.current;
    if (!panStart || panStart.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    panStartRef.current = null;
    setIsPanningMap(false);

    if (!didPanRef.current && panStart.zoneId && onZoneClick) {
      suppressNextClickRef.current = true;
      onZoneClick(panStart.zoneId);
    }

    didPanRef.current = false;
  };

  const handleMapPointerCancel = (event) => {
    const panStart = panStartRef.current;
    if (!panStart || panStart.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    panStartRef.current = null;
    setIsPanningMap(false);
    didPanRef.current = false;
  };

  const getTooltipPositioning = (rawX, rawY) => {
    if (!containerRef.current) {
      return { x: rawX, y: rawY, placement: 'bottom' };
    }

    const rect = containerRef.current.getBoundingClientRect();

    const tooltipWidth = 280;
    const tooltipHeight = 130;
    const margin = 12;
    const offset = 14;

    const placement =
      rawY + offset + tooltipHeight > rect.height - margin ? 'top' : 'bottom';

    const minX = margin;
    const maxX = Math.max(margin, rect.width - tooltipWidth - margin);

    const x = Math.min(Math.max(rawX, minX), maxX);

    const y =
      placement === 'top'
        ? Math.min(Math.max(rawY, tooltipHeight + margin), rect.height - margin)
        : Math.min(Math.max(rawY, margin), rect.height - tooltipHeight - margin);

    return { x, y, placement };
  };

  const handleMouseEnter = (zone, event) => {
    const data = zoneData?.[zone.id];

    const containerRect = containerRef.current?.getBoundingClientRect();
    const localX = containerRect ? event.clientX - containerRect.left : 0;
    const localY = containerRect ? event.clientY - containerRect.top : 0;

    const positioning = getTooltipPositioning(localX, localY);

    setTooltipPos({ x: positioning.x, y: positioning.y });
    setTooltipPlacement(positioning.placement);
    setHoveredInterconnector(null);

    setHoveredZone({
      id: zone.id,
      name: zone.name,
      netVol: data ? data.net_volume : 'No data',
      energyVol: data ? data.energy_volume : 'N/A',
      systemVol: data ? data.system_volume : 'N/A'
    });
  };

  const handleMouseMove = (event) => {
    if (!hoveredZone) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    const localX = containerRect ? event.clientX - containerRect.left : 0;
    const localY = containerRect ? event.clientY - containerRect.top : 0;

    const positioning = getTooltipPositioning(localX, localY);
    setTooltipPos({ x: positioning.x, y: positioning.y });
    setTooltipPlacement(positioning.placement);
  };

  const handleInterconnectorHover = (country, event) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const localX = containerRect ? event.clientX - containerRect.left : 0;
    const localY = containerRect ? event.clientY - containerRect.top : 0;
    const positioning = getTooltipPositioning(localX, localY);

    setTooltipPos({ x: positioning.x, y: positioning.y });
    setTooltipPlacement(positioning.placement);
    setHoveredZone(null);
    setHoveredInterconnector(country);
  };

  const handleInterconnectorMove = (event) => {
    if (!hoveredInterconnector) return;

    const containerRect = containerRef.current?.getBoundingClientRect();
    const localX = containerRect ? event.clientX - containerRect.left : 0;
    const localY = containerRect ? event.clientY - containerRect.top : 0;
    const positioning = getTooltipPositioning(localX, localY);

    setTooltipPos({ x: positioning.x, y: positioning.y });
    setTooltipPlacement(positioning.placement);
  };

  const handleInterconnectorLeave = () => {
    setHoveredInterconnector(null);
  };

  return (
    <MapContainer ref={containerRef}>
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

      <StyledSvg
        ref={svgRef}
        viewBox={svgViewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Great Britain balancing mechanism zone map"
        $isPanning={isPanningMap}
        $isDraggable
        onWheel={handleMapWheel}
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerUp={handleMapPointerEnd}
        onPointerCancel={handleMapPointerCancel}
      >
        <g transform={`translate(${mapTransform.x} ${mapTransform.y}) scale(${mapTransform.scale})`}>
          {GB_MAP_ZONES.map((zone) =>
            zone.paths.map((path, index) => (
              <ZonePolygon
                key={`${zone.id}-${index}`}
                d={path}
                data-zone-id={zone.id}
                fillRule="evenodd"
                fillColor={getZoneColor(zone.id, zoneData)}
                hoverColor="#d0d0d0"
                isHovered={hoveredZone?.id === zone.id}
                $isPanning={isPanningMap}
                onClick={() => {
                  if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                  }

                  if (!didPanRef.current) {
                    onZoneClick?.(zone.id);
                  }
                }}
                onMouseEnter={(e) => handleMouseEnter(zone, e)}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoveredZone(null)}
              />
            ))
          )}
          {GB_MAP_ZONES.map(zone => renderZoneLabel(zone, hoveredZone?.id))}
          {renderInterconnectorLayer({
            countries: interconnectorCountries,
            selectedCountryKey: selectedInterconnectorCountryKey,
            onInterconnectorClick,
            onInterconnectorHover: handleInterconnectorHover,
            onInterconnectorMove: handleInterconnectorMove,
            onInterconnectorLeave: handleInterconnectorLeave,
            isPanningMap,
          })}
        </g>
      </StyledSvg>

      {hoveredZone && (
        <ZoneInfo
          x={tooltipPos.x}
          y={tooltipPos.y}
          placement={tooltipPlacement}
        >
          <ZoneName>{hoveredZone.name}</ZoneName>
          <ZoneVolume value={hoveredZone.netVol}>
            Net Volume: {typeof hoveredZone.netVol === 'number'
              ? `${hoveredZone.netVol.toFixed(2)} MWh`
              : hoveredZone.netVol}
          </ZoneVolume>
          <VolumeBreakdown>
            <div>
              Energy Actions: {typeof hoveredZone.energyVol === 'number'
                ? `${hoveredZone.energyVol.toFixed(2)} MWh`
                : hoveredZone.energyVol}
            </div>
            <div>
              System Actions: {typeof hoveredZone.systemVol === 'number'
                ? `${hoveredZone.systemVol.toFixed(2)} MWh`
                : hoveredZone.systemVol}
            </div>
          </VolumeBreakdown>
        </ZoneInfo>
      )}

      {hoveredInterconnector && (
        <InterconnectorInfo
          x={tooltipPos.x}
          y={tooltipPos.y}
          placement={tooltipPlacement}
        >
          <InterconnectorName>
            {hoveredInterconnector.market_label || hoveredInterconnector.country_name}
          </InterconnectorName>
          <InterconnectorFlow $direction={hoveredInterconnector.direction}>
            {hoveredInterconnector.direction_label}: {formatSignedMw(hoveredInterconnector.flow_mw)}
          </InterconnectorFlow>
          <InterconnectorMeta>
            In {formatMw(getCountryImportMw(hoveredInterconnector))} · Out {formatMw(getCountryExportMw(hoveredInterconnector))}
          </InterconnectorMeta>
          <InterconnectorMeta>
            {formatCapacityUsed(hoveredInterconnector.utilisation_pct)}
          </InterconnectorMeta>
        </InterconnectorInfo>
      )}

      {!isSplitView && (
        <MapLegend aria-label="Map colour legend">
          <LegendTitle>Map Legend</LegendTitle>
          <LegendRows>
            <LegendRow>
              <LegendSwatch $color="linear-gradient(90deg, #ffe6e6, #ff4d4d, #b30000)" />
              <LegendText>
                <LegendStrong>Red</LegendStrong>: offer / upward action dominant
              </LegendText>
            </LegendRow>
            <LegendRow>
              <LegendSwatch $color="linear-gradient(90deg, #e6ffe6, #00b300, #004d00)" />
              <LegendText>
                <LegendStrong>Green</LegendStrong>: bid / downward action dominant
              </LegendText>
            </LegendRow>
            <LegendRow>
              <LegendSwatch $color="#e8e8e8" />
              <LegendText>
                <LegendStrong>Grey</LegendStrong>: no data or neutral net volume
              </LegendText>
            </LegendRow>
            <LegendRow>
              <LegendSwatch $color="linear-gradient(90deg, #ffb3b3, #b30000)" />
              <LegendText>
                <LegendStrong>Red line</LegendStrong>: import to GB, darker is higher MW
              </LegendText>
            </LegendRow>
            <LegendRow>
              <LegendSwatch $color="linear-gradient(90deg, #b3ffb3, #004d00)" />
              <LegendText>
                <LegendStrong>Green line</LegendStrong>: export from GB, darker is higher MW
              </LegendText>
            </LegendRow>
          </LegendRows>
        </MapLegend>
      )}
    </MapContainer>
  );
};

export default GBMap;
