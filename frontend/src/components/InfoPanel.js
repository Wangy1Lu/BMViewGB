import React, { useMemo, useState } from 'react';
import styled from '@emotion/styled';

const PanelContainer = styled.div`
  padding: 15px;
  background-color: rgba(255, 255, 255, 0.94);
  border-radius: 8px;
  border: 1px solid #dfe8f2;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  border-bottom: 2px solid #0878d8;
  padding-bottom: 8px;
`;

const Title = styled.h3`
  margin: 0;
  color: #102033;
  font-size: 1rem;
  font-weight: 850;
`;

const ContextBadge = styled.div`
  color: #64748b;
  font-size: 0.78rem;
  text-align: right;
  line-height: 1.3;
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 18px;
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
`;

const StatLabel = styled.span`
  font-size: 0.86rem;
  color: #64748b;

  &.clickable {
    cursor: pointer;
    text-decoration: underline;
    color: #0056b3;
    &:hover {
      color: #00aaff;
    }
  }
`;

const StatValue = styled.span`
  font-size: 1.18rem;
  font-weight: 850;
  color: #102033;
`;

const SubStatItem = styled(StatItem)`
  margin-left: 15px;
  margin-top: -5px;
`;

const SectionTitle = styled.div`
  grid-column: 1 / -1;
  font-weight: 850;
  margin-top: 10px;
  margin-bottom: -5px;
  color: #102033;
  border-bottom: 1px solid #dfe8f2;
  padding-bottom: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const CollapsibleSectionTitle = styled.button`
  grid-column: 1 / -1;
  width: 100%;
  margin: 12px 0 0;
  padding: 10px 12px;
  border: 1px solid #d9e6f3;
  border-radius: 8px;
  background: linear-gradient(180deg, #fbfdff 0%, #f5f9fe 100%);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  color: #102033;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font: inherit;
  font-weight: 850;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;

  &:hover {
    border-color: #9bc8ef;
    box-shadow: 0 4px 14px rgba(8, 120, 216, 0.1);
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 3px solid rgba(8, 120, 216, 0.2);
    outline-offset: 2px;
  }
`;

const CollapseIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: #e7f3ff;
  color: #075da0;
  font-size: 1rem;
  font-weight: 900;
  line-height: 1;
`;

const CollapsibleContent = styled.div`
  grid-column: 1 / -1;
  display: contents;
`;

/* ---------- Pretty tooltip ---------- */
const TipWrap = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const InfoIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 1px solid #cfd4da;
  color: #6c757d;
  font-size: 11px;
  line-height: 1;
  user-select: none;
`;

const TipBubble = styled.div`
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  min-width: 300px;
  max-width: 430px;
  padding: 10px 12px;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  color: #2f343a;
  font-size: 0.85rem;
  line-height: 1.35;
  z-index: 9999;
  white-space: normal;
`;

const TipArrow = styled.div`
  position: absolute;
  left: 14px;
  top: -6px;
  width: 10px;
  height: 10px;
  background: white;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  transform: rotate(45deg);
`;

const TipTitle = styled.div`
  font-weight: 700;
  margin-bottom: 6px;
  color: #1f2328;
`;

const TipNote = styled.div`
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #eef1f4;
  color: #5a6169;
`;

const Tooltip = ({ id, activeId, setActiveId, label, title, body, note }) => {
  const isOpen = activeId === id;

  return (
    <TipWrap
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(id)}
      onBlur={() => setActiveId(null)}
      tabIndex={0}
    >
      <span>{label}</span>
      <InfoIcon aria-hidden="true">i</InfoIcon>

      {isOpen && (
        <TipBubble role="tooltip">
          <TipArrow />
          <TipTitle>{title}</TipTitle>
          <div>{body}</div>
          {note ? <TipNote>{note}</TipNote> : null}
        </TipBubble>
      )}
    </TipWrap>
  );
};
/* ------------------------------------------------------------------- */

const InfoPanel = ({ data, dailyData, currentTimePoint, contextLabel }) => {
  const [volumeCollapsed, setVolumeCollapsed] = useState(true);
  const [costCollapsed, setCostCollapsed] = useState(true);
  const [activeTip, setActiveTip] = useState(null);

  const aggregateStats = (currentData) => {
    if (!currentData || Object.keys(currentData).length === 0) {
      return {
        acceptedOffers: 0,
        acceptedBids: 0,
        totalAcceptedInstructions: 0,
        uniqueBoaActions: 0,
        zeroVolumeActions: 0,
        mixedDirectionActions: 0,
        netImbalanceVolume: 0,
        energyActionVolume: 0,
        systemActionVolume: 0,
        balancingCost: 0,
      };
    }

    const stats = Object.values(currentData).reduce(
      (acc, region) => {
        const offers = Number(region.offers_count) || 0;
        const bids = Number(region.bids_count) || 0;
        const boas = Number(region.boas_count) || 0;

        // Prefer backend-calculated TAI under the component-based definition.
        // Fallback to offers + bids for older core_data files.
        const taiRaw = Number(region.total_accepted_instructions);
        const tai = Number.isFinite(taiRaw) ? taiRaw : offers + bids;

        const zeroVolumeActions = Number(region.zero_volume_actions_count) || 0;
        const mixedDirectionActions = Number(region.mixed_direction_actions_count) || 0;

        acc.acceptedOffers += offers;
        acc.acceptedBids += bids;
        acc.totalAcceptedInstructions += tai;
        acc.uniqueBoaActions += boas;
        acc.zeroVolumeActions += zeroVolumeActions;
        acc.mixedDirectionActions += mixedDirectionActions;

        acc.netImbalanceVolume += Number(region.net_volume) || 0;
        acc.energyActionVolume += Number(region.energy_volume) || 0;
        acc.systemActionVolume += Number(region.system_volume) || 0;
        acc.balancingCost += Number(region.balancing_cost) || 0;

        return acc;
      },
      {
        acceptedOffers: 0,
        acceptedBids: 0,
        totalAcceptedInstructions: 0,
        uniqueBoaActions: 0,
        zeroVolumeActions: 0,
        mixedDirectionActions: 0,
        netImbalanceVolume: 0,
        energyActionVolume: 0,
        systemActionVolume: 0,
        balancingCost: 0,
      }
    );

    return stats;
  };

  const keyStats = useMemo(() => aggregateStats(data), [data]);
  const cumulativeCost = useMemo(() => {
    if (!dailyData || !dailyData.length) return 0;

    const cumulative = dailyData
      .filter((item) => item.settlement_period <= currentTimePoint)
      .reduce((total, item) => total + (Number(item.balancing_cost) || 0), 0);

    return cumulative;
  }, [dailyData, currentTimePoint]);

  return (
    <PanelContainer>
      <TitleRow>
        <Title>Key Statistics</Title>
        {contextLabel && <ContextBadge>{contextLabel}</ContextBadge>}
      </TitleRow>

      <StatGrid>
        <SectionTitle>BOA Action Counts</SectionTitle>

        <StatItem>
          <StatLabel>
            <Tooltip
              id="offer-actions"
              activeId={activeTip}
              setActiveId={setActiveTip}
              label="Accepted Offer Actions"
              title="Unique actions with offer-side volume"
              body="Number of unique BOA actions that contain at least one positive accepted-volume component."
              note="Rows are first grouped by settlement period, zone, BMU identity, and acceptance ID. A split action is counted once as an offer action if any grouped component has positive accepted volume."
            />
          </StatLabel>
          <StatValue>{keyStats.acceptedOffers}</StatValue>
        </StatItem>

        <StatItem>
          <StatLabel>
            <Tooltip
              id="bid-actions"
              activeId={activeTip}
              setActiveId={setActiveTip}
              label="Accepted Bid Actions"
              title="Unique actions with bid-side volume"
              body="Number of unique BOA actions that contain at least one negative accepted-volume component."
              note="Rows are first grouped by settlement period, zone, BMU identity, and acceptance ID. A split action is counted once as a bid action if any grouped component has negative accepted volume."
            />
          </StatLabel>
          <StatValue>{keyStats.acceptedBids}</StatValue>
        </StatItem>

        <StatItem style={{ gridColumn: '1 / -1' }}>
          <StatLabel>
            <Tooltip
              id="directional-instructions"
              activeId={activeTip}
              setActiveId={setActiveTip}
              label="Total Accepted Directional Instructions"
              title="Offer-side plus bid-side action count"
              body="Total count of accepted offer-side and bid-side action components after grouping processed rows into unique BOA actions."
              note="Computed as Accepted Offer Actions + Accepted Bid Actions. If one BOA action contains both positive and negative components, it contributes two directional instructions but only one effective unique BOA action."
            />
          </StatLabel>
          <StatValue>{keyStats.totalAcceptedInstructions}</StatValue>
        </StatItem>

        <StatItem style={{ gridColumn: '1 / -1' }}>
          <StatLabel>
            <Tooltip
              id="effective-actions"
              activeId={activeTip}
              setActiveId={setActiveTip}
              label="Effective Unique BOA Actions"
              title="Unique non-zero BOA action count"
              body="Number of unique BOA actions with at least one non-zero accepted-volume component."
              note="Pure zero-volume records are excluded. This metric counts each effective BOA action once, even if it contains both offer-side and bid-side components."
            />
          </StatLabel>
          <StatValue>{keyStats.uniqueBoaActions}</StatValue>
        </StatItem>

        <CollapsibleSectionTitle
          type="button"
          onClick={() => setVolumeCollapsed((collapsed) => !collapsed)}
          aria-expanded={!volumeCollapsed}
        >
          Net Imbalance Volume
          <CollapseIcon>{volumeCollapsed ? '+' : '-'}</CollapseIcon>
        </CollapsibleSectionTitle>

        {!volumeCollapsed && (
          <CollapsibleContent>
            <StatItem>
              <StatLabel>Total</StatLabel>
              <StatValue>{keyStats.netImbalanceVolume.toFixed(2)} MWh</StatValue>
            </StatItem>

            <StatItem></StatItem>

            <SubStatItem>
              <StatLabel>from Energy Actions</StatLabel>
              <StatValue>{keyStats.energyActionVolume.toFixed(2)} MWh</StatValue>
            </SubStatItem>

            <SubStatItem>
              <StatLabel>from System Actions</StatLabel>
              <StatValue>{keyStats.systemActionVolume.toFixed(2)} MWh</StatValue>
            </SubStatItem>
          </CollapsibleContent>
        )}

        <CollapsibleSectionTitle
          type="button"
          onClick={() => setCostCollapsed((collapsed) => !collapsed)}
          aria-expanded={!costCollapsed}
        >
          Balancing Cost
          <CollapseIcon>{costCollapsed ? '+' : '-'}</CollapseIcon>
        </CollapsibleSectionTitle>

        {!costCollapsed && (
          <CollapsibleContent>
            <StatItem>
              <StatLabel>Period Cost</StatLabel>
              <StatValue>
                {`GBP ${keyStats.balancingCost.toLocaleString('en-GB', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
              </StatValue>
            </StatItem>

            <StatItem>
              <StatLabel>Cumulative Daily Cost</StatLabel>
              <StatValue>
                {`GBP ${cumulativeCost.toLocaleString('en-GB', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
              </StatValue>
            </StatItem>
          </CollapsibleContent>
        )}

      </StatGrid>
    </PanelContainer>
  );
};

export default InfoPanel;
