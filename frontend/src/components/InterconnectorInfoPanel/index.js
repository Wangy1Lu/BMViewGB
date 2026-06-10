import React from 'react';
import styled from '@emotion/styled';
import DateSelector from '../DateSelector';
import SettlementPeriodSlider from '../SettlementPeriodSlider';

const PanelHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 4px;
`;

const HeaderEyebrow = styled.div`
  color: #0878d8;
  font-size: 0.72rem;
  font-weight: 850;
  text-transform: uppercase;
`;

const HeaderTitle = styled.div`
  margin-top: 4px;
  color: #102033;
  font-size: 1.28rem;
  font-weight: 850;
`;

const HeaderMeta = styled.div`
  margin-top: 4px;
  color: #64748b;
  font-size: 0.9rem;
`;

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Button = styled.button`
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid ${props => (props.$primary ? '#0878d8' : '#d7e0ea')};
  border-radius: 8px;
  background: ${props => (props.$primary ? '#0878d8' : '#ffffff')};
  color: ${props => (props.$primary ? '#ffffff' : '#102033')};
  font-size: 0.84rem;
  font-weight: 850;
  cursor: pointer;

  &:hover {
    background: ${props => (props.$primary ? '#0667b9' : '#eef6fd')};
    border-color: ${props => (props.$primary ? '#0667b9' : '#bad4ea')};
  }

  &:disabled {
    background: #e2e8f0;
    border-color: #e2e8f0;
    color: #94a3b8;
    cursor: not-allowed;
  }
`;

const PanelSection = styled.section`
  padding: 15px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #dfe8f2;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
`;

const SectionHeader = styled.div`
  margin-bottom: 12px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  color: #102033;
  font-size: 0.95rem;
  font-weight: 850;
`;

const SectionMeta = styled.div`
  margin-top: 3px;
  color: #64748b;
  font-size: 0.82rem;
`;

const StatusMessage = styled.div`
  padding: 10px 12px;
  background-color: ${props => (props.$error ? '#fff1f2' : '#fff7ed')};
  border: 1px solid ${props => (props.$error ? '#fecdd3' : '#fed7aa')};
  border-radius: 8px;
  color: ${props => (props.$error ? '#9f1239' : '#9a3412')};
  font-size: 0.88rem;
  line-height: 1.35;
  word-wrap: break-word;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
`;

const MetricTile = styled.div`
  padding: 11px;
  border: 1px solid #dfe8f2;
  border-radius: 8px;
  background: #fbfdff;
`;

const MetricLabel = styled.div`
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 850;
  text-transform: uppercase;
`;

const MetricValue = styled.div`
  margin-top: 5px;
  color: ${props => props.$tone || '#102033'};
  font-size: 1.16rem;
  line-height: 1.1;
  font-weight: 850;
`;

const SelectedHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
`;

const SelectedFlag = styled.div`
  font-size: 2.1rem;
  line-height: 1;
`;

const SelectedName = styled.div`
  color: #102033;
  font-size: 1rem;
  font-weight: 850;
`;

const SelectedMeta = styled.div`
  margin-top: 2px;
  color: #64748b;
  font-size: 0.82rem;
  line-height: 1.35;
`;

const TrendBlock = styled.div`
  margin: 12px 0 13px;
  padding: 11px 0 2px;
  border-top: 1px solid #e3ebf4;
  border-bottom: 1px solid #e3ebf4;
`;

const TrendHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
`;

const TrendTitle = styled.div`
  color: #102033;
  font-size: 0.84rem;
  font-weight: 850;
`;

const TrendValue = styled.div`
  color: ${props => {
    if (props.$direction === 'import_to_gb') return '#b30000';
    if (props.$direction === 'export_from_gb') return '#166534';
    return '#64748b';
  }};
  font-size: 0.82rem;
  font-weight: 850;
  text-align: right;
`;

const TrendSvg = styled.svg`
  width: 100%;
  height: 78px;
  display: block;
`;

const TrendLabels = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
  color: #64748b;
  font-size: 0.72rem;
`;

const RowList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const LineRow = styled.div`
  display: grid;
  grid-template-columns: minmax(92px, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid #dfe8f2;
  border-radius: 8px;
  background: #ffffff;
`;

const LineName = styled.div`
  color: #102033;
  font-size: 0.9rem;
  font-weight: 850;
`;

const LineMeta = styled.div`
  margin-top: 3px;
  color: #64748b;
  font-size: 0.78rem;
  line-height: 1.25;
`;

const FlowValue = styled.div`
  text-align: right;
  color: ${props => {
    if (props.$direction === 'import_to_gb') return '#b30000';
    if (props.$direction === 'export_from_gb') return '#166534';
    return '#64748b';
  }};
  font-size: 0.92rem;
  font-weight: 850;
`;

const SourceText = styled.span`
  color: #075da0;
  font-weight: 850;
`;

const formatInteger = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'No data';
  }
  return Math.round(Number(value)).toLocaleString('en-GB');
};

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

const formatMw = (value) => {
  const formattedValue = formatInteger(value);
  return formattedValue === 'No data' ? formattedValue : `${formattedValue} MW`;
};

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'No data';
  }
  return `${Math.round(Number(value))}% of capacity used`;
};

const formatTimestamp = (value) => {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(parsed);
};

const getMarketMarker = (country) => (
  country?.country_key === 'northern_ireland' ? 'NI' : country?.flag
);

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

const getDirectionForFlow = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'no_data';
  }

  const numericValue = Number(value);
  if (numericValue > 0) return 'import_to_gb';
  if (numericValue < 0) return 'export_from_gb';
  return 'idle';
};

const CountryFlowSparkline = ({ series, selectedPeriod }) => {
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }

  const width = 360;
  const height = 78;
  const paddingX = 8;
  const zeroY = 39;
  const halfHeight = 28;
  const chartWidth = width - paddingX * 2;
  const barWidth = Math.max(2, chartWidth / series.length - 1);
  const finiteFlows = series
    .map(point => Number(point.flow_mw))
    .filter(value => Number.isFinite(value));
  const maxAbsFlow = Math.max(1, ...finiteFlows.map(value => Math.abs(value)));
  const selectedPoint = series.find(
    point => Number(point.settlement_period) === Number(selectedPeriod)
  );
  const firstPeriod = series[0]?.settlement_period;
  const lastPeriod = series[series.length - 1]?.settlement_period;

  const getX = (index) => paddingX + index * (chartWidth / series.length) + 0.5;

  return (
    <TrendBlock>
      <TrendHeader>
        <TrendTitle>Intraday flow profile</TrendTitle>
        <TrendValue $direction={getDirectionForFlow(selectedPoint?.flow_mw)}>
          SP {selectedPeriod}: {formatSignedMw(selectedPoint?.flow_mw)}
        </TrendValue>
      </TrendHeader>
      <TrendSvg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-label="Selected market intraday interconnector flow profile"
      >
        <line
          x1={paddingX}
          y1={zeroY}
          x2={width - paddingX}
          y2={zeroY}
          stroke="#cbd5e1"
          strokeWidth="1"
        />
        {series.map((point, index) => {
          const flow = Number(point.flow_mw);
          const x = getX(index);

          if (!Number.isFinite(flow)) {
            return (
              <rect
                key={`missing-${point.settlement_period}`}
                x={x}
                y={zeroY - 1}
                width={barWidth}
                height="2"
                rx="1"
                fill="#cbd5e1"
                opacity="0.55"
              />
            );
          }

          const magnitude = Math.max(2, Math.abs(flow) / maxAbsFlow * halfHeight);
          const isImport = flow > 0;
          const isSelected = Number(point.settlement_period) === Number(selectedPeriod);
          const y = flow >= 0 ? zeroY - magnitude : zeroY;

          return (
            <rect
              key={`flow-${point.settlement_period}`}
              x={x}
              y={y}
              width={barWidth}
              height={magnitude}
              rx="1.2"
              fill={isImport ? '#b30000' : '#166534'}
              opacity={isSelected ? '1' : '0.62'}
              stroke={isSelected ? '#102033' : 'none'}
              strokeWidth={isSelected ? '1.1' : '0'}
            />
          );
        })}
      </TrendSvg>
      <TrendLabels>
        <span>SP {firstPeriod}</span>
        <span>Red import · Green export</span>
        <span>SP {lastPeriod}</span>
      </TrendLabels>
    </TrendBlock>
  );
};

const InterconnectorInfoPanel = ({
  flowData,
  selectedCountry,
  selectedDate,
  settlementPeriod,
  loading,
  error,
  onDateChange,
  onSettlementPeriodChange,
  onRefresh,
  onClose,
}) => {
  const availablePeriods = flowData?.available_periods || [];
  const resolved = flowData?.resolved || {};
  const totals = flowData?.totals || {};
  const sliderMin = availablePeriods.length ? Math.min(...availablePeriods) : 1;
  const sliderMax = availablePeriods.length ? Math.max(...availablePeriods) : 50;
  const selectedPeriod = Number(settlementPeriod || resolved.settlement_period || sliderMin);
  const resolvedPeriod = Math.min(Math.max(selectedPeriod, sliderMin), Math.max(sliderMin, sliderMax));
  const selectedCountrySeries = selectedCountry
    ? flowData?.series?.countries?.[selectedCountry.country_key]
    : null;

  return (
    <>
      <PanelHeader>
        <div>
          <HeaderEyebrow>Interconnector Flow</HeaderEyebrow>
          <HeaderTitle>{selectedCountry?.market_label || 'Selected market'}</HeaderTitle>
          <HeaderMeta>Resolved {formatTimestamp(resolved.start_time)}</HeaderMeta>
        </div>
        <ButtonGroup>
          <Button type="button" onClick={onRefresh} disabled={loading}>Refresh</Button>
          <Button type="button" onClick={onClose} $primary>GB View</Button>
        </ButtonGroup>
      </PanelHeader>

      <PanelSection>
        <SectionHeader>
          <SectionTitle>Date</SectionTitle>
          <SectionMeta>Interconnector source date</SectionMeta>
        </SectionHeader>
        <DateSelector selectedDate={selectedDate} onDateChange={onDateChange} />
      </PanelSection>

      <PanelSection>
        <SettlementPeriodSlider
          label="Settlement period"
          min={sliderMin}
          max={Math.max(sliderMin, sliderMax)}
          disabled={!flowData}
          currentSettlementPeriod={resolvedPeriod}
          handleSliderChange={onSettlementPeriodChange}
          valueLabel={`SP ${resolvedPeriod}`}
          valueMeta={`${availablePeriods.length || 0} valid settlement periods for selected date`}
          commitOnRelease
        />
      </PanelSection>

      {error && <StatusMessage $error>{error}</StatusMessage>}
      {!error && resolved.message && (
        <StatusMessage>{resolved.message}</StatusMessage>
      )}

      <PanelSection>
        <SectionHeader>
          <SectionTitle>GB totals</SectionTitle>
          <SectionMeta>
            {totals.available_interconnector_count || 0} of {totals.configured_interconnector_count || 0} lines available
          </SectionMeta>
        </SectionHeader>
        <SummaryGrid>
          <MetricTile>
            <MetricLabel>Import</MetricLabel>
            <MetricValue $tone="#b30000">{formatInteger(totals.import_mw)} MW</MetricValue>
          </MetricTile>
          <MetricTile>
            <MetricLabel>Export</MetricLabel>
            <MetricValue $tone="#166534">{formatInteger(totals.export_mw)} MW</MetricValue>
          </MetricTile>
          <MetricTile>
            <MetricLabel>Net import</MetricLabel>
            <MetricValue>{formatSignedMw(totals.net_import_mw)}</MetricValue>
          </MetricTile>
          <MetricTile>
            <MetricLabel>Capacity</MetricLabel>
            <MetricValue>{formatInteger(totals.total_nominal_capacity_mw)} MW</MetricValue>
          </MetricTile>
        </SummaryGrid>
      </PanelSection>

      {selectedCountry && (
        <PanelSection>
          <SelectedHeader>
            <SelectedFlag>{getMarketMarker(selectedCountry)}</SelectedFlag>
            <div>
              <SelectedName>{selectedCountry.market_label}</SelectedName>
              <SelectedMeta>
                <div>
                  {selectedCountry.direction_label} · Net {formatSignedMw(selectedCountry.flow_mw)}
                </div>
                <div>
                  In {formatMw(getCountryImportMw(selectedCountry))} · Out {formatMw(getCountryExportMw(selectedCountry))} · {formatPercent(selectedCountry.utilisation_pct)}
                </div>
              </SelectedMeta>
            </div>
          </SelectedHeader>
          <CountryFlowSparkline
            series={selectedCountrySeries}
            selectedPeriod={resolvedPeriod}
          />
          <RowList>
            {selectedCountry.interconnectors.map(line => (
              <LineRow key={line.id}>
                <div>
                  <LineName>{line.line_name}</LineName>
                  <LineMeta>{line.landing_gb} · {formatInteger(line.capacity_mw)} MW</LineMeta>
                </div>
                <FlowValue $direction={line.direction}>
                  {formatSignedMw(line.flow_mw)}
                  <LineMeta>{formatPercent(line.utilisation_pct)}</LineMeta>
                </FlowValue>
              </LineRow>
            ))}
          </RowList>
        </PanelSection>
      )}

      <PanelSection>
        <SectionHeader>
          <SectionTitle>All markets</SectionTitle>
          <SectionMeta>
            Source: <SourceText>Elexon</SourceText>
          </SectionMeta>
        </SectionHeader>
        <RowList>
          {(flowData?.countries || []).map(country => (
            <LineRow key={country.country_key}>
              <div>
                <LineName>{getMarketMarker(country)} {country.market_label}</LineName>
                <LineMeta>
                  {country.available_line_count} of {country.line_count} lines reporting · In {formatMw(getCountryImportMw(country))} · Out {formatMw(getCountryExportMw(country))}
                </LineMeta>
              </div>
              <FlowValue $direction={country.direction}>{formatSignedMw(country.flow_mw)}</FlowValue>
            </LineRow>
          ))}
        </RowList>
      </PanelSection>
    </>
  );
};

export default InterconnectorInfoPanel;
