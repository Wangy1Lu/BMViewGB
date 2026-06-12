import argparse
import json
from pathlib import Path

import pandas as pd


BACKEND_DIR = Path(__file__).resolve().parents[1]
NMS_NODE_BMU_MAPPING_FILE = 'nms_node_bmu_mapping.csv'
NMS_NODE_COORDINATE_ENRICHMENT_FILE = 'nms_node_coordinate_enrichment.csv'
NODE_BMU_MAPPING_FILE = 'direct_connected_bmu_to_lookup_gnode_validated.csv'
NODE_MAPPING_COVERAGE_SUMMARY_TEMPLATE = 'node_mapping_coverage_summary_{year}.json'


def _discover_years(data_dir):
    years = []
    for path in data_dir.glob('*boadf_processed.csv'):
        year = path.name.replace('boadf_processed.csv', '')
        if year.isdigit():
            years.append(int(year))
    return sorted(years)


def _parse_mixed_settlement_dates(series):
    parsed = pd.to_datetime(series, errors='coerce', format='%Y-%m-%d')
    missing_mask = parsed.isna()
    if missing_mask.any():
        parsed.loc[missing_mask] = pd.to_datetime(
            series.loc[missing_mask],
            errors='coerce',
            dayfirst=True,
        )
    return parsed.dt.strftime('%Y-%m-%d')


def _normalise_text_series(series):
    result = series.astype(str).str.strip()
    result = result.replace({'nan': pd.NA, 'None': pd.NA, '': pd.NA})
    return result


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


def _safe_rate(numerator, denominator):
    denominator = float(denominator or 0)
    if denominator <= 0:
        return 0.0
    return float(numerator) / denominator * 100.0


def _load_gnode_mapping(data_dir):
    path = data_dir / NODE_BMU_MAPPING_FILE
    if not path.exists():
        return pd.DataFrame(columns=['direct_connected_bmu_id'])

    df = pd.read_csv(path, usecols=['direct_connected_bmu_id'])
    df['direct_connected_bmu_id'] = _normalise_text_series(df['direct_connected_bmu_id'])
    return df


def _load_nms_visible_mapping(data_dir):
    path = data_dir / NMS_NODE_BMU_MAPPING_FILE
    if not path.exists():
        return pd.DataFrame(columns=['direct_connected_bmu_id'])

    df = pd.read_csv(path)
    required_cols = [
        'nms_node_id',
        'nms_node_lat',
        'nms_node_lon',
        'direct_connected_bmu_id',
    ]
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        raise ValueError(f'{path} missing required columns: {missing_cols}')

    df = df.copy()
    df['nms_node_id'] = df['nms_node_id'].astype(str).str.strip()
    df['direct_connected_bmu_id'] = _normalise_text_series(df['direct_connected_bmu_id'])
    df['nms_node_lat'] = pd.to_numeric(df['nms_node_lat'], errors='coerce')
    df['nms_node_lon'] = pd.to_numeric(df['nms_node_lon'], errors='coerce')

    enrichment_path = data_dir / NMS_NODE_COORDINATE_ENRICHMENT_FILE
    if enrichment_path.exists():
        enrichment = pd.read_csv(enrichment_path)
        enrichment_required = ['nms_node_id', 'nms_node_lat', 'nms_node_lon']
        missing_enrichment = [
            col for col in enrichment_required
            if col not in enrichment.columns
        ]
        if missing_enrichment:
            raise ValueError(
                f'{enrichment_path} missing required columns: {missing_enrichment}'
            )

        enrichment = enrichment[enrichment_required].copy()
        enrichment['nms_node_id'] = enrichment['nms_node_id'].astype(str).str.strip()
        enrichment['nms_node_lat'] = pd.to_numeric(enrichment['nms_node_lat'], errors='coerce')
        enrichment['nms_node_lon'] = pd.to_numeric(enrichment['nms_node_lon'], errors='coerce')
        enrichment = enrichment.drop_duplicates(subset=['nms_node_id'])

        merged = df.merge(
            enrichment.rename(columns={
                'nms_node_lat': 'enriched_nms_node_lat',
                'nms_node_lon': 'enriched_nms_node_lon',
            }),
            on='nms_node_id',
            how='left',
        )

        missing_lat = merged['nms_node_lat'].isna()
        missing_lon = merged['nms_node_lon'].isna()
        merged.loc[missing_lat, 'nms_node_lat'] = merged.loc[
            missing_lat,
            'enriched_nms_node_lat',
        ]
        merged.loc[missing_lon, 'nms_node_lon'] = merged.loc[
            missing_lon,
            'enriched_nms_node_lon',
        ]
        df = merged

    visible = df[df['nms_node_lat'].notna() & df['nms_node_lon'].notna()].copy()
    return visible[['direct_connected_bmu_id']]


def _new_accumulator(mapped_bmus):
    return {
        'mapped_bmus': set(mapped_bmus or []),
        'seen_bmus': set(),
        'mapped_bmus_seen': set(),
        'total_offer_mwh': 0.0,
        'mapped_offer_mwh': 0.0,
        'total_bid_mwh': 0.0,
        'mapped_bid_mwh': 0.0,
    }


def _update_accumulator(accumulator, bmu_series, volume_series):
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


def _metric_row(mapping_key, label, accumulator):
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


def build_summary(data_dir, year):
    processed_file = data_dir / f'{year}boadf_processed.csv'
    if not processed_file.exists():
        return None

    header = pd.read_csv(processed_file, nrows=0)
    required_cols = ['settlement_date', 'bm_unit', 'total_volume_accepted']
    missing_cols = [col for col in required_cols if col not in header.columns]
    if missing_cols:
        raise ValueError(f'{processed_file} missing required columns: {missing_cols}')

    accumulators = {
        'nms_visible': _new_accumulator(
            _clean_bmu_id_set(_load_nms_visible_mapping(data_dir)['direct_connected_bmu_id'])
        ),
        'gnode_validated': _new_accumulator(
            _clean_bmu_id_set(_load_gnode_mapping(data_dir)['direct_connected_bmu_id'])
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
            errors='coerce',
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

        for accumulator in accumulators.values():
            _update_accumulator(accumulator, valid_bmus, valid_volumes)

    if date_min is None or date_max is None:
        return None

    return {
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
        'rows': [
            _metric_row('nms_visible', 'NMS node mapping', accumulators['nms_visible']),
            _metric_row('gnode_validated', 'GNode direct mapping', accumulators['gnode_validated']),
        ],
    }


def main():
    parser = argparse.ArgumentParser(
        description='Precompute BMViewGB node mapping coverage summary JSON files.'
    )
    parser.add_argument(
        '--data-dir',
        default=str(BACKEND_DIR / 'data'),
        help='Directory containing BMViewGB runtime data.',
    )
    parser.add_argument(
        '--years',
        nargs='*',
        type=int,
        help='Years to build. Defaults to every *boadf_processed.csv in data-dir.',
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Overwrite existing summary files.',
    )

    args = parser.parse_args()
    data_dir = Path(args.data_dir).expanduser().resolve()
    years = args.years or _discover_years(data_dir)
    results = []

    for year in years:
        output_path = data_dir / NODE_MAPPING_COVERAGE_SUMMARY_TEMPLATE.format(year=year)

        if output_path.exists() and not args.force:
            results.append({
                'year': year,
                'path': str(output_path),
                'status': 'exists',
            })
            continue

        summary = build_summary(data_dir, year)
        if summary is None:
            results.append({
                'year': year,
                'path': str(output_path),
                'status': 'skipped',
            })
            continue

        output_path.write_text(
            json.dumps(summary, indent=2),
            encoding='utf-8',
        )
        results.append({
            'year': year,
            'path': str(output_path),
            'status': 'written',
            'bytes': output_path.stat().st_size,
        })

    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
