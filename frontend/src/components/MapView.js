import React, { useState, useEffect, useCallback } from 'react';
import GBMap from './Map';
import DateSelector from './DateSelector';
import SettlementPeriodSlider from './SettlementPeriodSlider';
import InfoPanel from './InfoPanel';
import NumericsPanel from './NumericsPanel';
import styled from '@emotion/styled';
import InterconnectorInfoPanel from './InterconnectorInfoPanel';
import NodeDrilldownPane from './NodeDrilldownPane';
import { fetchDailyData, fetchInterconnectorFlows, fetchNodesByZone } from '../services/api';
import { GB_ZONES } from './Map/zones';

const SplitViewContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  gap: 16px;
`;

const ViewContainer = styled.div`
  display: flex;
  flex-direction: row;
  border: 1px solid #d9e3ee;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
  overflow: hidden;
  height: 100%;
  flex: 1;
`;

const MapSection = styled.div`
  flex: ${props => (props.isSplitView ? '3 1 0' : '1 1 auto')};
  position: relative;
  min-width: 0;
  min-height: ${props => (props.isSplitView ? '600px' : '700px')};
  background: #fbfdff;
`;

const ControlSection = styled.div`
  flex: ${props => (props.isSplitView ? '0 0 380px' : '0 0 clamp(420px, 34vw, 560px)')};
  min-width: ${props => (props.isSplitView ? '360px' : '420px')};
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background-color: #f7f9fc;
  border-left: 1px solid #e3ebf4;
  overflow-y: auto;
`;

const ControlHeader = styled.div`
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

const ControlGroup = styled.section`
  padding: 15px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #dfe8f2;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
`;

const GroupHeader = styled.div`
  margin-bottom: 12px;
`;

const GroupTitle = styled.h3`
  margin: 0;
  color: #102033;
  font-size: 0.95rem;
  font-weight: 850;
`;

const GroupSubtitle = styled.div`
  margin-top: 3px;
  color: #64748b;
  font-size: 0.82rem;
`;

const TopControlsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const Button = styled.button`
  min-height: 38px;
  padding: 8px 14px;
  font-size: 0.9rem;
  font-weight: 800;
  cursor: pointer;
  background-color: ${props => (props.$variant === 'secondary' ? '#ffffff' : '#0878d8')};
  color: ${props => (props.$variant === 'secondary' ? '#102033' : '#ffffff')};
  border: 1px solid ${props => (props.$variant === 'secondary' ? '#d7e0ea' : '#0878d8')};
  border-radius: 8px;
  transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;

  &:hover {
    background-color: ${props => (props.$variant === 'secondary' ? '#f2f7fb' : '#0667b9')};
    border-color: ${props => (props.$variant === 'secondary' ? '#c5d2df' : '#0667b9')};
  }

  &:disabled {
    background-color: #d1d5db;
    border-color: #d1d5db;
    color: #ffffff;
    cursor: not-allowed;
  }
`;

const TemporalControls = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const PlaybackControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const AggregationSelector = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`;

const SegmentButton = styled.button`
  min-height: 36px;
  padding: 7px 8px;
  border: 1px solid ${props => (props.$active ? '#0878d8' : '#d7e0ea')};
  border-radius: 8px;
  background: ${props => (props.$active ? '#e7f3ff' : '#ffffff')};
  color: ${props => (props.$active ? '#075da0' : '#344255')};
  font-size: 0.86rem;
  font-weight: 800;
  cursor: pointer;

  &:hover {
    border-color: #0878d8;
  }
`;

const InlineField = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #536174;
  font-size: 0.86rem;
  font-weight: 750;
`;

const SelectInput = styled.select`
  min-height: 36px;
  padding: 6px 28px 6px 10px;
  border: 1px solid #d7e0ea;
  border-radius: 8px;
  background: #ffffff;
  color: #102033;
  font-size: 0.92rem;

  &:focus {
    border-color: #0878d8;
    box-shadow: 0 0 0 3px rgba(8, 120, 216, 0.12);
    outline: none;
  }
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
`;

const StatusMessage = styled.div`
  padding: 10px 12px;
  background-color: ${props => (props.error ? '#fff1f2' : '#ecfdf5')};
  border: 1px solid ${props => (props.error ? '#fecdd3' : '#bbf7d0')};
  border-radius: 8px;
  color: ${props => (props.error ? '#9f1239' : '#166534')};
  font-size: 0.9rem;
  word-wrap: break-word;
`;

const MapGuide = styled.div`
  position: absolute;
  top: 24px;
  left: 24px;
  z-index: 6;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  padding: 11px 14px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.07);
  color: #334155;
  font-size: 0.92rem;
  line-height: 1.4;
  max-width: 300px;
`;

const MapGuideTitle = styled.div`
  color: #102033;
  font-weight: 850;
`;

const MapGuideMeta = styled.div`
  margin-top: 3px;
  color: #64748b;
  font-size: 0.84rem;
`;

const CoverageGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
`;

const CoverageCard = styled.div`
  padding: 11px;
  border: 1px solid #dfe8f2;
  border-radius: 8px;
  background: #fbfdff;
`;

const CoverageName = styled.div`
  color: #102033;
  font-size: 0.9rem;
  font-weight: 850;
  margin-bottom: 10px;
`;

const CoverageMetricGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
`;

const CoverageMetric = styled.div`
  min-width: 0;
`;

const CoverageMetricValue = styled.div`
  color: #102033;
  font-size: 1.04rem;
  font-weight: 850;
`;

const CoverageMetricLabel = styled.div`
  margin-top: 2px;
  color: #64748b;
  font-size: 0.72rem;
`;

const CoverageMissing = styled.div`
  margin-top: 2px;
  color: #946200;
  font-size: 0.7rem;
  font-weight: 750;
`;

const AGGREGATION_OPTIONS = [
  { value: '30min', label: '30-min' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatClockTime(totalMinutes) {
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function formatDateLabel(selectedDate) {
  const date = new Date(Date.UTC(
    selectedDate.year,
    selectedDate.month - 1,
    selectedDate.day
  ));

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getTodayDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return {
    year: Number(valueByType.year),
    month: Number(valueByType.month),
    day: Number(valueByType.day),
  };
}

function getCurrentGbSettlementPeriod() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const hour = Number(valueByType.hour);
  const minute = Number(valueByType.minute);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 1;
  }

  return Math.min(Math.floor((hour * 60 + minute) / 30) + 1, 50);
}

function getTimeScopeDisplay({ aggregation, currentTimePoint, sliderConfig, dayType }) {
  if (aggregation === 'daily') {
    return {
      sliderLabel: 'Daily total',
      valueLabel: 'Full day',
      valueMeta: 'All settlement periods aggregated',
      summary: 'Daily total',
    };
  }

  if (aggregation === 'hourly') {
    const start = currentTimePoint * 60;
    const range = `${formatClockTime(start)}-${formatClockTime(start + 60)}`;

    return {
      sliderLabel: 'Hour',
      valueLabel: `Hour ${currentTimePoint}`,
      valueMeta: range,
      summary: `Hour ${currentTimePoint} - ${range}`,
    };
  }

  const isStandardSettlementDay = dayType === 'N' && sliderConfig.max === 48;
  const start = (currentTimePoint - 1) * 30;
  const range = isStandardSettlementDay
    ? `${formatClockTime(start)}-${formatClockTime(start + 30)}`
    : null;

  return {
    sliderLabel: 'Settlement period',
    valueLabel: `SP ${currentTimePoint}`,
    valueMeta: range || `Period ${currentTimePoint} of ${sliderConfig.max}`,
    summary: range ? `SP ${currentTimePoint} - ${range}` : `SP ${currentTimePoint} of ${sliderConfig.max}`,
  };
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.0%';
  return `${number.toFixed(1)}%`;
}

const DataCoveragePanel = ({ coverageSummary }) => {
  if (!coverageSummary?.rows?.length) {
    return null;
  }

  const nmsCoverage = coverageSummary.rows.find(row => row.mapping === 'nms_visible');

  if (!nmsCoverage) {
    return null;
  }

  return (
    <ControlGroup>
      <GroupHeader>
        <GroupTitle>Data Coverage</GroupTitle>
        <GroupSubtitle>
          Annual reference: {coverageSummary.date_min} to {coverageSummary.date_max}
        </GroupSubtitle>
      </GroupHeader>

      <CoverageGrid>
        <CoverageCard>
          <CoverageName>{nmsCoverage.label}</CoverageName>

          <CoverageMetricGrid>
            <CoverageMetric>
              <CoverageMetricValue>{formatPercent(nmsCoverage.bmu_coverage_rate_pct)}</CoverageMetricValue>
              <CoverageMetricLabel>BMUs</CoverageMetricLabel>
              <CoverageMissing>
                {formatPercent(nmsCoverage.bmu_missing_rate_pct)} missing
              </CoverageMissing>
            </CoverageMetric>

            <CoverageMetric>
              <CoverageMetricValue>{formatPercent(nmsCoverage.offer_coverage_rate_pct)}</CoverageMetricValue>
              <CoverageMetricLabel>Offer MWh</CoverageMetricLabel>
              <CoverageMissing>
                {formatPercent(nmsCoverage.offer_missing_rate_pct)} missing
              </CoverageMissing>
            </CoverageMetric>

            <CoverageMetric>
              <CoverageMetricValue>{formatPercent(nmsCoverage.bid_coverage_rate_pct)}</CoverageMetricValue>
              <CoverageMetricLabel>Bid MWh</CoverageMetricLabel>
              <CoverageMissing>
                {formatPercent(nmsCoverage.bid_missing_rate_pct)} missing
              </CoverageMissing>
            </CoverageMetric>
          </CoverageMetricGrid>
        </CoverageCard>
      </CoverageGrid>
    </ControlGroup>
  );
};

const useMapViewController = (initialDate) => {
  const [selectedDate, setSelectedDate] = useState({
    year: initialDate?.year || 2024,
    month: initialDate?.month || 1,
    day: initialDate?.day || 1,
  });

  const [aggregation, setAggregation] = useState('30min');
  const [currentTimePoint, setCurrentTimePoint] = useState(initialDate?.settlementPeriod || 1);
  const [dailyData, setDailyData] = useState({
    day_type: 'N',
    settlement_period: [],
    hourly: [],
    daily: [],
    coverage_summary: null,
  });

  const [processedSpData, setProcessedSpData] = useState({});
  const [processedHrData, setProcessedHrData] = useState({});
  const [currentZoneData, setCurrentZoneData] = useState({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ message: 'Ready', error: false });
  const [showNumerics, setShowNumerics] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const handleDateChange = useCallback((name, value) => {
    setSelectedDate(prev => ({ ...prev, [name]: parseInt(value, 10) }));
    setCurrentTimePoint(aggregation === 'hourly' ? 0 : 1);
    setIsPlaying(false);
  }, [aggregation]);

  const handleSliderChange = (event) => {
    setCurrentTimePoint(parseInt(event.target.value, 10));
    setIsPlaying(false);
  };

  const handleAggregationChange = (event) => {
    const newAggregation = event.target.value;
    setAggregation(newAggregation);
    setCurrentTimePoint(newAggregation === 'hourly' ? 0 : 1);
    setIsPlaying(false);
  };

  const handleZoneClick = (zoneId) => {
    return zoneId;
  };

  useEffect(() => {
    const loadDailyData = async () => {
      setLoading(true);
      setStatus({ message: 'Fetching daily data...', error: false });

      try {
        const data = await fetchDailyData(selectedDate);
        setDailyData(data);

        const spData = data.settlement_period.reduce((acc, item) => {
          if (!acc[item.settlement_period]) acc[item.settlement_period] = {};
          acc[item.settlement_period][item.gsp_group_id] = item;
          return acc;
        }, {});
        setProcessedSpData(spData);

        const hrData = data.hourly.reduce((acc, item) => {
          if (!acc[item.hour]) acc[item.hour] = {};
          acc[item.hour][item.gsp_group_id] = item;
          return acc;
        }, {});
        setProcessedHrData(hrData);

        setStatus({ message: '', error: false });
      } catch (error) {
        console.error('Error fetching daily imbalance data:', error);
        setStatus({
          message: `Error fetching daily data: ${error.message}`,
          error: true,
        });
        setDailyData({
          day_type: 'N',
          settlement_period: [],
          hourly: [],
          daily: [],
          coverage_summary: null,
        });
        setProcessedSpData({});
        setProcessedHrData({});
      } finally {
        setLoading(false);
      }
    };

    loadDailyData();
  }, [selectedDate]);

  useEffect(() => {
    let zoneDataForPeriod = {};
    let dataForInfoPanel = null;

    if (aggregation === '30min' && processedSpData[currentTimePoint]) {
      dataForInfoPanel = processedSpData[currentTimePoint];
    } else if (aggregation === 'hourly' && processedHrData[currentTimePoint]) {
      dataForInfoPanel = processedHrData[currentTimePoint];
    } else if (aggregation === 'daily' && dailyData.daily) {
      dataForInfoPanel = dailyData.daily.reduce((acc, item) => {
        acc[item.gsp_group_id] = item;
        return acc;
      }, {});
    }

    if (dataForInfoPanel) {
      zoneDataForPeriod = Object.entries(dataForInfoPanel).reduce((acc, [gsp, data]) => {
        acc[gsp] = data;
        return acc;
      }, {});
    }

    setCurrentZoneData(zoneDataForPeriod);
  }, [currentTimePoint, aggregation, processedSpData, processedHrData, dailyData.daily]);

  const getSliderConfig = () => {
    const { day_type } = dailyData;

    switch (aggregation) {
      case 'hourly':
        return {
          label: 'Hour',
          min: 0,
          max: 23,
          disabled: false,
        };
      case 'daily':
        return {
          label: 'Daily total',
          min: 1,
          max: 1,
          disabled: true,
        };
      case '30min':
      default: {
        let max = 48;
        if (day_type === 'L') max = 50;
        if (day_type === 'S') max = 46;
        return {
          label: 'Settlement Period',
          min: 1,
          max,
          disabled: false,
        };
      }
    }
  };

  const sliderConfig = getSliderConfig();

  useEffect(() => {
    if (!isPlaying || sliderConfig.disabled) {
      return;
    }

    const intervalId = setInterval(() => {
      setCurrentTimePoint(prevTimePoint => {
        if (prevTimePoint >= sliderConfig.max) {
          return sliderConfig.min;
        }
        return prevTimePoint + 1;
      });
    }, 500 / playbackSpeed);

    return () => clearInterval(intervalId);
  }, [isPlaying, playbackSpeed, sliderConfig]);

  const dataForCurrentTimepoint = aggregation === 'daily'
    ? dailyData.daily.reduce((acc, item) => {
        acc[item.gsp_group_id] = item;
        return acc;
      }, {})
    : (aggregation === 'hourly'
        ? processedHrData[currentTimePoint]
        : processedSpData[currentTimePoint]);

  return {
    selectedDate,
    aggregation,
    currentTimePoint,
    dailyData,
    processedSpData,
    processedHrData,
    currentZoneData,
    loading,
    status,
    showNumerics,
    isPlaying,
    playbackSpeed,
    handleDateChange,
    handleSliderChange,
    handleAggregationChange,
    handleZoneClick,
    sliderConfig,
    setIsPlaying,
    setPlaybackSpeed,
    setShowNumerics,
    dataForCurrentTimepoint,
  };
};

const useInterconnectorController = () => {
  const [selectedDate, setSelectedDate] = useState(getTodayDate);
  const [settlementPeriod, setSettlementPeriod] = useState(getCurrentGbSettlementPeriod);
  const [flowData, setFlowData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);

  const handleDateChange = useCallback((name, value) => {
    setSelectedDate(prev => ({ ...prev, [name]: parseInt(value, 10) }));
  }, []);

  const handleSettlementPeriodChange = useCallback((event) => {
    const nextPeriod = parseInt(event.target.value, 10);
    if (!Number.isNaN(nextPeriod)) {
      setSettlementPeriod(nextPeriod);
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshCount(count => count + 1);
  }, []);

  useEffect(() => {
    let active = true;

    const loadInterconnectorFlows = async () => {
      setLoading(true);
      setError('');

      try {
        const data = await fetchInterconnectorFlows({
          date: selectedDate,
          settlementPeriod,
        });

        if (active) {
          setFlowData(data);
        }
      } catch (err) {
        if (active) {
          setError(
            err?.response?.data?.error ||
            err.message ||
            'Unable to load interconnector flows.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadInterconnectorFlows();

    return () => {
      active = false;
    };
  }, [selectedDate, settlementPeriod, refreshCount]);

  useEffect(() => {
    const periods = flowData?.available_periods || [];
    if (!periods.length || settlementPeriod === null || settlementPeriod === undefined) {
      return;
    }

    if (periods.includes(settlementPeriod)) {
      return;
    }

    const minPeriod = Math.min(...periods);
    const maxPeriod = Math.max(...periods);
    setSettlementPeriod(Math.min(Math.max(settlementPeriod, minPeriod), maxPeriod));
  }, [flowData, settlementPeriod]);

  return {
    selectedDate,
    settlementPeriod,
    flowData,
    countries: flowData?.countries || [],
    loading,
    error,
    handleDateChange,
    handleSettlementPeriodChange,
    refresh,
  };
};

const MapInstance = ({
  controller,
  isSplitView,
  interconnectorController,
  selectedInterconnectorCountryKey,
  onInterconnectorSelect,
  onCloseInterconnectorPanel,
}) => {
  const {
    selectedDate,
    aggregation,
    currentTimePoint,
    dailyData,
    currentZoneData,
    loading,
    status,
    showNumerics,
    isPlaying,
    playbackSpeed,
    handleDateChange,
    handleSliderChange,
    handleAggregationChange,
    handleZoneClick,
    sliderConfig,
    setIsPlaying,
    setPlaybackSpeed,
    setShowNumerics,
    dataForCurrentTimepoint,
  } = controller;

  useEffect(() => {
    if (isSplitView) {
      setShowNumerics(false);
    }
  }, [isSplitView, setShowNumerics]);

  const dateLabel = formatDateLabel(selectedDate);
  const timeScope = getTimeScopeDisplay({
    aggregation,
    currentTimePoint,
    sliderConfig,
    dayType: dailyData.day_type,
  });
  const selectedInterconnectorCountry = interconnectorController?.countries.find(
    country => country.country_key === selectedInterconnectorCountryKey
  ) || null;
  const showInterconnectorPanel = !isSplitView && Boolean(selectedInterconnectorCountry);

  const setAggregationValue = (value) => {
    handleAggregationChange({ target: { value } });
  };

  return (
    <ViewContainer>
      <MapSection isSplitView={isSplitView}>
        {loading && <LoadingOverlay>Loading...</LoadingOverlay>}
        {showNumerics && <NumericsPanel data={dataForCurrentTimepoint} />}

        {!isSplitView && (
          <MapGuide>
            <MapGuideTitle>GB Regional Map</MapGuideTitle>
            <MapGuideMeta>{dateLabel} - {timeScope.summary}</MapGuideMeta>
          </MapGuide>
        )}

        <GBMap
          zoneData={currentZoneData}
          onZoneClick={handleZoneClick}
          isSplitView={isSplitView}
          interconnectorCountries={!isSplitView ? interconnectorController?.countries : []}
          selectedInterconnectorCountryKey={selectedInterconnectorCountryKey}
          onInterconnectorClick={!isSplitView ? onInterconnectorSelect : null}
        />
      </MapSection>

      <ControlSection isSplitView={isSplitView}>
        {showInterconnectorPanel ? (
          <InterconnectorInfoPanel
            flowData={interconnectorController.flowData}
            selectedCountry={selectedInterconnectorCountry}
            selectedDate={interconnectorController.selectedDate}
            settlementPeriod={interconnectorController.settlementPeriod}
            loading={interconnectorController.loading}
            error={interconnectorController.error}
            onDateChange={interconnectorController.handleDateChange}
            onSettlementPeriodChange={interconnectorController.handleSettlementPeriodChange}
            onRefresh={interconnectorController.refresh}
            onClose={onCloseInterconnectorPanel}
          />
        ) : (
          <>
            <ControlHeader>
              <HeaderEyebrow>System View</HeaderEyebrow>
              <HeaderTitle>GB Balancing Mechanism</HeaderTitle>
              <HeaderMeta>{dateLabel} - {timeScope.summary}</HeaderMeta>
            </ControlHeader>

            <ControlGroup>
              <GroupHeader>
                <GroupTitle>Date</GroupTitle>
                <GroupSubtitle>Settlement date</GroupSubtitle>
              </GroupHeader>

              <TopControlsContainer>
                <DateSelector
                  selectedDate={selectedDate}
                  onDateChange={handleDateChange}
                />

                {!isSplitView && (
                  <Button
                    $variant="secondary"
                    onClick={() => setShowNumerics(!showNumerics)}
                    title="Toggle regional volume panel"
                  >
                    {showNumerics ? 'Hide Regional Volumes' : 'Regional Volumes'}
                  </Button>
                )}
              </TopControlsContainer>
            </ControlGroup>

            {(loading || status.error) && (
              <StatusMessage error={status.error}>
                {status.message}
              </StatusMessage>
            )}

            <ControlGroup>
              <GroupHeader>
                <GroupTitle>Time Scope</GroupTitle>
                <GroupSubtitle>{timeScope.summary}</GroupSubtitle>
              </GroupHeader>

              <SettlementPeriodSlider
                label={timeScope.sliderLabel || sliderConfig.label}
                min={sliderConfig.min}
                max={sliderConfig.max}
                disabled={sliderConfig.disabled}
                currentSettlementPeriod={currentTimePoint}
                handleSliderChange={handleSliderChange}
                valueLabel={timeScope.valueLabel}
                valueMeta={timeScope.valueMeta}
              />
            </ControlGroup>

            <ControlGroup>
              <GroupHeader>
                <GroupTitle>Playback & Aggregation</GroupTitle>
              </GroupHeader>

              <TemporalControls>
                <AggregationSelector aria-label="Temporal aggregation">
                  {AGGREGATION_OPTIONS.map(option => (
                    <SegmentButton
                      key={option.value}
                      type="button"
                      $active={aggregation === option.value}
                      onClick={() => setAggregationValue(option.value)}
                    >
                      {option.label}
                    </SegmentButton>
                  ))}
                </AggregationSelector>

                <PlaybackControls>
                  <Button
                    onClick={() => setIsPlaying(true)}
                    disabled={isPlaying || sliderConfig.disabled}
                  >
                    Play
                  </Button>

                  <Button
                    onClick={() => setIsPlaying(false)}
                    disabled={!isPlaying}
                  >
                    Pause
                  </Button>

                  <InlineField>
                    Speed
                    <SelectInput
                      value={playbackSpeed}
                      onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    >
                      <option value={1}>1x</option>
                      <option value={2}>2x</option>
                      <option value={4}>4x</option>
                    </SelectInput>
                  </InlineField>
                </PlaybackControls>
              </TemporalControls>
            </ControlGroup>

            <DataCoveragePanel coverageSummary={dailyData.coverage_summary} />

            <InfoPanel
              data={dataForCurrentTimepoint}
              dailyData={dailyData.settlement_period}
              currentTimePoint={currentTimePoint}
              contextLabel={`${dateLabel} - ${timeScope.summary}`}
            />
          </>
        )}
      </ControlSection>
    </ViewContainer>
  );
};

const MapView = ({ initialDate }) => {
  const [isSplit, setIsSplit] = useState(false);
  const [drilldownZone, setDrilldownZone] = useState(null);
  const [selectedInterconnectorCountryKey, setSelectedInterconnectorCountryKey] = useState(null);
  const [zoneNodes, setZoneNodes] = useState([]);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [nodeError, setNodeError] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeLayer, setNodeLayer] = useState('nms');
  const [nodeMeta, setNodeMeta] = useState({
    excludedMissingCoordinateCount: 0,
  });

  const controller = useMapViewController(initialDate);
  const interconnectorController = useInterconnectorController();

  const loadDrilldownNodes = async (zoneId, layer) => {
    setNodeLoading(true);
    setNodeError('');
    setSelectedNode(null);
    setZoneNodes([]);
    setNodeMeta({ excludedMissingCoordinateCount: 0 });

    try {
      const data = await fetchNodesByZone(zoneId, layer);
      setZoneNodes(Array.isArray(data?.nodes) ? data.nodes : []);
      setNodeMeta({
        excludedMissingCoordinateCount: Number(data?.excluded_missing_coordinate_count || 0),
      });
    } catch (error) {
      console.error('drilldown error:', error);
      setZoneNodes([]);
      setNodeError(
        error?.response?.data?.error ||
        error.message ||
        'Failed to load node data.'
      );
    } finally {
      setNodeLoading(false);
    }
  };

  const handleCloseDrilldown = () => {
    setIsSplit(false);
    setDrilldownZone(null);
    setZoneNodes([]);
    setSelectedNode(null);
    setNodeError('');
    setNodeMeta({ excludedMissingCoordinateCount: 0 });
  };

  const handleZoneDrilldown = async (zoneId) => {
    const zoneInfo = GB_ZONES.find(z => z.id === zoneId) || null;

    setSelectedInterconnectorCountryKey(null);
    setDrilldownZone(zoneInfo);
    setIsSplit(true);
    await loadDrilldownNodes(zoneId, nodeLayer);
  };

  const handleInterconnectorSelect = (countryKey) => {
    setSelectedInterconnectorCountryKey(countryKey);
  };

  const handleNodeLayerChange = async (nextLayer) => {
    if (nextLayer === nodeLayer) {
      return;
    }

    setNodeLayer(nextLayer);

    if (drilldownZone?.id) {
      await loadDrilldownNodes(drilldownZone.id, nextLayer);
    }
  };

  const controllerWithDrilldown = {
    ...controller,
    handleZoneClick: handleZoneDrilldown,
  };
  const drilldownTimeScope = getTimeScopeDisplay({
    aggregation: controller.aggregation,
    currentTimePoint: controller.currentTimePoint,
    sliderConfig: controller.sliderConfig,
    dayType: controller.dailyData.day_type,
  });

  return (
    <SplitViewContainer>
      <MapInstance
        controller={controllerWithDrilldown}
        isSplitView={isSplit}
        interconnectorController={interconnectorController}
        selectedInterconnectorCountryKey={selectedInterconnectorCountryKey}
        onInterconnectorSelect={handleInterconnectorSelect}
        onCloseInterconnectorPanel={() => setSelectedInterconnectorCountryKey(null)}
      />

      {isSplit && (
        <NodeDrilldownPane
          zone={drilldownZone?.id}
          zoneName={drilldownZone?.name}
          zoneData={controller.currentZoneData}
          loading={nodeLoading}
          error={nodeError}
          nodes={zoneNodes}
          nodeLayer={nodeLayer}
          onNodeLayerChange={handleNodeLayerChange}
          excludedMissingCoordinateCount={nodeMeta.excludedMissingCoordinateCount}
          selectedNode={selectedNode}
          onNodeSelect={setSelectedNode}
          onClearSelectedNode={() => setSelectedNode(null)}
          onClose={handleCloseDrilldown}
          selectedDate={controller.selectedDate}
          onDateChange={controller.handleDateChange}
          sliderLabel={drilldownTimeScope.sliderLabel || controller.sliderConfig.label}
          sliderValueLabel={drilldownTimeScope.valueLabel}
          sliderValueMeta={drilldownTimeScope.valueMeta}
          sliderMin={controller.sliderConfig.min}
          sliderMax={controller.sliderConfig.max}
          sliderDisabled={controller.sliderConfig.disabled}
          currentSettlementPeriod={controller.currentTimePoint}
          onSettlementPeriodChange={controller.handleSliderChange}
          aggregation={controller.aggregation}
        />
      )}
    </SplitViewContainer>
  );
};

export default MapView;
