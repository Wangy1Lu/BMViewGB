from django.http import JsonResponse
from datetime import datetime
from zoneinfo import ZoneInfo
from .services.data_processor import DataProcessor
from .services.asset_benchmark import AssetBenchmark
from .services.interconnector_flows import (
    InterconnectorDataError,
    fetch_interconnector_flows_snapshot,
)
import pandas as pd
import numpy as np
import os

from .services.fetch_boa_to_processed import fetch_date_to_processed

data_processor = DataProcessor()

NODE_CAPABILITY_FILE = "node_view_capability_from_direct_bridge_validated.csv"
NODE_BMU_MAPPING_FILE = "direct_connected_bmu_to_lookup_gnode_validated.csv"
NMS_NODE_BMU_MAPPING_FILE = "nms_node_bmu_mapping.csv"
NMS_NODE_COORDINATE_ENRICHMENT_FILE = "nms_node_coordinate_enrichment.csv"
NODE_MAPPING_COVERAGE_CACHE = {}


def _daily_data_has_rows(data):
    if not data:
        return False
    if not isinstance(data, dict):
        return False
    return bool(data.get("settlement_period"))


def _normalize_gnode_id(value):
    if pd.isna(value):
        return ""
    try:
        f = float(value)
        if f.is_integer():
            return str(int(f))
    except Exception:
        pass
    return str(value).strip()


def _parse_mixed_settlement_dates(series):
    parsed = pd.to_datetime(series, errors='coerce', format='%Y-%m-%d')
    missing_mask = parsed.isna()
    if missing_mask.any():
        parsed.loc[missing_mask] = pd.to_datetime(
            series.loc[missing_mask],
            errors='coerce',
            dayfirst=True
        )
    return parsed.dt.strftime('%Y-%m-%d')


def _normalise_id_series(series):
    raw = series.copy()
    result = raw.astype(str).str.strip()

    numeric = pd.to_numeric(raw, errors='coerce')
    numeric_mask = numeric.notna()

    result.loc[numeric_mask] = numeric.loc[numeric_mask].apply(
        lambda x: str(int(x)) if float(x).is_integer() else str(x)
    )

    result = result.replace({'nan': pd.NA, 'None': pd.NA, '': pd.NA})
    return result


def _normalise_text_series(series):
    result = series.astype(str).str.strip()
    result = result.replace({'nan': pd.NA, 'None': pd.NA, '': pd.NA})
    return result


def _sum_mix_dicts(dict_series):
    totals = {}
    for item in dict_series:
        if isinstance(item, dict):
            for k, v in item.items():
                try:
                    totals[k] = totals.get(k, 0.0) + float(v)
                except Exception:
                    continue
    return totals


def _file_mtime_or_none(path):
    return os.path.getmtime(path) if os.path.exists(path) else None


def _safe_rate(numerator, denominator):
    denominator = float(denominator or 0)
    if denominator <= 0:
        return 0.0
    return float(numerator) / denominator * 100.0


def _clean_bmu_id_set(series):
    return set(
        series
        .dropna()
        .astype(str)
        .str.strip()
        .replace({'nan': pd.NA, 'None': pd.NA, '': pd.NA})
        .dropna()
        .tolist()
    )


def _build_coverage_metric_row(mapping_key, label, mapped_bmus, year_df):
    mapped_bmus = set(mapped_bmus or [])
    bmu_series = year_df['bmu_id']
    volume_series = year_df['accepted_mwh']

    seen_bmus = set(bmu_series.dropna().unique())
    mapped_seen = seen_bmus & mapped_bmus
    mapped_mask = bmu_series.isin(mapped_bmus)

    offer_volume = volume_series.clip(lower=0.0)
    bid_volume = -volume_series.clip(upper=0.0)

    total_offer_mwh = float(offer_volume.sum())
    mapped_offer_mwh = float(offer_volume.loc[mapped_mask].sum())
    total_bid_mwh = float(bid_volume.sum())
    mapped_bid_mwh = float(bid_volume.loc[mapped_mask].sum())

    total_bmus_seen = len(seen_bmus)
    mapped_bmus_seen = len(mapped_seen)
    unmapped_bmus_seen = max(total_bmus_seen - mapped_bmus_seen, 0)

    unmapped_offer_mwh = max(total_offer_mwh - mapped_offer_mwh, 0.0)
    unmapped_bid_mwh = max(total_bid_mwh - mapped_bid_mwh, 0.0)

    bmu_missing_rate_pct = _safe_rate(unmapped_bmus_seen, total_bmus_seen)
    offer_missing_rate_pct = _safe_rate(unmapped_offer_mwh, total_offer_mwh)
    bid_missing_rate_pct = _safe_rate(unmapped_bid_mwh, total_bid_mwh)

    return {
        'mapping': mapping_key,
        'label': label,
        'total_bmus_seen': int(total_bmus_seen),
        'mapped_bmus_seen': int(mapped_bmus_seen),
        'unmapped_bmus_seen': int(unmapped_bmus_seen),
        'bmu_coverage_rate_pct': 100.0 - bmu_missing_rate_pct,
        'bmu_missing_rate_pct': bmu_missing_rate_pct,
        'total_offer_mwh': total_offer_mwh,
        'mapped_offer_mwh': mapped_offer_mwh,
        'unmapped_offer_mwh': unmapped_offer_mwh,
        'offer_coverage_rate_pct': 100.0 - offer_missing_rate_pct,
        'offer_missing_rate_pct': offer_missing_rate_pct,
        'total_bid_mwh': total_bid_mwh,
        'mapped_bid_mwh': mapped_bid_mwh,
        'unmapped_bid_mwh': unmapped_bid_mwh,
        'bid_coverage_rate_pct': 100.0 - bid_missing_rate_pct,
        'bid_missing_rate_pct': bid_missing_rate_pct,
    }


def _new_coverage_accumulator(mapped_bmus):
    return {
        'mapped_bmus': set(mapped_bmus or []),
        'seen_bmus': set(),
        'mapped_bmus_seen': set(),
        'total_offer_mwh': 0.0,
        'mapped_offer_mwh': 0.0,
        'total_bid_mwh': 0.0,
        'mapped_bid_mwh': 0.0,
    }


def _update_coverage_accumulator(accumulator, bmu_series, volume_series):
    seen_bmus = set(bmu_series.dropna().unique())
    mapped_bmus = accumulator['mapped_bmus']
    mapped_mask = bmu_series.isin(mapped_bmus)

    offer_volume = volume_series.clip(lower=0.0)
    bid_volume = -volume_series.clip(upper=0.0)

    accumulator['seen_bmus'].update(seen_bmus)
    accumulator['mapped_bmus_seen'].update(seen_bmus & mapped_bmus)
    accumulator['total_offer_mwh'] += float(offer_volume.sum())
    accumulator['mapped_offer_mwh'] += float(offer_volume.loc[mapped_mask].sum())
    accumulator['total_bid_mwh'] += float(bid_volume.sum())
    accumulator['mapped_bid_mwh'] += float(bid_volume.loc[mapped_mask].sum())


def _coverage_metric_row_from_accumulator(mapping_key, label, accumulator):
    total_bmus_seen = len(accumulator['seen_bmus'])
    mapped_bmus_seen = len(accumulator['mapped_bmus_seen'])
    unmapped_bmus_seen = max(total_bmus_seen - mapped_bmus_seen, 0)

    total_offer_mwh = accumulator['total_offer_mwh']
    mapped_offer_mwh = accumulator['mapped_offer_mwh']
    total_bid_mwh = accumulator['total_bid_mwh']
    mapped_bid_mwh = accumulator['mapped_bid_mwh']

    unmapped_offer_mwh = max(total_offer_mwh - mapped_offer_mwh, 0.0)
    unmapped_bid_mwh = max(total_bid_mwh - mapped_bid_mwh, 0.0)

    bmu_missing_rate_pct = _safe_rate(unmapped_bmus_seen, total_bmus_seen)
    offer_missing_rate_pct = _safe_rate(unmapped_offer_mwh, total_offer_mwh)
    bid_missing_rate_pct = _safe_rate(unmapped_bid_mwh, total_bid_mwh)

    return {
        'mapping': mapping_key,
        'label': label,
        'total_bmus_seen': int(total_bmus_seen),
        'mapped_bmus_seen': int(mapped_bmus_seen),
        'unmapped_bmus_seen': int(unmapped_bmus_seen),
        'bmu_coverage_rate_pct': 100.0 - bmu_missing_rate_pct,
        'bmu_missing_rate_pct': bmu_missing_rate_pct,
        'total_offer_mwh': total_offer_mwh,
        'mapped_offer_mwh': mapped_offer_mwh,
        'unmapped_offer_mwh': unmapped_offer_mwh,
        'offer_coverage_rate_pct': 100.0 - offer_missing_rate_pct,
        'offer_missing_rate_pct': offer_missing_rate_pct,
        'total_bid_mwh': total_bid_mwh,
        'mapped_bid_mwh': mapped_bid_mwh,
        'unmapped_bid_mwh': unmapped_bid_mwh,
        'bid_coverage_rate_pct': 100.0 - bid_missing_rate_pct,
        'bid_missing_rate_pct': bid_missing_rate_pct,
    }


def _get_node_mapping_coverage_summary(year):
    processed_file = os.path.join(data_processor.processed_dir, f'{year}boadf_processed.csv')
    nms_mapping_file = os.path.join(data_processor.data_dir, NMS_NODE_BMU_MAPPING_FILE)
    nms_enrichment_file = os.path.join(data_processor.data_dir, NMS_NODE_COORDINATE_ENRICHMENT_FILE)
    gnode_mapping_file = os.path.join(data_processor.data_dir, NODE_BMU_MAPPING_FILE)

    if not os.path.exists(processed_file):
        return None

    cache_key = (
        year,
        _file_mtime_or_none(processed_file),
        _file_mtime_or_none(nms_mapping_file),
        _file_mtime_or_none(nms_enrichment_file),
        _file_mtime_or_none(gnode_mapping_file),
    )

    cached = NODE_MAPPING_COVERAGE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    header = pd.read_csv(processed_file, nrows=0)
    required_cols = ['settlement_date', 'bm_unit', 'total_volume_accepted']
    missing_cols = [col for col in required_cols if col not in header.columns]
    if missing_cols:
        return None

    nms_mapping_df = _load_nms_node_bmu_mapping_df()
    if nms_mapping_df is None:
        nms_mapping_df = pd.DataFrame(columns=['direct_connected_bmu_id'])

    nms_visible_df = nms_mapping_df.copy()
    if not nms_visible_df.empty:
        has_coordinates = (
            nms_visible_df['nms_node_lat'].notna() &
            nms_visible_df['nms_node_lon'].notna()
        )
        nms_visible_df = nms_visible_df[has_coordinates]

    gnode_mapping_df = _load_node_bmu_mapping_df()
    if gnode_mapping_df is None:
        gnode_mapping_df = pd.DataFrame(columns=['direct_connected_bmu_id'])

    coverage_accumulators = {
        'nms_visible': _new_coverage_accumulator(
            _clean_bmu_id_set(nms_visible_df['direct_connected_bmu_id'])
        ),
        'gnode_validated': _new_coverage_accumulator(
            _clean_bmu_id_set(gnode_mapping_df['direct_connected_bmu_id'])
        ),
    }

    date_min = None
    date_max = None

    for chunk in pd.read_csv(
        processed_file,
        usecols=required_cols,
        chunksize=200_000,
        low_memory=False,
    ):
        if chunk.empty:
            continue

        settlement_dates = _parse_mixed_settlement_dates(chunk['settlement_date'])
        bmu_series = _normalise_text_series(chunk['bm_unit'])
        volume_series = pd.to_numeric(
            chunk['total_volume_accepted'],
            errors='coerce'
        ).fillna(0.0)

        valid_mask = settlement_dates.notna() & bmu_series.notna()
        if not valid_mask.any():
            continue

        valid_dates = settlement_dates.loc[valid_mask]
        chunk_date_min = valid_dates.min()
        chunk_date_max = valid_dates.max()
        date_min = chunk_date_min if date_min is None else min(date_min, chunk_date_min)
        date_max = chunk_date_max if date_max is None else max(date_max, chunk_date_max)

        valid_bmus = bmu_series.loc[valid_mask]
        valid_volumes = volume_series.loc[valid_mask]

        for accumulator in coverage_accumulators.values():
            _update_coverage_accumulator(accumulator, valid_bmus, valid_volumes)

    if date_min is None or date_max is None:
        return None

    mapping_rows = [
        _coverage_metric_row_from_accumulator(
            'nms_visible',
            'NMS node mapping',
            coverage_accumulators['nms_visible'],
        ),
        _coverage_metric_row_from_accumulator(
            'gnode_validated',
            'GNode direct mapping',
            coverage_accumulators['gnode_validated'],
        ),
    ]

    result = {
        'year': int(year),
        'date_min': str(date_min),
        'date_max': str(date_max),
        'basis': 'Annual coverage against BMUs present in the local processed BOA dataset after GSP mapping.',
        'denominator_source': f'{year}boadf_processed.csv',
        'volume_basis': 'Accepted offer MWh uses positive total_volume_accepted; accepted bid MWh uses absolute negative total_volume_accepted.',
        'mapping_sources': {
            'nms_visible': NMS_NODE_BMU_MAPPING_FILE,
            'gnode_validated': NODE_BMU_MAPPING_FILE,
        },
        'rows': mapping_rows,
    }

    NODE_MAPPING_COVERAGE_CACHE.clear()
    NODE_MAPPING_COVERAGE_CACHE[cache_key] = result
    return result


def _load_node_capability_df():
    capability_path = os.path.join(data_processor.data_dir, NODE_CAPABILITY_FILE)
    if not os.path.exists(capability_path):
        return None

    cap_df = pd.read_csv(capability_path)

    expected_cols = [
        'gnode_id',
        'has_direct_bmu_mapping',
        'direct_bmu_count',
        'direct_bmu_list',
        'node_view_mode',
    ]

    for col in expected_cols:
        if col not in cap_df.columns:
            raise ValueError(f"Capability file missing required column: {col}")

    cap_df = cap_df.copy()
    cap_df['gnode_id'] = cap_df['gnode_id'].apply(_normalize_gnode_id)
    cap_df['has_direct_bmu_mapping'] = cap_df['has_direct_bmu_mapping'].astype(str).str.lower().isin([
        'true', '1', 'yes'
    ])
    cap_df['direct_bmu_count'] = pd.to_numeric(cap_df['direct_bmu_count'], errors='coerce').fillna(0).astype(int)
    cap_df['direct_bmu_list'] = cap_df['direct_bmu_list'].fillna('').astype(str)
    cap_df['node_view_mode'] = cap_df['node_view_mode'].fillna('spatial_only').astype(str)

    return cap_df


def _load_node_bmu_mapping_df():
    mapping_path = os.path.join(data_processor.data_dir, NODE_BMU_MAPPING_FILE)
    if not os.path.exists(mapping_path):
        return None

    df = pd.read_csv(mapping_path)

    expected_cols = [
        'direct_connected_bmu_id',
        'gnode_id',
        'gnode_name',
        'gsp_id',
        'gsp_name',
        'region_name',
        'pes_name',
        'nms_node_id',
    ]

    for col in expected_cols:
        if col not in df.columns:
            raise ValueError(f"Node BMU mapping file missing required column: {col}")

    df = df.copy()
    df['gnode_id'] = df['gnode_id'].apply(_normalize_gnode_id)
    df['direct_connected_bmu_id'] = df['direct_connected_bmu_id'].astype(str).str.strip()
    df['pes_name'] = df['pes_name'].astype(str).str.strip()

    return df


def _load_nms_coordinate_enrichment_df():
    enrichment_path = os.path.join(
        data_processor.data_dir,
        NMS_NODE_COORDINATE_ENRICHMENT_FILE,
    )
    if not os.path.exists(enrichment_path):
        return None

    df = pd.read_csv(enrichment_path)

    expected_cols = [
        'nms_node_id',
        'nms_node_lat',
        'nms_node_lon',
        'coordinate_source',
        'coordinate_method',
        'coordinate_confidence',
    ]

    for col in expected_cols:
        if col not in df.columns:
            raise ValueError(f"NMS coordinate enrichment file missing required column: {col}")

    df = df.copy()
    df['nms_node_id'] = df['nms_node_id'].astype(str).str.strip()
    df['nms_node_lat'] = pd.to_numeric(df['nms_node_lat'], errors='coerce')
    df['nms_node_lon'] = pd.to_numeric(df['nms_node_lon'], errors='coerce')

    for col in [
        'coordinate_source',
        'coordinate_method',
        'coordinate_confidence',
        'coordinate_notes',
        'source_url',
    ]:
        if col not in df.columns:
            df[col] = ''
        df[col] = df[col].fillna('').astype(str).str.strip()

    return df.drop_duplicates(subset=['nms_node_id'])


def _apply_nms_coordinate_enrichment(df):
    df = df.copy()

    for col in [
        'coordinate_source',
        'coordinate_method',
        'coordinate_confidence',
        'coordinate_notes',
        'coordinate_source_url',
    ]:
        if col not in df.columns:
            df[col] = ''

    df['coordinate_enriched'] = False

    enrichment_df = _load_nms_coordinate_enrichment_df()
    if enrichment_df is None or enrichment_df.empty:
        has_coordinate = df['nms_node_lat'].notna() & df['nms_node_lon'].notna()
        df.loc[has_coordinate & (df['coordinate_method'] == ''), 'coordinate_method'] = 'etys_exact_node_match'
        df.loc[has_coordinate & (df['coordinate_confidence'] == ''), 'coordinate_confidence'] = 'high'
        return df

    enriched = enrichment_df.rename(columns={
        'nms_node_id': 'enriched_nms_node_id',
        'nms_node_lat': 'enriched_nms_node_lat',
        'nms_node_lon': 'enriched_nms_node_lon',
        'coordinate_source': 'enriched_coordinate_source',
        'coordinate_method': 'enriched_coordinate_method',
        'coordinate_confidence': 'enriched_coordinate_confidence',
        'coordinate_notes': 'enriched_coordinate_notes',
        'source_url': 'enriched_source_url',
    })

    merged = df.merge(
        enriched,
        left_on='nms_node_id',
        right_on='enriched_nms_node_id',
        how='left',
    )

    missing_coordinate = merged['nms_node_lat'].isna() | merged['nms_node_lon'].isna()
    enrichment_available = (
        merged['enriched_nms_node_lat'].notna() &
        merged['enriched_nms_node_lon'].notna()
    )
    fill_mask = missing_coordinate & enrichment_available

    merged.loc[fill_mask, 'nms_node_lat'] = merged.loc[fill_mask, 'enriched_nms_node_lat']
    merged.loc[fill_mask, 'nms_node_lon'] = merged.loc[fill_mask, 'enriched_nms_node_lon']
    merged.loc[fill_mask, 'coordinate_source'] = merged.loc[fill_mask, 'enriched_coordinate_source']
    merged.loc[fill_mask, 'coordinate_method'] = merged.loc[fill_mask, 'enriched_coordinate_method']
    merged.loc[fill_mask, 'coordinate_confidence'] = merged.loc[fill_mask, 'enriched_coordinate_confidence']
    merged.loc[fill_mask, 'coordinate_notes'] = merged.loc[fill_mask, 'enriched_coordinate_notes']
    merged.loc[fill_mask, 'coordinate_source_url'] = merged.loc[fill_mask, 'enriched_source_url']
    merged.loc[fill_mask, 'coordinate_enriched'] = True

    has_coordinate = merged['nms_node_lat'].notna() & merged['nms_node_lon'].notna()
    merged.loc[
        has_coordinate & (merged['coordinate_source'].fillna('').astype(str).str.strip() == ''),
        'coordinate_source'
    ] = 'ETYS_2024_buses.name'
    merged.loc[
        has_coordinate & (merged['coordinate_method'].fillna('').astype(str).str.strip() == ''),
        'coordinate_method'
    ] = 'etys_exact_node_match'
    merged.loc[
        has_coordinate & (merged['coordinate_confidence'].fillna('').astype(str).str.strip() == ''),
        'coordinate_confidence'
    ] = 'high'

    return merged.drop(columns=[
        col
        for col in merged.columns
        if col.startswith('enriched_')
    ])


def _load_nms_node_bmu_mapping_df():
    mapping_path = os.path.join(data_processor.data_dir, NMS_NODE_BMU_MAPPING_FILE)
    if not os.path.exists(mapping_path):
        return None

    df = pd.read_csv(mapping_path)

    expected_cols = [
        'nms_node_id',
        'nms_node_name',
        'nms_node_lat',
        'nms_node_lon',
        'pes_name',
        'direct_connected_bmu_id',
        'metered_volume_percent',
    ]

    for col in expected_cols:
        if col not in df.columns:
            raise ValueError(f"NMS node BMU mapping file missing required column: {col}")

    df = df.copy()
    df['nms_node_id'] = df['nms_node_id'].astype(str).str.strip()
    df['nms_node_name'] = df['nms_node_name'].fillna('').astype(str).str.strip()
    df['pes_name'] = df['pes_name'].astype(str).str.strip()
    df['direct_connected_bmu_id'] = df['direct_connected_bmu_id'].astype(str).str.strip()
    df['metered_volume_percent'] = pd.to_numeric(
        df['metered_volume_percent'],
        errors='coerce'
    ).fillna(100.0)
    df['nms_node_lat'] = pd.to_numeric(df['nms_node_lat'], errors='coerce')
    df['nms_node_lon'] = pd.to_numeric(df['nms_node_lon'], errors='coerce')

    for optional_col in [
        'zone_number',
        'gsp_group_description',
        'node_view_mode',
        'mapping_basis',
        'coordinate_source',
        'coordinate_method',
        'coordinate_confidence',
        'coordinate_notes',
        'coordinate_source_url',
    ]:
        if optional_col not in df.columns:
            df[optional_col] = ''

    df = _apply_nms_coordinate_enrichment(df)

    return df


def _build_nms_nodes_for_zone(zone):
    mapping_df = _load_nms_node_bmu_mapping_df()
    if mapping_df is None or mapping_df.empty:
        return [], 0

    zone_key = str(zone).strip()
    zone_df = mapping_df[mapping_df['pes_name'] == zone_key].copy()

    if zone_df.empty:
        return [], 0

    has_coordinates = zone_df['nms_node_lat'].notna() & zone_df['nms_node_lon'].notna()
    excluded_missing_coordinate_count = int(zone_df.loc[~has_coordinates, 'nms_node_id'].nunique())
    zone_df = zone_df[has_coordinates].copy()

    if zone_df.empty:
        return [], excluded_missing_coordinate_count

    records = []
    for nms_node_id, group in zone_df.groupby('nms_node_id', sort=True):
        first = group.iloc[0]
        bmu_list = sorted(
            set(
                group['direct_connected_bmu_id']
                .dropna()
                .astype(str)
                .str.strip()
            )
        )
        bmu_list = [
            bmu for bmu in bmu_list
            if bmu and bmu.lower() != 'nan'
        ]

        node_name = first.get('nms_node_name') or nms_node_id
        node_lat = float(first.get('nms_node_lat'))
        node_lon = float(first.get('nms_node_lon'))
        direct_bmu_count = len(bmu_list)
        direct_bmu_list = ', '.join(bmu_list)
        node_view_mode = 'direct_metrics_enabled' if direct_bmu_count > 0 else 'spatial_only'
        zone_number_value = first.get('zone_number')
        pes_id = int(zone_number_value) if pd.notna(zone_number_value) else None
        region_name_value = first.get('gsp_group_description')
        region_name = region_name_value if pd.notna(region_name_value) else None
        mapping_basis_value = first.get('mapping_basis')
        mapping_basis = (
            mapping_basis_value
            if pd.notna(mapping_basis_value) and str(mapping_basis_value).strip()
            else 'official_nms_direct_bmu_to_node'
        )
        coordinate_source_value = first.get('coordinate_source')
        coordinate_source = (
            coordinate_source_value
            if pd.notna(coordinate_source_value) and str(coordinate_source_value).strip()
            else 'ETYS_2024_buses.name'
        )
        coordinate_method_value = first.get('coordinate_method')
        coordinate_method = (
            coordinate_method_value
            if pd.notna(coordinate_method_value) and str(coordinate_method_value).strip()
            else 'etys_exact_node_match'
        )
        coordinate_confidence_value = first.get('coordinate_confidence')
        coordinate_confidence = (
            coordinate_confidence_value
            if pd.notna(coordinate_confidence_value) and str(coordinate_confidence_value).strip()
            else 'high'
        )
        coordinate_notes_value = first.get('coordinate_notes')
        coordinate_notes = (
            coordinate_notes_value
            if pd.notna(coordinate_notes_value) and str(coordinate_notes_value).strip()
            else ''
        )
        coordinate_source_url_value = first.get('coordinate_source_url')
        coordinate_source_url = (
            coordinate_source_url_value
            if pd.notna(coordinate_source_url_value) and str(coordinate_source_url_value).strip()
            else ''
        )
        coordinate_enriched = bool(first.get('coordinate_enriched', False))

        record = {
            'node_type': 'nms_node',
            'node_id': nms_node_id,
            'node_name': node_name,
            'node_lat': node_lat,
            'node_lon': node_lon,
            'nms_node_id': nms_node_id,
            'nms_node_name': node_name,
            'nms_node_lat': node_lat,
            'nms_node_lon': node_lon,
            'gnode_id': nms_node_id,
            'gnode_name': node_name,
            'gnode_lat': node_lat,
            'gnode_lon': node_lon,
            'gsp_id': None,
            'gsp_name': None,
            'dc_id': None,
            'dc_name': None,
            'region_id': None,
            'region_name': region_name,
            'pes_id': pes_id,
            'pes_name': zone_key,
            'has_direct_bmu_mapping': direct_bmu_count > 0,
            'direct_bmu_count': direct_bmu_count,
            'direct_bmu_list': direct_bmu_list,
            'metered_volume_percent_sum': float(
                pd.to_numeric(group['metered_volume_percent'], errors='coerce').fillna(0.0).sum()
            ),
            'node_view_mode': node_view_mode,
            'mapping_basis': mapping_basis,
            'coordinate_source': coordinate_source,
            'coordinate_method': coordinate_method,
            'coordinate_confidence': coordinate_confidence,
            'coordinate_notes': coordinate_notes,
            'coordinate_source_url': coordinate_source_url,
            'coordinate_enriched': coordinate_enriched,
        }
        records.append(record)

    return records, excluded_missing_coordinate_count


def _build_node_capability_from_mapping(zone):
    mapping_df = _load_node_bmu_mapping_df()

    if mapping_df is None or mapping_df.empty:
        return pd.DataFrame(columns=[
            'gnode_id',
            'has_direct_bmu_mapping',
            'direct_bmu_count',
            'direct_bmu_list',
            'node_view_mode',
        ])

    work_df = mapping_df.copy()
    work_df['gnode_id'] = work_df['gnode_id'].apply(_normalize_gnode_id)
    work_df['pes_name'] = work_df['pes_name'].astype(str).str.strip()
    work_df['direct_connected_bmu_id'] = (
        work_df['direct_connected_bmu_id']
        .astype(str)
        .str.strip()
    )

    zone_key = str(zone).strip()

    work_df = work_df[
        (work_df['pes_name'] == zone_key) &
        (work_df['gnode_id'] != '') &
        (work_df['direct_connected_bmu_id'] != '') &
        (work_df['direct_connected_bmu_id'].str.lower() != 'nan')
    ].copy()

    if work_df.empty:
        return pd.DataFrame(columns=[
            'gnode_id',
            'has_direct_bmu_mapping',
            'direct_bmu_count',
            'direct_bmu_list',
            'node_view_mode',
        ])

    capability_df = (
        work_df
        .groupby('gnode_id')['direct_connected_bmu_id']
        .apply(lambda s: sorted(set(s.dropna().astype(str))))
        .reset_index()
    )

    capability_df['has_direct_bmu_mapping'] = capability_df['direct_connected_bmu_id'].apply(
        lambda items: len(items) > 0
    )
    capability_df['direct_bmu_count'] = capability_df['direct_connected_bmu_id'].apply(len)
    capability_df['direct_bmu_list'] = capability_df['direct_connected_bmu_id'].apply(
        lambda items: ', '.join(items)
    )
    capability_df['node_view_mode'] = capability_df['has_direct_bmu_mapping'].apply(
        lambda enabled: 'direct_metrics_enabled' if enabled else 'spatial_only'
    )

    capability_df = capability_df.drop(columns=['direct_connected_bmu_id'])

    return capability_df


def _get_enabled_node_bmu_list(gnode_id, zone):
    mapping_df = _load_node_bmu_mapping_df()
    if mapping_df is None:
        return []

    filtered = mapping_df[
        (mapping_df['gnode_id'] == _normalize_gnode_id(gnode_id)) &
        (mapping_df['pes_name'] == str(zone).strip())
    ].copy()

    if filtered.empty:
        return []

    bmu_list = (
        filtered['direct_connected_bmu_id']
        .dropna()
        .astype(str)
        .str.strip()
    )

    bmu_list = bmu_list[
        (bmu_list != '') &
        (bmu_list.str.lower() != 'nan')
    ]

    return sorted(bmu_list.unique().tolist())


def _get_enabled_nms_node_bmu_mapping(nms_node_id, zone):
    mapping_df = _load_nms_node_bmu_mapping_df()
    if mapping_df is None:
        return pd.DataFrame(columns=['direct_connected_bmu_id', 'metered_volume_percent'])

    node_key = str(nms_node_id).strip()
    zone_key = str(zone).strip()

    filtered = mapping_df[
        (mapping_df['nms_node_id'] == node_key) &
        (mapping_df['pes_name'] == zone_key)
    ].copy()

    if filtered.empty:
        return pd.DataFrame(columns=['direct_connected_bmu_id', 'metered_volume_percent'])

    filtered['direct_connected_bmu_id'] = (
        filtered['direct_connected_bmu_id']
        .dropna()
        .astype(str)
        .str.strip()
    )

    filtered = filtered[
        (filtered['direct_connected_bmu_id'] != '') &
        (filtered['direct_connected_bmu_id'].str.lower() != 'nan')
    ].copy()

    filtered['metered_volume_percent'] = pd.to_numeric(
        filtered['metered_volume_percent'],
        errors='coerce'
    ).fillna(100.0)

    return filtered[['direct_connected_bmu_id', 'metered_volume_percent']]


def _load_processed_year_df(year):
    processed_file = os.path.join(data_processor.processed_dir, f'{year}boadf_processed.csv')
    if not os.path.exists(processed_file):
        return None

    header = pd.read_csv(processed_file, nrows=0)
    available_cols = set(header.columns)

    desired_cols = [
        'settlement_date',
        'settlement_period',
        'bm_unit',
        'national_grid_bm_unit',
        'acceptance_id',
        'total_volume_accepted',
        'system_operator_flag',
        'balancing_cost',
        'bmu_fuel_type',
    ]

    usecols = [col for col in desired_cols if col in available_cols]

    required_cols = [
        'settlement_date',
        'settlement_period',
        'bm_unit',
        'acceptance_id',
        'total_volume_accepted',
    ]

    missing_required = [col for col in required_cols if col not in usecols]
    if missing_required:
        raise ValueError(
            f"Processed file {processed_file} missing required node metric columns: {missing_required}"
        )

    df = pd.read_csv(processed_file, usecols=usecols)
    df = df.copy()

    if 'national_grid_bm_unit' not in df.columns:
        df['national_grid_bm_unit'] = pd.NA
    if 'system_operator_flag' not in df.columns:
        df['system_operator_flag'] = 0
    if 'balancing_cost' not in df.columns:
        df['balancing_cost'] = 0.0
    if 'bmu_fuel_type' not in df.columns:
        df['bmu_fuel_type'] = ''

    df['settlement_date'] = _parse_mixed_settlement_dates(df['settlement_date'])
    df['settlement_period'] = pd.to_numeric(df['settlement_period'], errors='coerce').fillna(0).astype(int)

    df['bm_unit'] = _normalise_text_series(df['bm_unit'])
    df['national_grid_bm_unit'] = _normalise_text_series(df['national_grid_bm_unit'])

    df['acceptance_id'] = pd.to_numeric(df['acceptance_id'], errors='coerce')
    df['total_volume_accepted'] = pd.to_numeric(df['total_volume_accepted'], errors='coerce').fillna(0.0)
    df['system_operator_flag'] = pd.to_numeric(df['system_operator_flag'], errors='coerce').fillna(0).astype(int)
    df['balancing_cost'] = pd.to_numeric(df['balancing_cost'], errors='coerce').fillna(0.0)
    df['bmu_fuel_type'] = df['bmu_fuel_type'].fillna('').astype(str).str.strip()

    return df


def _apply_nms_allocation_weights(node_day_df, bmu_weights):
    if node_day_df.empty or not bmu_weights:
        return node_day_df

    work_df = node_day_df.copy()
    weight_keys = set(bmu_weights.keys())

    bm_unit_match = work_df['bm_unit'].isin(weight_keys)
    national_grid_match = work_df['national_grid_bm_unit'].isin(weight_keys)

    work_df['node_bmu_match_key'] = pd.NA
    work_df.loc[bm_unit_match, 'node_bmu_match_key'] = work_df.loc[bm_unit_match, 'bm_unit']
    work_df.loc[
        (~bm_unit_match) & national_grid_match,
        'node_bmu_match_key'
    ] = work_df.loc[(~bm_unit_match) & national_grid_match, 'national_grid_bm_unit']

    work_df['node_allocation_weight'] = (
        work_df['node_bmu_match_key']
        .map(bmu_weights)
        .fillna(1.0)
        .astype(float)
    )

    work_df['unweighted_total_volume_accepted'] = work_df['total_volume_accepted']
    work_df['unweighted_balancing_cost'] = work_df['balancing_cost']

    work_df['total_volume_accepted'] = (
        work_df['total_volume_accepted'] * work_df['node_allocation_weight']
    )
    work_df['balancing_cost'] = (
        work_df['balancing_cost'] * work_df['node_allocation_weight']
    )

    return work_df


def _build_node_sp_metrics(node_day_df):
    empty_cols = [
        'settlement_period',
        'source_row_count',
        'offers_count',
        'bids_count',
        'boas_count',
        'total_accepted_instructions',
        'zero_volume_actions_count',
        'mixed_direction_actions_count',
        'net_volume',
        'system_volume',
        'energy_volume',
        'balancing_cost',
        'generation_mix',
        'consumption_mix',
    ]

    if node_day_df.empty:
        return pd.DataFrame(columns=empty_cols)

    records = []
    eps = 1e-9

    for settlement_period, sp_df in node_day_df.groupby('settlement_period'):
        sp_df = sp_df.copy()

        sp_df['total_volume_accepted'] = pd.to_numeric(
            sp_df['total_volume_accepted'],
            errors='coerce'
        ).fillna(0.0)

        if 'national_grid_bm_unit' not in sp_df.columns:
            sp_df['national_grid_bm_unit'] = pd.NA

        sp_df['bm_unit_key'] = _normalise_text_series(sp_df['bm_unit'])
        sp_df['national_grid_bm_unit_key'] = _normalise_text_series(sp_df['national_grid_bm_unit'])
        sp_df['bmu_action_key'] = sp_df['bm_unit_key'].combine_first(
            sp_df['national_grid_bm_unit_key']
        )

        sp_df['acceptance_id_key'] = _normalise_id_series(sp_df['acceptance_id'])

        missing_key_mask = (
            sp_df['acceptance_id_key'].isna() |
            sp_df['bmu_action_key'].isna()
        )

        if missing_key_mask.any():
            fallback_suffix = sp_df.loc[missing_key_mask].index.astype(str)

            sp_df.loc[missing_key_mask, 'acceptance_id_key'] = (
                'missing_acceptance_' + fallback_suffix
            )
            sp_df.loc[missing_key_mask, 'bmu_action_key'] = (
                'missing_bmu_' + fallback_suffix
            )

        sp_df['positive_component_volume'] = sp_df['total_volume_accepted'].clip(lower=0.0)
        sp_df['negative_component_volume'] = sp_df['total_volume_accepted'].clip(upper=0.0)
        sp_df['absolute_component_volume'] = sp_df['total_volume_accepted'].abs()

        action_level = (
            sp_df.groupby(
                ['bmu_action_key', 'acceptance_id_key'],
                dropna=False
            )
            .agg(
                acceptance_net_volume=('total_volume_accepted', 'sum'),
                positive_volume=('positive_component_volume', 'sum'),
                negative_volume=('negative_component_volume', 'sum'),
                absolute_volume=('absolute_component_volume', 'sum'),
                source_row_count=('total_volume_accepted', 'size'),
            )
            .reset_index()
        )

        action_level['offer_instruction'] = (
            action_level['positive_volume'] > eps
        ).astype(int)

        action_level['bid_instruction'] = (
            action_level['negative_volume'] < -eps
        ).astype(int)

        action_level['effective_boa_action'] = (
            action_level['absolute_volume'] > eps
        ).astype(int)

        action_level['zero_volume_action'] = (
            action_level['absolute_volume'] <= eps
        ).astype(int)

        action_level['mixed_direction_action'] = (
            (action_level['offer_instruction'] == 1) &
            (action_level['bid_instruction'] == 1)
        ).astype(int)

        offers_count = int(action_level['offer_instruction'].sum())
        bids_count = int(action_level['bid_instruction'].sum())
        boas_count = int(action_level['effective_boa_action'].sum())
        total_accepted_instructions = int(offers_count + bids_count)
        zero_volume_actions_count = int(action_level['zero_volume_action'].sum())
        mixed_direction_actions_count = int(action_level['mixed_direction_action'].sum())

        net_volume = float(sp_df['total_volume_accepted'].sum())
        system_volume = float(
            sp_df.loc[sp_df['system_operator_flag'] == 1, 'total_volume_accepted'].sum()
        )
        energy_volume = float(net_volume - system_volume)
        balancing_cost = float(sp_df['balancing_cost'].sum())

        gen_mix = (
            sp_df.loc[sp_df['total_volume_accepted'] > 0]
            .groupby('bmu_fuel_type')['total_volume_accepted']
            .sum()
            .to_dict()
        )
        con_mix = (
            sp_df.loc[sp_df['total_volume_accepted'] < 0]
            .groupby('bmu_fuel_type')['total_volume_accepted']
            .sum()
            .to_dict()
        )

        records.append({
            'settlement_period': int(settlement_period),
            'source_row_count': int(len(sp_df)),
            'offers_count': offers_count,
            'bids_count': bids_count,
            'boas_count': boas_count,
            'total_accepted_instructions': total_accepted_instructions,
            'zero_volume_actions_count': zero_volume_actions_count,
            'mixed_direction_actions_count': mixed_direction_actions_count,
            'net_volume': net_volume,
            'system_volume': system_volume,
            'energy_volume': energy_volume,
            'balancing_cost': balancing_cost,
            'generation_mix': gen_mix,
            'consumption_mix': con_mix,
        })

    sp_metrics_df = pd.DataFrame(records).sort_values('settlement_period').reset_index(drop=True)
    return sp_metrics_df


def _aggregate_node_metrics(sp_metrics_df, aggregation, time_point=None):
    zero_record = {
        'source_row_count': 0,
        'offers_count': 0,
        'bids_count': 0,
        'boas_count': 0,
        'total_accepted_instructions': 0,
        'zero_volume_actions_count': 0,
        'mixed_direction_actions_count': 0,
        'net_volume': 0.0,
        'system_volume': 0.0,
        'energy_volume': 0.0,
        'balancing_cost': 0.0,
        'generation_mix': {},
        'consumption_mix': {},
    }

    if sp_metrics_df.empty:
        return zero_record

    if aggregation == '30min':
        matched = sp_metrics_df[sp_metrics_df['settlement_period'] == int(time_point)]
        if matched.empty:
            return zero_record

        row = matched.iloc[0].to_dict()
        return {
            'source_row_count': int(row.get('source_row_count', 0)),
            'offers_count': int(row.get('offers_count', 0)),
            'bids_count': int(row.get('bids_count', 0)),
            'boas_count': int(row.get('boas_count', 0)),
            'total_accepted_instructions': int(row.get('total_accepted_instructions', 0)),
            'zero_volume_actions_count': int(row.get('zero_volume_actions_count', 0)),
            'mixed_direction_actions_count': int(row.get('mixed_direction_actions_count', 0)),
            'net_volume': float(row.get('net_volume', 0.0)),
            'system_volume': float(row.get('system_volume', 0.0)),
            'energy_volume': float(row.get('energy_volume', 0.0)),
            'balancing_cost': float(row.get('balancing_cost', 0.0)),
            'generation_mix': row.get('generation_mix') or {},
            'consumption_mix': row.get('consumption_mix') or {},
        }

    work_df = sp_metrics_df.copy()

    if aggregation == 'hourly':
        work_df['hour'] = ((work_df['settlement_period'] - 1) // 2).astype(int)
        work_df = work_df[work_df['hour'] == int(time_point)]
        if work_df.empty:
            return zero_record

    return {
        'source_row_count': int(work_df.get('source_row_count', pd.Series(dtype=float)).sum()),
        'offers_count': int(work_df['offers_count'].sum()),
        'bids_count': int(work_df['bids_count'].sum()),
        'boas_count': int(work_df['boas_count'].sum()),
        'total_accepted_instructions': int(work_df['total_accepted_instructions'].sum()),
        'zero_volume_actions_count': int(work_df['zero_volume_actions_count'].sum()),
        'mixed_direction_actions_count': int(work_df['mixed_direction_actions_count'].sum()),
        'net_volume': float(work_df['net_volume'].sum()),
        'system_volume': float(work_df['system_volume'].sum()),
        'energy_volume': float(work_df['energy_volume'].sum()),
        'balancing_cost': float(work_df['balancing_cost'].sum()),
        'generation_mix': _sum_mix_dicts(work_df['generation_mix']),
        'consumption_mix': _sum_mix_dicts(work_df['consumption_mix']),
    }


def _filter_for_node_aggregation(node_day_df, aggregation, time_point=None):
    if node_day_df.empty:
        return node_day_df.copy()

    work_df = node_day_df.copy()

    if aggregation == '30min':
        return work_df[work_df['settlement_period'] == int(time_point)].copy()

    if aggregation == 'hourly':
        work_df['hour'] = ((work_df['settlement_period'] - 1) // 2).astype(int)
        return work_df[work_df['hour'] == int(time_point)].copy()

    return work_df


def _build_bmu_action_counts(bmu_df):
    zero_counts = {
        'accepted_offers': 0,
        'accepted_bids': 0,
        'total_accepted_instructions': 0,
        'unique_boa_actions': 0,
        'zero_volume_actions_count': 0,
        'mixed_direction_actions_count': 0,
    }

    if bmu_df.empty:
        return zero_counts

    work_df = bmu_df.copy()
    eps = 1e-9

    work_df['total_volume_accepted'] = pd.to_numeric(
        work_df['total_volume_accepted'],
        errors='coerce'
    ).fillna(0.0)

    if 'node_bmu_match_key' in work_df.columns:
        work_df['bmu_action_key'] = _normalise_text_series(work_df['node_bmu_match_key'])
    else:
        work_df['bm_unit_key'] = _normalise_text_series(work_df['bm_unit'])
        work_df['national_grid_bm_unit_key'] = _normalise_text_series(work_df['national_grid_bm_unit'])
        work_df['bmu_action_key'] = work_df['bm_unit_key'].combine_first(
            work_df['national_grid_bm_unit_key']
        )

    work_df['acceptance_id_key'] = _normalise_id_series(work_df['acceptance_id'])

    missing_key_mask = (
        work_df['acceptance_id_key'].isna() |
        work_df['bmu_action_key'].isna()
    )

    if missing_key_mask.any():
        fallback_suffix = work_df.loc[missing_key_mask].index.astype(str)
        work_df.loc[missing_key_mask, 'acceptance_id_key'] = (
            'missing_acceptance_' + fallback_suffix
        )
        work_df.loc[missing_key_mask, 'bmu_action_key'] = (
            'missing_bmu_' + fallback_suffix
        )

    work_df['positive_component_volume'] = work_df['total_volume_accepted'].clip(lower=0.0)
    work_df['negative_component_volume'] = work_df['total_volume_accepted'].clip(upper=0.0)
    work_df['absolute_component_volume'] = work_df['total_volume_accepted'].abs()

    action_level = (
        work_df.groupby(
            ['bmu_action_key', 'acceptance_id_key'],
            dropna=False
        )
        .agg(
            positive_volume=('positive_component_volume', 'sum'),
            negative_volume=('negative_component_volume', 'sum'),
            absolute_volume=('absolute_component_volume', 'sum'),
        )
        .reset_index()
    )

    action_level['offer_instruction'] = (action_level['positive_volume'] > eps).astype(int)
    action_level['bid_instruction'] = (action_level['negative_volume'] < -eps).astype(int)
    action_level['effective_boa_action'] = (action_level['absolute_volume'] > eps).astype(int)
    action_level['zero_volume_action'] = (action_level['absolute_volume'] <= eps).astype(int)
    action_level['mixed_direction_action'] = (
        (action_level['offer_instruction'] == 1) &
        (action_level['bid_instruction'] == 1)
    ).astype(int)

    accepted_offers = int(action_level['offer_instruction'].sum())
    accepted_bids = int(action_level['bid_instruction'].sum())

    return {
        'accepted_offers': accepted_offers,
        'accepted_bids': accepted_bids,
        'total_accepted_instructions': int(accepted_offers + accepted_bids),
        'unique_boa_actions': int(action_level['effective_boa_action'].sum()),
        'zero_volume_actions_count': int(action_level['zero_volume_action'].sum()),
        'mixed_direction_actions_count': int(action_level['mixed_direction_action'].sum()),
    }


def _build_nms_bmu_contributions(node_day_df, nms_mapping, aggregation, time_point=None):
    if nms_mapping is None or nms_mapping.empty:
        return {
            'rows': [],
            'totals': {},
        }

    mapping_summary = (
        nms_mapping
        .copy()
        .assign(
            direct_connected_bmu_id=lambda df: df['direct_connected_bmu_id'].astype(str).str.strip(),
            metered_volume_percent=lambda df: pd.to_numeric(
                df['metered_volume_percent'],
                errors='coerce'
            ).fillna(100.0),
        )
        .groupby('direct_connected_bmu_id', dropna=False)
        .agg(metered_volume_percent=('metered_volume_percent', 'sum'))
        .reset_index()
    )

    aggregation_df = _filter_for_node_aggregation(node_day_df, aggregation, time_point)

    if not aggregation_df.empty:
        aggregation_df = aggregation_df.copy()
        if 'node_bmu_match_key' not in aggregation_df.columns:
            aggregation_df['node_bmu_match_key'] = aggregation_df['bm_unit'].combine_first(
                aggregation_df['national_grid_bm_unit']
            )

        aggregation_df['node_bmu_match_key'] = (
            aggregation_df['node_bmu_match_key']
            .fillna('')
            .astype(str)
            .str.strip()
        )

    rows = []

    for _, mapping_row in mapping_summary.iterrows():
        bmu_id = str(mapping_row['direct_connected_bmu_id']).strip()
        bmu_df = aggregation_df[
            aggregation_df['node_bmu_match_key'] == bmu_id
        ].copy() if not aggregation_df.empty else pd.DataFrame()

        weighted_volume = float(
            pd.to_numeric(
                bmu_df.get('total_volume_accepted', pd.Series(dtype=float)),
                errors='coerce'
            ).fillna(0.0).sum()
        )
        unweighted_volume = float(
            pd.to_numeric(
                bmu_df.get('unweighted_total_volume_accepted', pd.Series(dtype=float)),
                errors='coerce'
            ).fillna(0.0).sum()
        )
        weighted_cost = float(
            pd.to_numeric(
                bmu_df.get('balancing_cost', pd.Series(dtype=float)),
                errors='coerce'
            ).fillna(0.0).sum()
        )
        unweighted_cost = float(
            pd.to_numeric(
                bmu_df.get('unweighted_balancing_cost', pd.Series(dtype=float)),
                errors='coerce'
            ).fillna(0.0).sum()
        )

        system_volume = 0.0
        if not bmu_df.empty and 'system_operator_flag' in bmu_df.columns:
            system_volume = float(
                bmu_df.loc[
                    bmu_df['system_operator_flag'] == 1,
                    'total_volume_accepted'
                ].sum()
            )

        energy_volume = float(weighted_volume - system_volume)
        absolute_weighted_volume = float(
            pd.to_numeric(
                bmu_df.get('total_volume_accepted', pd.Series(dtype=float)),
                errors='coerce'
            ).fillna(0.0).abs().sum()
        )

        fuel_types = []
        if not bmu_df.empty and 'bmu_fuel_type' in bmu_df.columns:
            fuel_types = sorted(
                fuel for fuel in bmu_df['bmu_fuel_type'].fillna('').astype(str).str.strip().unique().tolist()
                if fuel
            )

        action_counts = _build_bmu_action_counts(bmu_df)

        rows.append({
            'bmu_id': bmu_id,
            'metered_volume_percent': float(mapping_row['metered_volume_percent']),
            'allocation_weight': float(mapping_row['metered_volume_percent']) / 100.0,
            'source_row_count': int(len(bmu_df)),
            'has_actions': bool(len(bmu_df) > 0),
            'fuel_types': fuel_types,
            'accepted_offers': action_counts['accepted_offers'],
            'accepted_bids': action_counts['accepted_bids'],
            'total_accepted_instructions': action_counts['total_accepted_instructions'],
            'unique_boa_actions': action_counts['unique_boa_actions'],
            'zero_volume_actions_count': action_counts['zero_volume_actions_count'],
            'mixed_direction_actions_count': action_counts['mixed_direction_actions_count'],
            'weighted_net_volume': weighted_volume,
            'unweighted_net_volume': unweighted_volume,
            'weighted_system_volume': system_volume,
            'weighted_energy_volume': energy_volume,
            'weighted_absolute_volume': absolute_weighted_volume,
            'weighted_balancing_cost': weighted_cost,
            'unweighted_balancing_cost': unweighted_cost,
        })

    total_absolute_volume = sum(row['weighted_absolute_volume'] for row in rows)

    for row in rows:
        row['absolute_volume_share_percent'] = (
            (row['weighted_absolute_volume'] / total_absolute_volume) * 100.0
            if total_absolute_volume > 0 else 0.0
        )

    rows = sorted(
        rows,
        key=lambda item: (
            item['weighted_absolute_volume'],
            item['total_accepted_instructions'],
            item['metered_volume_percent'],
            item['bmu_id'],
        ),
        reverse=True
    )

    return {
        'aggregation': aggregation,
        'time_point': None if aggregation == 'daily' else time_point,
        'weighting_basis': 'nms_metered_volume_percent',
        'rows': rows,
        'totals': {
            'bmu_count': len(rows),
            'active_bmu_count': int(sum(1 for row in rows if row['has_actions'])),
            'source_row_count': int(sum(row['source_row_count'] for row in rows)),
            'metered_volume_percent_sum': float(sum(row['metered_volume_percent'] for row in rows)),
            'weighted_net_volume': float(sum(row['weighted_net_volume'] for row in rows)),
            'unweighted_net_volume': float(sum(row['unweighted_net_volume'] for row in rows)),
            'weighted_absolute_volume': float(total_absolute_volume),
            'weighted_balancing_cost': float(sum(row['weighted_balancing_cost'] for row in rows)),
            'accepted_offers': int(sum(row['accepted_offers'] for row in rows)),
            'accepted_bids': int(sum(row['accepted_bids'] for row in rows)),
            'total_accepted_instructions': int(sum(row['total_accepted_instructions'] for row in rows)),
            'unique_boa_actions': int(sum(row['unique_boa_actions'] for row in rows)),
        }
    }


def daily_data(request):
    date_str = request.GET.get('date', None)
    if not date_str:
        return JsonResponse({"error": "Date parameter is required."}, status=400)

    try:
        date = datetime.strptime(date_str, '%d-%m-%Y')
    except ValueError:
        return JsonResponse({"error": "Invalid date format. Use DD-MM-YYYY."}, status=400)

    data = data_processor.get_daily_data(date)

    if not _daily_data_has_rows(data):
        try:
            fetch_date_to_processed(
                settlement_date=date.strftime('%Y-%m-%d'),
                max_sp=50,
                sleep_ms=250,
            )
            data = data_processor.get_daily_data(date)

        except Exception as e:
            import traceback
            print("\n[ERROR] Fallback fetch failed")
            print(f"[ERROR] Date: {date.strftime('%Y-%m-%d')}")
            print(f"[ERROR] Exception: {repr(e)}")
            traceback.print_exc()

            return JsonResponse(
                {"error": f"Fallback fetch failed for {date.strftime('%Y-%m-%d')}: {str(e)}"},
                status=500
            )

    if data is None:
        return JsonResponse({"error": "Data not available for the selected date."}, status=404)

    data['coverage_summary'] = _get_node_mapping_coverage_summary(date.year)

    return JsonResponse(data)


def interconnector_flows(request):
    date_str = request.GET.get('date')
    settlement_period_str = request.GET.get('settlement_period')
    requested_date = None
    requested_period = None

    if date_str:
        try:
            requested_date = datetime.strptime(date_str, '%d-%m-%Y').strftime('%Y-%m-%d')
        except ValueError:
            return JsonResponse({"error": "Invalid date format. Use DD-MM-YYYY."}, status=400)
    else:
        requested_date = datetime.now(ZoneInfo('Europe/London')).strftime('%Y-%m-%d')

    if settlement_period_str:
        try:
            requested_period = int(settlement_period_str)
        except ValueError:
            return JsonResponse({"error": "settlement_period must be an integer."}, status=400)

        if requested_period < 1 or requested_period > 50:
            return JsonResponse({"error": "settlement_period must be between 1 and 50."}, status=400)

    try:
        data = fetch_interconnector_flows_snapshot(
            requested_date=requested_date,
            requested_period=requested_period,
        )
    except InterconnectorDataError as exc:
        return JsonResponse({"error": str(exc)}, status=502)

    return JsonResponse(data)


def time_series_data(request):
    start_date_str = request.GET.get('start_date')
    end_date_str = request.GET.get('end_date')
    variables_str = request.GET.get('variables')

    if not all([start_date_str, end_date_str, variables_str]):
        return JsonResponse({'error': 'start_date, end_date, and variables are required'}, status=400)

    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        variables = variables_str.split(',')
    except ValueError:
        return JsonResponse({'error': 'Invalid date or variable format'}, status=400)

    all_data = []
    for year in range(start_date.year, end_date.year + 1):
        core_file = os.path.join(data_processor.core_data_dir, f'core_data_{year}.csv')
        if os.path.exists(core_file):
            df = pd.read_csv(core_file)

            if 'settlement_date' in df.columns:
                df['settlement_date'] = pd.to_datetime(
                    df['settlement_date'],
                    errors='coerce',
                    dayfirst=True
                )

            all_data.append(df)

    if not all_data:
        return JsonResponse({'error': 'No data available for the selected date range'}, status=404)

    full_df = pd.concat(all_data, ignore_index=True)

    mask = (full_df['settlement_date'] >= start_date) & (full_df['settlement_date'] <= end_date)
    filtered_df = full_df.loc[mask]

    if filtered_df.empty:
        return JsonResponse({'error': 'No data available for the selected date range'}, status=404)

    group_by_cols = ['settlement_date', 'settlement_period']

    numeric_vars = [
        v for v in variables
        if v in filtered_df.columns and pd.api.types.is_numeric_dtype(filtered_df[v])
    ]

    agg_dict = {var: 'sum' for var in numeric_vars}

    national_df = filtered_df.groupby(group_by_cols).agg(agg_dict).reset_index()

    final_vars = group_by_cols + numeric_vars
    response_df = national_df[
        [col for col in final_vars if col in variables or col in group_by_cols]
    ]

    if 'settlement_date' in response_df.columns:
        response_df['settlement_date'] = response_df['settlement_date'].dt.strftime('%Y-%m-%d')

    return JsonResponse(response_df.to_dict('records'), safe=False)


def available_variables(request):
    plottable_columns = [
        'net_volume',
        'boas_count',
        'bids_count',
        'offers_count',
        'total_accepted_instructions',
        'zero_volume_actions_count',
        'mixed_direction_actions_count',
        'system_volume',
        'energy_volume',
        'balancing_cost',
    ]
    time_columns = [
        'settlement_date',
        'settlement_period'
    ]
    return JsonResponse({'time': time_columns, 'numeric': plottable_columns}, safe=False)


def asset_benchmark_data(request):
    start_date_str = request.GET.get('start_date')
    end_date_str = request.GET.get('end_date')
    asset_type = request.GET.get('asset_type')
    capacity_mw = request.GET.get('capacity_mw')
    price_bid = request.GET.get('price_bid')
    price_offer = request.GET.get('price_offer')

    if not all([start_date_str, end_date_str, asset_type, capacity_mw]):
        return JsonResponse({'error': 'Missing required parameters'}, status=400)

    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        capacity_mw_float = float(capacity_mw)
        price_bid_float = float(price_bid) if price_bid else None
        price_offer_float = float(price_offer) if price_offer else None
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid parameter format'}, status=400)

    all_data = []
    for year in range(start_date.year, end_date.year + 1):
        processed_file = os.path.join(data_processor.processed_dir, f'{year}boadf_processed.csv')
        if os.path.exists(processed_file):
            df = pd.read_csv(processed_file)

            if 'settlement_date' in df.columns:
                df['settlement_date'] = pd.to_datetime(
                    df['settlement_date'],
                    errors='coerce',
                    dayfirst=True
                )

            all_data.append(df)

    if not all_data:
        return JsonResponse({'error': 'No data available for the selected date range'}, status=404)

    full_df = pd.concat(all_data, ignore_index=True)

    mask = (full_df['settlement_date'] >= start_date) & (full_df['settlement_date'] <= end_date)
    filtered_df = full_df.loc[mask]

    if filtered_df.empty:
        return JsonResponse({'error': 'No data available for the selected date range'}, status=404)

    benchmark = AssetBenchmark(filtered_df)
    results = benchmark.run_simulation(
        asset_type,
        capacity_mw_float,
        price_bid_float,
        price_offer_float
    )

    return JsonResponse(results, safe=False)


def nodes_by_zone(request):
    zone = request.GET.get('zone')
    node_layer = request.GET.get('node_layer', 'gnode').strip().lower()

    if not zone:
        return JsonResponse({'error': 'zone parameter is required'}, status=400)

    try:
        zone_key = str(zone).strip()

        if node_layer in ['nms', 'nms_node', 'nms_nodes']:
            nodes, excluded_missing_coordinate_count = _build_nms_nodes_for_zone(zone_key)

            if not nodes:
                return JsonResponse({'error': f'No NMS nodes found for zone {zone_key}'}, status=404)

            return JsonResponse({
                'zone': zone_key,
                'node_layer': 'nms_node',
                'count': len(nodes),
                'metrics_enabled_count': int(
                    sum(1 for node in nodes if node.get('node_view_mode') == 'direct_metrics_enabled')
                ),
                'excluded_missing_coordinate_count': excluded_missing_coordinate_count,
                'nodes': nodes
            })

        if node_layer not in ['gnode', 'gsp', 'lookup_gnode']:
            return JsonResponse(
                {'error': 'node_layer must be one of gnode or nms'},
                status=400
            )

        lookup_path = os.path.join(
            data_processor.data_dir,
            'gsp_gnode_directconnect_region_lookup.csv'
        )

        if not os.path.exists(lookup_path):
            return JsonResponse({'error': 'Lookup file not found'}, status=500)

        df = pd.read_csv(lookup_path)

        if 'pes_name' not in df.columns:
            return JsonResponse(
                {'error': 'Lookup file missing required column: pes_name'},
                status=500
            )

        df['pes_name'] = df['pes_name'].astype(str).str.strip()

        zone_df = df[df['pes_name'] == zone_key].copy()

        if zone_df.empty:
            return JsonResponse({'error': f'No nodes found for zone {zone_key}'}, status=404)

        node_cols = [
            'gnode_id',
            'gnode_name',
            'gnode_lat',
            'gnode_lon',
            'gsp_id',
            'gsp_name',
            'dc_id',
            'dc_name',
            'region_id',
            'region_name',
            'pes_id',
            'pes_name'
        ]

        missing_cols = [col for col in node_cols if col not in zone_df.columns]
        if missing_cols:
            return JsonResponse(
                {'error': f'Lookup file missing required node columns: {missing_cols}'},
                status=500
            )

        zone_df = zone_df[node_cols].copy()
        zone_df['gnode_id'] = zone_df['gnode_id'].apply(_normalize_gnode_id)

        zone_df['has_direct_bmu_mapping'] = False
        zone_df['direct_bmu_count'] = 0
        zone_df['direct_bmu_list'] = ''
        zone_df['node_view_mode'] = 'spatial_only'

        capability_df = _build_node_capability_from_mapping(zone_key)

        if capability_df is not None and not capability_df.empty:
            zone_df = zone_df.merge(
                capability_df,
                on='gnode_id',
                how='left',
                suffixes=('', '_cap')
            )

            for col in [
                'has_direct_bmu_mapping',
                'direct_bmu_count',
                'direct_bmu_list',
                'node_view_mode'
            ]:
                cap_col = f'{col}_cap'
                if cap_col in zone_df.columns:
                    zone_df[col] = zone_df[cap_col].combine_first(zone_df[col])
                    zone_df = zone_df.drop(columns=[cap_col])

        zone_df['has_direct_bmu_mapping'] = (
            zone_df['has_direct_bmu_mapping']
            .fillna(False)
            .astype(bool)
        )

        zone_df['direct_bmu_count'] = (
            pd.to_numeric(zone_df['direct_bmu_count'], errors='coerce')
            .fillna(0)
            .astype(int)
        )

        zone_df['direct_bmu_list'] = zone_df['direct_bmu_list'].fillna('').astype(str)
        zone_df['node_view_mode'] = zone_df['node_view_mode'].fillna('spatial_only').astype(str)
        zone_df['node_type'] = 'gnode'
        zone_df['node_id'] = zone_df['gnode_id']
        zone_df['node_name'] = zone_df['gnode_name']
        zone_df['node_lat'] = zone_df['gnode_lat']
        zone_df['node_lon'] = zone_df['gnode_lon']
        zone_df['mapping_basis'] = zone_df['has_direct_bmu_mapping'].apply(
            lambda enabled: 'validated_direct_bmu_to_lookup_gnode' if enabled else 'lookup_gnode_spatial_context'
        )

        zone_df = zone_df.astype(object)
        zone_df = zone_df.replace({np.nan: None})

        nodes = zone_df.to_dict('records')

        return JsonResponse({
            'zone': zone_key,
            'node_layer': 'gnode',
            'count': len(nodes),
            'metrics_enabled_count': int(
                sum(1 for node in nodes if node.get('node_view_mode') == 'direct_metrics_enabled')
            ),
            'nodes': nodes
        })

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


def node_metrics(request):
    node_type = request.GET.get('node_type', 'gnode').strip().lower()
    node_id = request.GET.get('node_id') or request.GET.get('gnode_id')
    zone = request.GET.get('zone')
    date_str = request.GET.get('date')
    aggregation = request.GET.get('aggregation', '30min')
    time_point = request.GET.get('time_point')

    if not all([node_id, zone, date_str]):
        return JsonResponse(
            {'error': 'node_id, zone, and date are required'},
            status=400
        )

    try:
        date = datetime.strptime(date_str, '%d-%m-%Y')
    except ValueError:
        return JsonResponse({'error': 'Invalid date format. Use DD-MM-YYYY.'}, status=400)

    if aggregation not in ['30min', 'hourly', 'daily']:
        return JsonResponse({'error': 'aggregation must be one of 30min, hourly, daily'}, status=400)

    if aggregation != 'daily':
        if time_point is None:
            return JsonResponse({'error': 'time_point is required for 30min or hourly aggregation'}, status=400)
        try:
            time_point = int(time_point)
        except ValueError:
            return JsonResponse({'error': 'time_point must be an integer'}, status=400)

    zone_key = str(zone).strip()
    normalized_node_id = str(node_id).strip()
    allocation_weight_map = {}
    mapping_row_count = 0
    metrics_scope = 'node_direct_bmu_aggregated'
    allocation_note = 'none'
    nms_mapping = None

    if node_type in ['nms', 'nms_node', 'nms_nodes']:
        node_type = 'nms_node'
        nms_mapping = _get_enabled_nms_node_bmu_mapping(normalized_node_id, zone_key)

        if nms_mapping.empty:
            return JsonResponse(
                {'error': 'No direct BMU mapping found for the selected NMS node.'},
                status=404
            )

        mapping_row_count = int(len(nms_mapping))
        bmu_list = sorted(nms_mapping['direct_connected_bmu_id'].dropna().astype(str).unique().tolist())
        allocation_weight_map = (
            nms_mapping
            .assign(allocation_weight=lambda df: df['metered_volume_percent'] / 100.0)
            .groupby('direct_connected_bmu_id')['allocation_weight']
            .sum()
            .to_dict()
        )
        metrics_scope = 'nms_node_direct_bmu_aggregated'
        allocation_note = (
            'volumes_and_costs_weighted_by_nms_metered_volume_percent; '
            'action_counts_use_weighted_non_zero_bmu_actions'
        )
    else:
        node_type = 'gnode'
        normalized_node_id = _normalize_gnode_id(normalized_node_id)
        bmu_list = _get_enabled_node_bmu_list(normalized_node_id, zone_key)

        if not bmu_list:
            return JsonResponse(
                {'error': 'No direct BMU mapping found for the selected node.'},
                status=404
            )

        mapping_row_count = len(bmu_list)

    year = date.year
    processed_df = _load_processed_year_df(year)

    if processed_df is None:
        try:
            fetch_date_to_processed(
                settlement_date=date.strftime('%Y-%m-%d'),
                max_sp=50,
                sleep_ms=250,
            )
            processed_df = _load_processed_year_df(year)
        except Exception as e:
            return JsonResponse({'error': f'Fallback fetch failed: {str(e)}'}, status=500)

    if processed_df is None:
        return JsonResponse({'error': 'Processed data not available for the selected date.'}, status=404)

    target_date = date.strftime('%Y-%m-%d')

    node_day_df = processed_df[
        (processed_df['settlement_date'] == target_date) &
        (
            processed_df['bm_unit'].isin(bmu_list) |
            processed_df['national_grid_bm_unit'].isin(bmu_list)
        )
    ].copy()

    if node_type == 'nms_node':
        node_day_df = _apply_nms_allocation_weights(node_day_df, allocation_weight_map)

    sp_metrics_df = _build_node_sp_metrics(node_day_df)
    agg_record = _aggregate_node_metrics(sp_metrics_df, aggregation, time_point)
    available_settlement_periods = []
    if not sp_metrics_df.empty and 'settlement_period' in sp_metrics_df.columns:
        available_settlement_periods = [
            int(sp)
            for sp in sorted(sp_metrics_df['settlement_period'].dropna().unique().tolist())
        ]

    response = {
        'node_type': node_type,
        'node_id': normalized_node_id,
        'gnode_id': normalized_node_id if node_type == 'gnode' else None,
        'nms_node_id': normalized_node_id if node_type == 'nms_node' else None,
        'zone': zone_key,
        'date': date.strftime('%d-%m-%Y'),
        'aggregation': aggregation,
        'time_point': None if aggregation == 'daily' else time_point,
        'metrics_scope': metrics_scope,
        'node_allocation_weighting': allocation_note,
        'resolved_mapping_row_count': mapping_row_count,
        'resolved_bmu_count': len(bmu_list),
        'resolved_bmu_list': bmu_list,
        'matched_processed_row_count': int(len(node_day_df)),
        'aggregation_source_row_count': int(agg_record.get('source_row_count', 0)),
        'available_settlement_periods': available_settlement_periods,
        'metrics': {
            'accepted_offers': int(agg_record.get('offers_count', 0)),
            'accepted_bids': int(agg_record.get('bids_count', 0)),
            'total_accepted_instructions': int(agg_record.get('total_accepted_instructions', 0)),
            'unique_boa_actions': int(agg_record.get('boas_count', 0)),
            'zero_volume_actions_count': int(agg_record.get('zero_volume_actions_count', 0)),
            'mixed_direction_actions_count': int(agg_record.get('mixed_direction_actions_count', 0)),
            'net_imbalance_volume': float(agg_record.get('net_volume', 0.0)),
            'system_volume': float(agg_record.get('system_volume', 0.0)),
            'energy_volume': float(agg_record.get('energy_volume', 0.0)),
            'balancing_cost': float(agg_record.get('balancing_cost', 0.0)),
            'generation_mix': agg_record.get('generation_mix') or {},
            'consumption_mix': agg_record.get('consumption_mix') or {},
        }
    }

    if node_type == 'nms_node':
        response['bmu_contributions'] = _build_nms_bmu_contributions(
            node_day_df,
            nms_mapping,
            aggregation,
            time_point
        )

    return JsonResponse(response)
