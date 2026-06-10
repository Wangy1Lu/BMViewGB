import React, { useState, useEffect, useRef } from 'react';
import styled from '@emotion/styled';

const SliderContainer = styled.div`
  width: 100%;
`;

const SliderHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
`;

const SliderTitleBlock = styled.div`
  min-width: 0;
`;

const SliderLabelText = styled.div`
  color: #536174;
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
`;

const SliderValueBadge = styled.div`
  margin-top: 4px;
  color: #102033;
  font-size: 1.12rem;
  font-weight: 850;
`;

const SliderMeta = styled.div`
  margin-top: 3px;
  color: #637083;
  font-size: 0.84rem;
`;

const SliderWrapper = styled.div`
  position: relative;
  height: 48px;
  display: flex;
  align-items: center;
`;

const RangeInput = styled.input`
  width: 100%;
  cursor: pointer;
  height: 7px;
  background: linear-gradient(90deg, #dceaf6, #e8edf3);
  border-radius: 999px;
  outline: none;
  appearance: none;
  z-index: 2;
  position: relative;

  &:disabled {
    background: #e9edf2;
    cursor: not-allowed;
  }

  &::-webkit-slider-thumb {
    appearance: none;
    width: 22px;
    height: 22px;
    background: ${props => props.disabled ? '#adb5bd' : '#0878d8'};
    border-radius: 50%;
    cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
    border: 3px solid #ffffff;
    box-shadow: 0 3px 10px rgba(8, 120, 216, 0.28);
    margin-top: -7px;
  }

  &::-moz-range-thumb {
    width: 22px;
    height: 22px;
    background: ${props => props.disabled ? '#adb5bd' : '#0878d8'};
    border-radius: 50%;
    cursor: ${props => props.disabled ? 'not-allowed' : 'pointer'};
    border: 3px solid #ffffff;
    box-shadow: 0 3px 10px rgba(8, 120, 216, 0.28);
  }
`;

const TicksContainer = styled.div`
  position: absolute;
  top: 26px;
  left: 11px;
  right: 11px;
  height: 15px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
  z-index: 1;
`;

const Tick = styled.span`
  position: relative;
  display: flex;
  justify-content: center;
  text-align: center;
  width: 1px;
  height: 5px;
  background-color: #b9c4d0;
  line-height: 20px;
  font-size: 10px;
  color: #536174;

  &::after {
    content: attr(data-label);
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
  }
`;

const ValueInput = styled.input`
  font-weight: 800;
  font-size: 0.98rem;
  color: #102033;
  border: 1px solid #d7e0ea;
  border-radius: 8px;
  padding: 7px 8px;
  width: 58px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);

  &:disabled {
    background-color: #e9ecef;
    color: #6c757d;
  }

  &:focus {
    border-color: #0878d8;
    box-shadow: 0 0 0 3px rgba(8, 120, 216, 0.12);
    outline: none;
  }

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &[type=number] {
    -moz-appearance: textfield;
  }
`;

const SettlementPeriodSlider = ({
  label,
  min,
  max,
  disabled,
  currentSettlementPeriod,
  handleSliderChange,
  valueLabel,
  valueMeta,
  commitOnRelease = false,
}) => {
  const [inputValue, setInputValue] = useState(currentSettlementPeriod);
  const [draftSliderValue, setDraftSliderValue] = useState(currentSettlementPeriod);
  const [isDragging, setIsDragging] = useState(false);
  const dragCommitPendingRef = useRef(false);

  useEffect(() => {
    if (!isDragging) {
      setInputValue(currentSettlementPeriod);
      setDraftSliderValue(currentSettlementPeriod);
    }
  }, [currentSettlementPeriod, isDragging]);

  const clampToRange = (value) => Math.min(Math.max(value, min), max);

  const normalizePeriod = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    return clampToRange(Math.round(numericValue));
  };

  const submitPeriod = (value, options = {}) => {
    const period = normalizePeriod(value);

    if (period === null) {
      setInputValue(currentSettlementPeriod);
      setDraftSliderValue(currentSettlementPeriod);
      return;
    }

    if (options.skipUnchanged && period === Number(currentSettlementPeriod)) {
      setInputValue(period);
      setDraftSliderValue(period);
      return;
    }

    setInputValue(period);
    setDraftSliderValue(period);
    handleSliderChange({ target: { value: String(period) } });
  };

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  const validateAndSubmit = (currentInput) => {
    submitPeriod(currentInput);
  };

  const handleInputBlur = (e) => {
    validateAndSubmit(e.target.value);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      validateAndSubmit(e.target.value);
      e.target.blur();
    }
  };

  const handleRangeChange = (event) => {
    const nextValue = Number(event.target.value);

    if (!Number.isFinite(nextValue)) {
      return;
    }

    if (commitOnRelease) {
      dragCommitPendingRef.current = true;
      setDraftSliderValue(nextValue);
      setInputValue(normalizePeriod(nextValue) ?? currentSettlementPeriod);
      return;
    }

    submitPeriod(nextValue);
  };

  const startDraftDrag = () => {
    if (!commitOnRelease) {
      return;
    }

    dragCommitPendingRef.current = true;
    setIsDragging(true);
  };

  const commitDraftSliderValue = (event) => {
    if (!commitOnRelease || !dragCommitPendingRef.current) {
      return;
    }

    dragCommitPendingRef.current = false;
    setIsDragging(false);
    submitPeriod(event?.currentTarget?.value ?? draftSliderValue, { skipUnchanged: true });
  };

  const range = max - min + 1;
  const periods = Array.from({ length: range }, (_, i) => i + min);

  let tickInterval;
  if (range <= 24) tickInterval = 3;
  else if (range <= 50) tickInterval = 6;
  else tickInterval = 10;

  const showTickLabel = (period) =>
    period === min || period === max || (period - min) % tickInterval === 0;

  const showInput = !disabled || max > min;
  const displayedPeriod = normalizePeriod(draftSliderValue) || currentSettlementPeriod;
  const sliderValue = commitOnRelease ? draftSliderValue : currentSettlementPeriod;
  const displayedValueLabel = commitOnRelease
    ? `SP ${displayedPeriod}`
    : (valueLabel || currentSettlementPeriod);

  return (
    <SliderContainer>
      <SliderHeader>
        <SliderTitleBlock>
          <SliderLabelText>{label}</SliderLabelText>
          <SliderValueBadge>{displayedValueLabel}</SliderValueBadge>
          {valueMeta && <SliderMeta>{valueMeta}</SliderMeta>}
        </SliderTitleBlock>

        {showInput && (
          <ValueInput
            type="number"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            min={min}
            max={max}
            disabled={disabled}
            aria-label={label}
          />
        )}
      </SliderHeader>

      {max > min && (
        <SliderWrapper>
          <RangeInput
            type="range"
            min={min}
            max={max}
            step={commitOnRelease ? 'any' : '1'}
            value={sliderValue}
            onPointerDown={startDraftDrag}
            onPointerUp={commitDraftSliderValue}
            onMouseUp={commitDraftSliderValue}
            onTouchEnd={commitDraftSliderValue}
            onBlur={commitDraftSliderValue}
            onKeyUp={commitDraftSliderValue}
            onChange={handleRangeChange}
            disabled={disabled}
          />
          <TicksContainer>
            {!disabled && periods.map(period => (
              <Tick key={period} data-label={showTickLabel(period) ? period : ''} />
            ))}
          </TicksContainer>
        </SliderWrapper>
      )}
    </SliderContainer>
  );
};

export default SettlementPeriodSlider;
