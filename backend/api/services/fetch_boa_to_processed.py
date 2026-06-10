from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import pandas as pd
import requests
from zoneinfo import ZoneInfo

from .data_processor import DataProcessor


# ---------------------------------------------------------------------
# Elexon API sources
# ---------------------------------------------------------------------

# Direct settlement-period acceptance volume source.
# Correct BidOffer path values are: "bid" and "offer".
BASE_URL_BOAV = "https://data.elexon.co.uk/bmrs/api/v1/balancing/settlement/acceptance/volumes/all"

# Acceptance-level BOALF-style source.
# In this revised pipeline it is no longer used to reconstruct volume.
# It is used to recover soFlag/system_operator_flag because BOAV does not return soFlag.
BASE_URL_ACCEPTANCES = "https://data.elexon.co.uk/bmrs/api/v1/balancing/acceptances/all"

# Acceptance stack with bid/offer prices per acceptance.
BASE_URL_PRICE = "https://data.elexon.co.uk/bmrs/api/v1/balancing/settlement/acceptances/all"

LONDON_TZ = ZoneInfo("Europe/London")
UTC_TZ = ZoneInfo("UTC")

EPS = 1e-9


# ---------------------------------------------------------------------
# Date and scalar helpers
# ---------------------------------------------------------------------
def parse_mixed_dates_to_iso(series: pd.Series) -> pd.Series:
    """
    Normalise mixed date formats to YYYY-MM-DD.

    First parse strict ISO format YYYY-MM-DD.
    Only rows that fail ISO parsing fall back to dayfirst=True.

    This avoids misreading ISO dates such as:
      2025-01-08
    as:
      2025-08-01
    """
    parsed = pd.to_datetime(series, errors="coerce", format="%Y-%m-%d")

    missing_mask = parsed.isna()
    if missing_mask.any():
        parsed.loc[missing_mask] = pd.to_datetime(
            series.loc[missing_mask],
            errors="coerce",
            dayfirst=True,
        )

    return parsed.dt.strftime("%Y-%m-%d")


def _safe_float(value: Any, default: float = 0.0) -> float:
    numeric = pd.to_numeric(value, errors="coerce")
    if pd.isna(numeric):
        return default
    return float(numeric)


def _normalise_start_time_to_london(value: Any) -> Optional[str]:
    """
    Convert BOAV startTime into Europe/London local string for settlement_pe_start_time.
    """
    if value is None or pd.isna(value):
        return None

    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(LONDON_TZ)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(value)


# ---------------------------------------------------------------------
# Generic request helper
# ---------------------------------------------------------------------
def _request_json(
    url: str,
    *,
    params: Optional[dict] = None,
    max_retries: int = 5,
    empty_on_400: bool = False,
) -> dict:
    """
    Generic GET with retry/backoff for JSON endpoints.

    empty_on_400 is useful for settlement periods that are invalid for a normal day
    when max_sp=50 is used. For those cases, the fetch should continue with no rows.
    """
    backoff = 0.8

    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=30)
        except requests.RequestException as e:
            if attempt == max_retries:
                raise RuntimeError(f"Request failed for {url}: {e}") from e
            time.sleep(backoff)
            backoff *= 2
            continue

        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError as e:
                raise RuntimeError(f"Invalid JSON returned from {url}") from e

        if resp.status_code == 400 and empty_on_400:
            print(f"[WARN] Treating HTTP 400 as empty data for {url}: {resp.text[:200]}")
            return {"data": []}

        if resp.status_code in (429, 500, 502, 503, 504):
            if attempt == max_retries:
                raise RuntimeError(
                    f"API failed after retries for {url}. "
                    f"HTTP {resp.status_code}: {resp.text[:300]}"
                )
            time.sleep(backoff)
            backoff *= 2
            continue

        raise RuntimeError(
            f"API returned HTTP {resp.status_code} for {url}: {resp.text[:300]}"
        )

    return {}


# ---------------------------------------------------------------------
# Fetch functions
# ---------------------------------------------------------------------
def fetch_sp_boav_data(
    settlement_date: str,
    settlement_period: int,
    bid_offer: str,
    max_retries: int = 5,
) -> List[Dict[str, Any]]:
    """
    Fetch settlement-period acceptance volume from BOAV.

    bid_offer must be:
      - "bid"
      - "offer"

    Endpoint:
      /balancing/settlement/acceptance/volumes/all/{bidOffer}/{date}/{sp}

    Returned rows already include totalVolumeAccepted for the settlement period.
    """
    if bid_offer not in ("bid", "offer"):
        raise ValueError("bid_offer must be either 'bid' or 'offer'.")

    url = f"{BASE_URL_BOAV}/{bid_offer}/{settlement_date}/{settlement_period}"
    payload = _request_json(
        url,
        params={"format": "json"},
        max_retries=max_retries,
        empty_on_400=True,
    )

    rows = payload.get("data", [])
    for row in rows:
        row["_requested_sp"] = settlement_period
        row["_bid_offer_side"] = bid_offer

    return rows


def fetch_sp_acceptance_flag_data(
    settlement_date: str,
    settlement_period: int,
    max_retries: int = 5,
) -> List[Dict[str, Any]]:
    """
    Fetch BOALF-style acceptance rows for soFlag.

    This source is no longer used for volume reconstruction. It is kept because
    BOAV does not return soFlag, while core_data still needs system_volume and
    energy_volume.
    """
    params = {
        "settlementDate": settlement_date,
        "settlementPeriod": settlement_period,
        "format": "json",
    }

    payload = _request_json(
        BASE_URL_ACCEPTANCES,
        params=params,
        max_retries=max_retries,
        empty_on_400=True,
    )

    rows = payload.get("data", [])
    for row in rows:
        row["_requested_sp"] = settlement_period

    return rows


def fetch_sp_price_data(
    settlement_date: str,
    settlement_period: int,
    max_retries: int = 5,
) -> List[Dict[str, Any]]:
    """
    Fetch one settlement period from Elexon acceptance stack endpoint.

    This endpoint returns:
      acceptanceNumber
      bidPrice
      offerPrice
      bidOfferPairId
    """
    url = f"{BASE_URL_PRICE}/{settlement_date}/{settlement_period}"

    payload = _request_json(
        url,
        params={"format": "json"},
        max_retries=max_retries,
        empty_on_400=True,
    )

    return payload.get("data", [])


def fetch_sp_bundle(
    settlement_date: str,
    settlement_period: int,
) -> Tuple[int, List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Fetch BOAV volume, acceptance flags, and prices for one settlement period.

    Safe to run concurrently across different SPs.
    """
    print(f"[INFO] Fetching {settlement_date} SP{settlement_period} BOAV bid rows ...")
    boav_bid_rows = fetch_sp_boav_data(settlement_date, settlement_period, "bid")

    print(f"[INFO] Fetching {settlement_date} SP{settlement_period} BOAV offer rows ...")
    boav_offer_rows = fetch_sp_boav_data(settlement_date, settlement_period, "offer")

    print(f"[INFO] Fetching {settlement_date} SP{settlement_period} acceptance flag rows ...")
    flag_rows = fetch_sp_acceptance_flag_data(settlement_date, settlement_period)

    print(f"[INFO] Fetching {settlement_date} SP{settlement_period} price-side rows ...")
    price_rows = fetch_sp_price_data(settlement_date, settlement_period)

    boav_rows = boav_bid_rows + boav_offer_rows

    return settlement_period, boav_rows, flag_rows, price_rows


# ---------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------
def load_bmu_mapping(mapping_file: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Load mapping file and prepare:
      1) bm_unit -> mapping
      2) national_grid_bm_unit -> mapping
    """
    if not mapping_file.exists():
        raise FileNotFoundError(f"Mapping file not found: {mapping_file}")

    mapping = pd.read_csv(mapping_file, low_memory=False)

    required_cols = ["bm_unit", "national_grid_bm_unit", "gsp_group_id", "bmu_fuel_type"]
    missing = [c for c in required_cols if c not in mapping.columns]
    if missing:
        raise ValueError(f"Mapping file missing required columns: {missing}")

    for col in required_cols:
        mapping[col] = mapping[col].astype(str).str.strip()
        mapping[col] = mapping[col].replace({"nan": pd.NA, "None": pd.NA, "": pd.NA})

    by_bmu = mapping.dropna(subset=["bm_unit"]).drop_duplicates(subset=["bm_unit"]).copy()

    by_ng = (
        mapping.dropna(subset=["national_grid_bm_unit"])
        .drop_duplicates(subset=["national_grid_bm_unit"])
        .copy()
    )

    return by_bmu, by_ng


# ---------------------------------------------------------------------
# Build processed-style rows from BOAV
# ---------------------------------------------------------------------
def _flatten_pair_volumes(pair_volumes: Any) -> dict:
    """
    Flatten BOAV pairVolumes into processed CSV style columns.

    BOAV can return:
      pairVolumes: {
        negative1, positive1, negative2, positive2, ...
      }

    Historical processed files often contain pair_volumes_negative1 etc.
    """
    result = {}

    if not isinstance(pair_volumes, dict):
        pair_volumes = {}

    for i in range(1, 7):
        result[f"pair_volumes_negative{i}"] = pair_volumes.get(f"negative{i}")
        result[f"pair_volumes_positive{i}"] = pair_volumes.get(f"positive{i}")

    return result


def build_processed_rows_from_boav(
    settlement_date: str,
    all_boav_rows: List[Dict[str, Any]],
) -> pd.DataFrame:
    """
    Build processed-style rows directly from BOAV rows.

    Important:
      - BOAV returns both bid and offer endpoint rows.
      - Each endpoint can include zero-volume rows for the other side.
      - We keep only rows where abs(totalVolumeAccepted) > EPS.
      - This avoids writing pure zero-volume records into processed CSV.
    """
    records: List[Dict[str, Any]] = []

    for row in all_boav_rows:
        try:
            side = row.get("_bid_offer_side")
            total_volume = _safe_float(row.get("totalVolumeAccepted"), default=0.0)

            # Drop pure zero-volume BOAV rows.
            if abs(total_volume) <= EPS:
                continue

            # Sanity filter by endpoint side.
            # bid endpoint should contribute negative volume.
            # offer endpoint should contribute positive volume.
            if side == "bid" and total_volume >= -EPS:
                continue
            if side == "offer" and total_volume <= EPS:
                continue

            pair_cols = _flatten_pair_volumes(row.get("pairVolumes"))

            record = {
                "created_date_time": row.get("createdDateTime"),
                "settlement_date": row.get("settlementDate") or settlement_date,
                "settlement_period": row.get("settlementPeriod") or row.get("_requested_sp"),
                "settlement_pe_start_time": _normalise_start_time_to_london(row.get("startTime")),
                "start_time": row.get("startTime"),
                "bm_unit": row.get("bmUnit"),
                "bm_unit_type": row.get("bmUnitType"),
                "lead_party_name": row.get("leadPartyName"),
                "national_grid_bm_unit": row.get("nationalGridBmUnit"),
                "acceptance_id": row.get("acceptanceId"),
                "acceptance_duration": row.get("acceptanceDuration"),
                "total_volume_accepted": total_volume,
                "bid_offer_side": side,
                "gsp_group_id": None,
                "system_operator_flag": 0,
                "bmu_fuel_type": None,
                "accepted_price": None,
                "balancing_cost": 0.0,
            }

            record.update(pair_cols)
            records.append(record)

        except Exception as e:
            print(f"[WARN] Failed to parse BOAV row: {e}")
            continue

    df = pd.DataFrame(records)

    if df.empty:
        return df

    # Normalize key fields
    df["settlement_date"] = parse_mixed_dates_to_iso(df["settlement_date"])

    df["settlement_period"] = pd.to_numeric(
        df["settlement_period"],
        errors="coerce",
    ).astype("Int64")

    df["acceptance_id"] = pd.to_numeric(
        df["acceptance_id"],
        errors="coerce",
    )

    for col in ["bm_unit", "national_grid_bm_unit", "bid_offer_side"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df[col] = df[col].replace({"nan": pd.NA, "None": pd.NA, "": pd.NA})

    df["total_volume_accepted"] = pd.to_numeric(
        df["total_volume_accepted"],
        errors="coerce",
    ).fillna(0.0)

    # Deduplicate exact BOAV duplicates.
    dedup_cols = [
        "settlement_date",
        "settlement_period",
        "bm_unit",
        "national_grid_bm_unit",
        "acceptance_id",
        "bid_offer_side",
        "total_volume_accepted",
    ]
    dedup_cols = [col for col in dedup_cols if col in df.columns]

    df = df.drop_duplicates(subset=dedup_cols).reset_index(drop=True)

    return df


# ---------------------------------------------------------------------
# soFlag enrichment
# ---------------------------------------------------------------------
def build_flag_rows(
    settlement_date: str,
    all_flag_rows: List[Dict[str, Any]],
) -> pd.DataFrame:
    """
    Build a compact table for system_operator_flag from acceptances/all rows.
    """
    records: List[Dict[str, Any]] = []

    for row in all_flag_rows:
        try:
            record = {
                "settlement_date": row.get("settlementDate") or settlement_date,
                "settlement_period": row.get("_requested_sp"),
                "bm_unit": row.get("bmUnit"),
                "national_grid_bm_unit": row.get("nationalGridBmUnit"),
                "acceptance_id": row.get("acceptanceNumber"),
                "system_operator_flag": 1 if bool(row.get("soFlag", False)) else 0,
            }
            records.append(record)

        except Exception as e:
            print(f"[WARN] Failed to parse acceptance flag row: {e}")
            continue

    df = pd.DataFrame(records)

    if df.empty:
        return df

    df["settlement_date"] = parse_mixed_dates_to_iso(df["settlement_date"])

    df["settlement_period"] = pd.to_numeric(df["settlement_period"], errors="coerce")
    df["acceptance_id"] = pd.to_numeric(df["acceptance_id"], errors="coerce")

    for col in ["bm_unit", "national_grid_bm_unit"]:
        df[col] = df[col].astype(str).str.strip()
        df[col] = df[col].replace({"nan": pd.NA, "None": pd.NA, "": pd.NA})

    df["system_operator_flag"] = pd.to_numeric(
        df["system_operator_flag"],
        errors="coerce",
    ).fillna(0).astype(int)

    # If the same acceptance appears multiple times, treat any True soFlag as True.
    df = (
        df.groupby(
            [
                "settlement_date",
                "settlement_period",
                "bm_unit",
                "acceptance_id",
            ],
            dropna=False,
        )
        .agg(system_operator_flag=("system_operator_flag", "max"))
        .reset_index()
    )

    return df


def enrich_with_system_operator_flag(
    processed_df: pd.DataFrame,
    flag_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Merge soFlag/system_operator_flag into BOAV-derived processed rows.
    """
    if processed_df.empty:
        return processed_df

    df = processed_df.copy()

    if flag_df.empty:
        print("[WARN] No acceptance flag rows returned; system_operator_flag defaults to 0.")
        df["system_operator_flag"] = 0
        return df

    # Normalize join key types
    df["settlement_date"] = df["settlement_date"].astype(str).str.strip()
    df["bm_unit"] = df["bm_unit"].astype(str).str.strip()
    df["acceptance_id"] = pd.to_numeric(df["acceptance_id"], errors="coerce")
    df["settlement_period"] = pd.to_numeric(df["settlement_period"], errors="coerce")

    flag_df = flag_df.copy()
    flag_df["settlement_date"] = flag_df["settlement_date"].astype(str).str.strip()
    flag_df["bm_unit"] = flag_df["bm_unit"].astype(str).str.strip()
    flag_df["acceptance_id"] = pd.to_numeric(flag_df["acceptance_id"], errors="coerce")
    flag_df["settlement_period"] = pd.to_numeric(flag_df["settlement_period"], errors="coerce")

    merged = df.merge(
        flag_df[
            [
                "settlement_date",
                "settlement_period",
                "bm_unit",
                "acceptance_id",
                "system_operator_flag",
            ]
        ],
        on=[
            "settlement_date",
            "settlement_period",
            "bm_unit",
            "acceptance_id",
        ],
        how="left",
        suffixes=("", "_flag"),
        validate="many_to_one",
    )

    if "system_operator_flag_flag" in merged.columns:
        merged["system_operator_flag"] = merged["system_operator_flag_flag"].combine_first(
            merged.get("system_operator_flag")
        )
        merged = merged.drop(columns=["system_operator_flag_flag"])

    merged["system_operator_flag"] = pd.to_numeric(
        merged["system_operator_flag"],
        errors="coerce",
    ).fillna(0).astype(int)

    matched = len(merged)
    print(f"[INFO] System-operator flag enrichment completed for {matched}/{len(merged)} rows.")

    return merged


# ---------------------------------------------------------------------
# Price enrichment
# ---------------------------------------------------------------------
def build_price_rows(
    settlement_date: str,
    all_sp_price_rows: List[Dict[str, Any]],
) -> pd.DataFrame:
    """
    Build a compact acceptance-price table from the acceptance stack endpoint.

    We keep both bidPrice and offerPrice, then later choose accepted_price using:
      - positive volume -> offerPrice
      - negative volume -> bidPrice
    """
    records: List[Dict[str, Any]] = []

    for row in all_sp_price_rows:
        try:
            record = {
                "settlement_date": row.get("settlementDate") or settlement_date,
                "settlement_period": row.get("settlementPeriod"),
                "bm_unit": row.get("bmUnit"),
                "national_grid_bm_unit": row.get("nationalGridBmUnit"),
                "acceptance_id": row.get("acceptanceNumber"),
                "bid_price": pd.to_numeric(row.get("bidPrice"), errors="coerce"),
                "offer_price": pd.to_numeric(row.get("offerPrice"), errors="coerce"),
                "bid_offer_pair_id": row.get("bidOfferPairId"),
                "acceptance_time_price_side": row.get("acceptanceTime"),
            }
            records.append(record)

        except Exception as e:
            print(f"[WARN] Failed to parse price row: {e}")
            continue

    df = pd.DataFrame(records)

    if df.empty:
        return df

    df["settlement_date"] = parse_mixed_dates_to_iso(df["settlement_date"])

    for col in ["settlement_period", "acceptance_id", "bid_offer_pair_id"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    for col in ["bm_unit", "national_grid_bm_unit"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df[col] = df[col].replace({"nan": pd.NA, "None": pd.NA, "": pd.NA})

    # Keep one row per acceptance key.
    # Some endpoints may return multiple pair rows; current processed rows are not
    # pair-expanded, so we choose a stable representative row.
    if "bid_offer_pair_id" in df.columns:
        pair_id_num = pd.to_numeric(df["bid_offer_pair_id"], errors="coerce")
        df["_pair_id_rank"] = pair_id_num.fillna(-999999)
    else:
        df["_pair_id_rank"] = -999999

    df = df.sort_values(
        by=[
            "settlement_date",
            "settlement_period",
            "bm_unit",
            "acceptance_id",
            "_pair_id_rank",
        ],
        ascending=[True, True, True, True, False],
    )

    df = df.drop_duplicates(
        subset=[
            "settlement_date",
            "settlement_period",
            "bm_unit",
            "acceptance_id",
        ],
        keep="first",
    ).reset_index(drop=True)

    df = df.drop(columns=["_pair_id_rank"], errors="ignore")

    return df


def enrich_with_prices(processed_df: pd.DataFrame, price_df: pd.DataFrame) -> pd.DataFrame:
    """
    Merge acceptance prices into processed rows and calculate:
      accepted_price
      balancing_cost = total_volume_accepted * accepted_price

    Join keys:
      settlement_date, settlement_period, bm_unit, acceptance_id

    Cost rule:
      - positive volume -> offerPrice
      - negative volume -> bidPrice
      - zero volume -> None
    """
    if processed_df.empty:
        return processed_df

    if price_df.empty:
        print("[WARN] No price rows returned; accepted_price remains null and balancing_cost remains 0.")
        return processed_df

    df = processed_df.copy()

    # Normalize join key types
    df["settlement_date"] = df["settlement_date"].astype(str).str.strip()
    df["bm_unit"] = df["bm_unit"].astype(str).str.strip()
    df["acceptance_id"] = pd.to_numeric(df["acceptance_id"], errors="coerce")
    df["settlement_period"] = pd.to_numeric(df["settlement_period"], errors="coerce")

    price_df = price_df.copy()
    price_df["settlement_date"] = price_df["settlement_date"].astype(str).str.strip()
    price_df["bm_unit"] = price_df["bm_unit"].astype(str).str.strip()
    price_df["acceptance_id"] = pd.to_numeric(price_df["acceptance_id"], errors="coerce")
    price_df["settlement_period"] = pd.to_numeric(price_df["settlement_period"], errors="coerce")

    merged = df.merge(
        price_df[
            [
                "settlement_date",
                "settlement_period",
                "bm_unit",
                "acceptance_id",
                "bid_price",
                "offer_price",
                "bid_offer_pair_id",
                "acceptance_time_price_side",
            ]
        ],
        on=[
            "settlement_date",
            "settlement_period",
            "bm_unit",
            "acceptance_id",
        ],
        how="left",
        validate="many_to_one",
    )

    total_volume = pd.to_numeric(
        merged["total_volume_accepted"],
        errors="coerce",
    ).fillna(0.0)

    merged["accepted_price"] = None

    positive_mask = total_volume > 0
    negative_mask = total_volume < 0

    merged.loc[positive_mask, "accepted_price"] = merged.loc[positive_mask, "offer_price"]
    merged.loc[negative_mask, "accepted_price"] = merged.loc[negative_mask, "bid_price"]

    merged["accepted_price"] = pd.to_numeric(merged["accepted_price"], errors="coerce")

    merged["balancing_cost"] = (
        total_volume * merged["accepted_price"].fillna(0.0)
    )

    matched = merged["accepted_price"].notna().sum()
    total = len(merged)
    print(f"[INFO] Price enrichment matched {matched}/{total} processed rows.")

    missing_prices = total - matched
    if missing_prices > 0:
        print(f"[WARN] {missing_prices} rows did not match a price record; their balancing_cost stays 0.")

    # Drop helper columns not needed in processed schema.
    merged = merged.drop(
        columns=[
            "bid_price",
            "offer_price",
            "bid_offer_pair_id",
            "acceptance_time_price_side",
        ],
        errors="ignore",
    )

    return merged


# ---------------------------------------------------------------------
# Mapping and persistence
# ---------------------------------------------------------------------
def apply_mapping(
    df: pd.DataFrame,
    mapping_by_bmu: pd.DataFrame,
    mapping_by_ng: pd.DataFrame,
) -> pd.DataFrame:
    """
    Fill gsp_group_id and bmu_fuel_type by:
      1) bm_unit
      2) fallback to national_grid_bm_unit
    """
    if df.empty:
        return df

    df = df.copy()

    for col in ["bm_unit", "national_grid_bm_unit"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df[col] = df[col].replace({"nan": pd.NA, "None": pd.NA, "": pd.NA})

    df = df.merge(
        mapping_by_bmu[["bm_unit", "gsp_group_id", "bmu_fuel_type"]],
        on="bm_unit",
        how="left",
        suffixes=("", "_map_bmu"),
    )

    df["gsp_group_id"] = df["gsp_group_id"].fillna(df["gsp_group_id_map_bmu"])
    df["bmu_fuel_type"] = df["bmu_fuel_type"].fillna(df["bmu_fuel_type_map_bmu"])

    drop_cols = [c for c in ["gsp_group_id_map_bmu", "bmu_fuel_type_map_bmu"] if c in df.columns]
    df = df.drop(columns=drop_cols)

    unresolved_mask = df["gsp_group_id"].isna()

    if unresolved_mask.any():
        unresolved = df.loc[unresolved_mask].copy()

        unresolved = unresolved.merge(
            mapping_by_ng[
                [
                    "national_grid_bm_unit",
                    "gsp_group_id",
                    "bmu_fuel_type",
                ]
            ],
            on="national_grid_bm_unit",
            how="left",
            suffixes=("", "_map_ng"),
        )

        df.loc[unresolved_mask, "gsp_group_id"] = unresolved["gsp_group_id_map_ng"].values
        df.loc[unresolved_mask, "bmu_fuel_type"] = unresolved["bmu_fuel_type_map_ng"].values

    for col in ["gsp_group_id_map_ng", "bmu_fuel_type_map_ng"]:
        if col in df.columns:
            df = df.drop(columns=[col])

    return df


def append_or_create_processed(df: pd.DataFrame, output_file: Path) -> None:
    """
    Append new day rows to yearly processed CSV.
    If file exists, remove existing rows of the same settlement_date first, then append.
    """
    if df.empty:
        raise RuntimeError("No processed rows were built from API data.")

    df = df.copy()
    df["settlement_date"] = parse_mixed_dates_to_iso(df["settlement_date"])
    settlement_date = df["settlement_date"].iloc[0]

    if output_file.exists():
        existing = pd.read_csv(output_file, low_memory=False)

        # Normalize existing dates defensively.
        if "settlement_date" in existing.columns:
            existing["settlement_date"] = parse_mixed_dates_to_iso(existing["settlement_date"])

        existing = existing[existing["settlement_date"] != settlement_date]
        combined = pd.concat([existing, df], ignore_index=True, sort=False)
    else:
        combined = df.copy()

    combined["settlement_date"] = parse_mixed_dates_to_iso(combined["settlement_date"])

    combined.to_csv(output_file, index=False)
    print(f"[INFO] Processed file saved: {output_file}")


def rebuild_core_for_year(data_dir: Path, year: int) -> None:
    """
    Rebuild core_data_{year}.csv from the updated yearly processed CSV.
    """
    core_file = data_dir / "core" / f"core_data_{year}.csv"

    if core_file.exists():
        core_file.unlink()
        print(f"[INFO] Removed existing core file: {core_file}")

    dp = DataProcessor(data_dir=str(data_dir))
    dp.create_core_data(year)

    if core_file.exists():
        print(f"[INFO] Rebuilt core file: {core_file}")
    else:
        raise RuntimeError(f"Core rebuild failed, file not found: {core_file}")


# ---------------------------------------------------------------------
# Main fetch pipeline
# ---------------------------------------------------------------------
def fetch_date_to_processed(
    settlement_date: str,
    max_sp: int = 50,
    sleep_ms: int = 250,  # kept for CLI compatibility; not used in concurrent mode
    max_workers: int = 8,
) -> tuple[Path, Path]:
    """
    Fetch one date from Elexon, write/update yearly processed CSV, and rebuild yearly core CSV.

    Revised volume source:
      BOAV:
        /balancing/settlement/acceptance/volumes/all/bid/{date}/{sp}
        /balancing/settlement/acceptance/volumes/all/offer/{date}/{sp}

      BOAV returns settlement-period totalVolumeAccepted directly.
      This replaces the previous time/level overlap approximation.

    Other sources:
      acceptances/all:
        used only to enrich system_operator_flag from soFlag.

      balancing/settlement/acceptances/all/{date}/{sp}:
        used to enrich bidPrice / offerPrice and calculate balancing_cost.

    Returns:
      (processed_file_path, core_file_path)
    """
    try:
        date_obj = datetime.strptime(settlement_date, "%Y-%m-%d")
    except ValueError:
        raise ValueError("settlement_date must be in YYYY-MM-DD format.")

    today_london = datetime.now(LONDON_TZ).date()

    if date_obj.date() > today_london:
        raise ValueError(
            f"Cannot fetch BOA data for future date {settlement_date}. "
            f"Today's date in Europe/London is {today_london.isoformat()}."
        )

    year = date_obj.year

    backend_dir = Path(__file__).resolve().parent.parent.parent
    data_dir = backend_dir / "data"
    mapping_file = data_dir / "bmu_mapping.csv"
    output_file = data_dir / f"{year}boadf_processed.csv"
    core_file = data_dir / "core" / f"core_data_{year}.csv"

    print(f"[DEBUG] __file__ = {__file__}")
    print(f"[DEBUG] backend_dir = {backend_dir}")
    print(f"[DEBUG] data_dir = {data_dir}")
    print(f"[DEBUG] mapping_file = {mapping_file}")
    print(f"[INFO] Concurrent fetch enabled with max_workers={max_workers}")
    print("[INFO] Volume source: BOAV direct settlement-period accepted volume")

    mapping_by_bmu, mapping_by_ng = load_bmu_mapping(mapping_file)

    all_boav_rows: List[Dict[str, Any]] = []
    all_flag_rows: List[Dict[str, Any]] = []
    all_price_rows: List[Dict[str, Any]] = []

    futures = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for sp in range(1, max_sp + 1):
            future = executor.submit(fetch_sp_bundle, settlement_date, sp)
            futures[future] = sp

        for future in as_completed(futures):
            sp = futures[future]

            try:
                _, boav_rows, flag_rows, price_rows = future.result()

                all_boav_rows.extend(boav_rows)
                all_flag_rows.extend(flag_rows)
                all_price_rows.extend(price_rows)

                non_zero_boav = sum(
                    1
                    for row in boav_rows
                    if abs(_safe_float(row.get("totalVolumeAccepted"), default=0.0)) > EPS
                )

                print(
                    f"[INFO] Finished SP{sp}: "
                    f"{len(boav_rows)} BOAV rows "
                    f"({non_zero_boav} non-zero), "
                    f"{len(flag_rows)} flag rows, "
                    f"{len(price_rows)} price rows."
                )

            except Exception as e:
                raise RuntimeError(
                    f"Failed while fetching settlement period {sp} for {settlement_date}: {e}"
                ) from e

    if not all_boav_rows:
        raise RuntimeError(f"No BOAV data returned for {settlement_date}")

    processed_df = build_processed_rows_from_boav(settlement_date, all_boav_rows)

    if processed_df.empty:
        raise RuntimeError(
            f"BOAV returned rows for {settlement_date}, but all rows had zero or invalid volume."
        )

    flag_df = build_flag_rows(settlement_date, all_flag_rows)
    price_df = build_price_rows(settlement_date, all_price_rows)

    processed_df = enrich_with_system_operator_flag(processed_df, flag_df)
    processed_df = enrich_with_prices(processed_df, price_df)
    processed_df = apply_mapping(processed_df, mapping_by_bmu, mapping_by_ng)

    before = len(processed_df)
    processed_df = processed_df.dropna(subset=["gsp_group_id"]).copy()
    after = len(processed_df)

    print(f"[INFO] Rows before mapping filter: {before}")
    print(f"[INFO] Rows after mapping filter:  {after}")

    if processed_df.empty:
        raise RuntimeError("All rows were dropped after mapping. No gsp_group_id matched.")

    append_or_create_processed(processed_df, output_file)
    rebuild_core_for_year(data_dir, year)

    print("\n[INFO] Done.")
    print(f"[INFO] Updated processed: {output_file}")
    print(f"[INFO] Updated core: {core_file}")

    return output_file, core_file


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Elexon BOAV acceptance-volume data for a date and build/update yearly processed + core CSV."
    )

    parser.add_argument(
        "date",
        help="Settlement date in YYYY-MM-DD format, e.g. 2026-02-26",
    )

    parser.add_argument(
        "--max-sp",
        type=int,
        default=50,
        help="Max settlement period to query (default: 50)",
    )

    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=250,
        help="Retained for compatibility; ignored in concurrent mode.",
    )

    parser.add_argument(
        "--max-workers",
        type=int,
        default=8,
        help="Number of concurrent workers for SP requests (default: 8)",
    )

    args = parser.parse_args()

    fetch_date_to_processed(
        settlement_date=args.date,
        max_sp=args.max_sp,
        sleep_ms=args.sleep_ms,
        max_workers=args.max_workers,
    )


if __name__ == "__main__":
    main()