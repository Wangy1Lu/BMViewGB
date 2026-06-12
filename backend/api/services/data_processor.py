import pandas as pd
import json
from pathlib import Path
import numpy as np
import os
from collections import Counter


class DataProcessor:
    def __init__(self, data_dir=None):
        # Determine the correct data directory path
        if data_dir is None:
            data_dir = os.environ.get('BMVIEWGB_DATA_DIR')

        if data_dir is None:
            # Get the directory where this file is located
            current_file = Path(__file__).resolve()
            # Navigate to backend/data from api/services/
            backend_dir = current_file.parent.parent.parent
            data_dir = os.path.join(backend_dir, 'data')

        self.data_dir = data_dir
        self.processed_dir = self.data_dir
        self.core_data_dir = os.path.join(self.data_dir, 'core')
        os.makedirs(self.core_data_dir, exist_ok=True)

    # -------------------------------------------------------------------------
    # Shared normalisation helpers
    # -------------------------------------------------------------------------
    def _parse_mixed_settlement_dates(self, series):
        """
        Normalise settlement_date to YYYY-MM-DD.

        Supports:
          - ISO dates: 2024-01-01
          - old/local-style dates: 01/01/2024 or 26/02/2026
        """
        parsed = pd.to_datetime(series, errors='coerce', format='%Y-%m-%d')

        missing_mask = parsed.isna()
        if missing_mask.any():
            parsed.loc[missing_mask] = pd.to_datetime(
                series.loc[missing_mask],
                errors='coerce',
                dayfirst=True
            )

        return parsed.dt.strftime('%Y-%m-%d')

    def _normalise_id_series(self, series):
        """
        Convert IDs into stable string keys.

        This avoids treating 123, 123.0, and '123' as different IDs.
        Missing values remain missing at this stage.
        """
        raw = series.copy()

        # Preserve original string form first
        result = raw.astype(str).str.strip()

        # Convert numeric-looking IDs into clean integer strings where possible
        numeric = pd.to_numeric(raw, errors='coerce')
        numeric_mask = numeric.notna()

        result.loc[numeric_mask] = numeric.loc[numeric_mask].apply(
            lambda x: str(int(x)) if float(x).is_integer() else str(x)
        )

        result = result.replace({'nan': pd.NA, 'None': pd.NA, '': pd.NA})
        return result

    def _normalise_text_series(self, series):
        """
        Convert text columns into clean string keys.
        """
        result = series.astype(str).str.strip()
        result = result.replace({'nan': pd.NA, 'None': pd.NA, '': pd.NA})
        return result

    def _build_action_counts(self, df):
        """
        Build action-level count metrics for one yearly processed dataframe.

        Correct counting logic:
          processed rows
              -> group to unique BOA action key
              -> preserve positive and negative volume components separately
              -> count offer-side and bid-side instructions by component direction
              -> aggregate to zone + settlement period

        Definitions:
          Accepted Offers:
            Number of unique BOA actions that contain at least one positive
            accepted-volume component.

          Accepted Bids:
            Number of unique BOA actions that contain at least one negative
            accepted-volume component.

          Total Accepted Instructions:
            Accepted Offers + Accepted Bids.

          Unique BOA Actions:
            Number of unique BOA actions with at least one non-zero accepted-volume
            component. This excludes purely zero-volume records, but still counts
            mixed positive/negative actions once.

        BOA action key:
          settlement_date
          settlement_period
          gsp_group_id
          BMU identity: bm_unit, fallback national_grid_bm_unit
          acceptance_id

        Outputs:
          offers_count
          bids_count
          boas_count
          total_accepted_instructions

        Additional diagnostic outputs:
          zero_volume_actions_count
          mixed_direction_actions_count
        """
        work = df.copy()

        required_cols = [
            'settlement_date',
            'settlement_period',
            'gsp_group_id',
            'acceptance_id',
            'total_volume_accepted',
        ]

        missing_cols = [col for col in required_cols if col not in work.columns]
        if missing_cols:
            raise ValueError(f'Missing required columns for BOA action counts: {missing_cols}')

        # BMU identity is required for a safer action key.
        # If one of the two BMU columns is absent, create it as missing and use fallback logic.
        if 'bm_unit' not in work.columns:
            work['bm_unit'] = pd.NA
        if 'national_grid_bm_unit' not in work.columns:
            work['national_grid_bm_unit'] = pd.NA

        work['total_volume_accepted'] = pd.to_numeric(
            work['total_volume_accepted'],
            errors='coerce'
        ).fillna(0.0)

        work['acceptance_id_key'] = self._normalise_id_series(work['acceptance_id'])

        work['bm_unit_key'] = self._normalise_text_series(work['bm_unit'])
        work['national_grid_bm_unit_key'] = self._normalise_text_series(
            work['national_grid_bm_unit']
        )

        work['bmu_action_key'] = work['bm_unit_key'].combine_first(
            work['national_grid_bm_unit_key']
        )

        # If either BMU identity or acceptance ID is missing, do not let all missing
        # values collapse into one false action. Give those rows unique fallback keys.
        missing_key_mask = (
            work['acceptance_id_key'].isna() |
            work['bmu_action_key'].isna()
        )

        if missing_key_mask.any():
            fallback_suffix = work.loc[missing_key_mask].index.astype(str)

            work.loc[missing_key_mask, 'acceptance_id_key'] = (
                'missing_acceptance_' + fallback_suffix
            )
            work.loc[missing_key_mask, 'bmu_action_key'] = (
                'missing_bmu_' + fallback_suffix
            )

        # Preserve component direction before netting.
        # This is the key change:
        #   - offer/bid counts are based on whether a component exists,
        #     not only on the final net volume.
        work['positive_component_volume'] = work['total_volume_accepted'].clip(lower=0.0)
        work['negative_component_volume'] = work['total_volume_accepted'].clip(upper=0.0)
        work['absolute_component_volume'] = work['total_volume_accepted'].abs()

        action_level = (
            work.groupby(
                [
                    'settlement_date',
                    'settlement_period',
                    'gsp_group_id',
                    'bmu_action_key',
                    'acceptance_id_key',
                ],
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

        eps = 1e-9

        action_level['offer_instruction'] = (
            action_level['positive_volume'] > eps
        ).astype(int)

        action_level['bid_instruction'] = (
            action_level['negative_volume'] < -eps
        ).astype(int)

        # Effective BOA action:
        # Count the action if it has any non-zero accepted-volume component.
        # This excludes single zero-volume records, especially common in API-derived
        # 2025/2026 processed rows.
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

        action_counts = (
            action_level.groupby(
                ['settlement_date', 'settlement_period', 'gsp_group_id'],
                dropna=False
            )
            .agg(
                boas_count=('effective_boa_action', 'sum'),
                offers_count=('offer_instruction', 'sum'),
                bids_count=('bid_instruction', 'sum'),
                zero_volume_actions_count=('zero_volume_action', 'sum'),
                mixed_direction_actions_count=('mixed_direction_action', 'sum'),
            )
        )

        action_counts['total_accepted_instructions'] = (
            action_counts['offers_count'] + action_counts['bids_count']
        )

        return action_counts

    def _json_to_dict_safe(self, value):
        """
        Convert stored mix columns back to dictionaries.
        """
        if isinstance(value, dict):
            return value

        if not isinstance(value, str) or pd.isna(value):
            return {}

        if value in ('{}', 'nan', 'None', ''):
            return {}

        try:
            return json.loads(value.replace("'", "\""))
        except Exception:
            return {}

    def _to_json_records(self, df):
        """
        Convert a DataFrame to JSON-safe records for Django JsonResponse.
        """
        records = []

        for _, row in df.iterrows():
            record = row.to_dict()

            for key, value in record.items():
                if key in ['generation_mix', 'consumption_mix']:
                    record[key] = value if isinstance(value, dict) else {}
                    continue

                if pd.isna(value) or (
                    isinstance(value, float) and (np.isinf(value) or np.isnan(value))
                ):
                    record[key] = None

            records.append(record)

        return records

    # -------------------------------------------------------------------------
    # Core data creation
    # -------------------------------------------------------------------------
    def create_core_data(self, year):
        processed_file = os.path.join(self.processed_dir, f'{year}boadf_processed.csv')
        core_file = os.path.join(self.core_data_dir, f'core_data_{year}.csv')

        if os.path.exists(core_file):
            print(f'Core data for {year} already exists.')
            return

        if not os.path.exists(processed_file):
            print(f'Processed data for {year} not found.')
            return

        print(f'Creating core data for {year}...')
        df = pd.read_csv(processed_file)

        # ---------------------------------------------------------------------
        # Defensive type cleaning
        # ---------------------------------------------------------------------
        numeric_cols = [
            'total_volume_accepted',
            'system_operator_flag',
            'accepted_price',
            'balancing_cost',
            'settlement_period',
            'acceptance_id',
        ]

        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')

        if 'total_volume_accepted' not in df.columns:
            raise ValueError(f'{processed_file} is missing total_volume_accepted.')

        if 'system_operator_flag' not in df.columns:
            df['system_operator_flag'] = 0

        if 'balancing_cost' not in df.columns:
            df['balancing_cost'] = 0.0

        if 'bmu_fuel_type' not in df.columns:
            df['bmu_fuel_type'] = pd.NA

        if 'bm_unit' not in df.columns:
            df['bm_unit'] = pd.NA

        if 'national_grid_bm_unit' not in df.columns:
            df['national_grid_bm_unit'] = pd.NA

        df['total_volume_accepted'] = df['total_volume_accepted'].fillna(0.0)
        df['system_operator_flag'] = pd.to_numeric(
            df['system_operator_flag'],
            errors='coerce'
        ).fillna(0).astype(int)
        df['balancing_cost'] = pd.to_numeric(
            df['balancing_cost'],
            errors='coerce'
        ).fillna(0.0)
        df['settlement_period'] = pd.to_numeric(
            df['settlement_period'],
            errors='coerce'
        ).fillna(0).astype(int)

        # Normalize dates and key string columns
        if 'settlement_date' in df.columns:
            df['settlement_date'] = self._parse_mixed_settlement_dates(df['settlement_date'])

        for col in [
            'gsp_group_id',
            'bmu_fuel_type',
            'bm_unit',
            'national_grid_bm_unit',
        ]:
            if col in df.columns:
                df[col] = self._normalise_text_series(df[col])

        df = df.replace({'nan': pd.NA, 'None': pd.NA, '': pd.NA})

        # Drop rows missing the minimum grouping keys required for core aggregation
        df = df.dropna(
            subset=['settlement_date', 'settlement_period', 'gsp_group_id']
        ).copy()

        if df.empty:
            print(f'No usable processed rows for {year}.')
            return

        # ---------------------------------------------------------------------
        # Business-correct action counts
        #
        # Important:
        #   Do not count processed rows directly.
        #   First group rows into unique BOA actions using:
        #   date + SP + zone + BMU identity + acceptance_id.
        #
        # Then:
        #   - Accepted Offers checks whether the action has positive components.
        #   - Accepted Bids checks whether the action has negative components.
        #   - Unique BOA Actions counts effective non-zero actions.
        # ---------------------------------------------------------------------
        action_counts = self._build_action_counts(df)

        # ---------------------------------------------------------------------
        # Technology mix still uses row-level accepted volume grouped by fuel type
        # ---------------------------------------------------------------------
        offers_df = df[df['total_volume_accepted'] > 0].copy()
        bids_df = df[df['total_volume_accepted'] < 0].copy()

        offers_df = offers_df.dropna(
            subset=['settlement_date', 'settlement_period', 'gsp_group_id', 'bmu_fuel_type']
        )
        bids_df = bids_df.dropna(
            subset=['settlement_date', 'settlement_period', 'gsp_group_id', 'bmu_fuel_type']
        )

        if not offers_df.empty:
            gen_mix_df = (
                offers_df.groupby(
                    [
                        'settlement_date',
                        'settlement_period',
                        'gsp_group_id',
                        'bmu_fuel_type',
                    ]
                )['total_volume_accepted']
                .sum()
                .unstack(fill_value=0)
            )
            gen_mix_json = gen_mix_df.apply(lambda x: x.to_dict(), axis=1)
        else:
            gen_mix_json = pd.Series(dtype=object)

        if not bids_df.empty:
            con_mix_df = (
                bids_df.groupby(
                    [
                        'settlement_date',
                        'settlement_period',
                        'gsp_group_id',
                        'bmu_fuel_type',
                    ]
                )['total_volume_accepted']
                .sum()
                .unstack(fill_value=0)
            )
            con_mix_json = con_mix_df.apply(lambda x: x.to_dict(), axis=1)
        else:
            con_mix_json = pd.Series(dtype=object)

        # ---------------------------------------------------------------------
        # Core numeric aggregations at zone-SP level
        # ---------------------------------------------------------------------
        agg_funcs = {
            'total_volume_accepted': 'sum',
            'balancing_cost': 'sum',
        }

        core_data = (
            df.groupby(['settlement_date', 'settlement_period', 'gsp_group_id'])
            .agg(agg_funcs)
        )

        system_volume = (
            df[df['system_operator_flag'] == 1]
            .groupby(['settlement_date', 'settlement_period', 'gsp_group_id'])[
                'total_volume_accepted'
            ]
            .sum()
        )

        core_data = core_data.join(system_volume.rename('system_volume'))
        core_data['system_volume'] = core_data['system_volume'].fillna(0.0)

        core_data.rename(
            columns={
                'total_volume_accepted': 'net_volume',
            },
            inplace=True
        )

        core_data['energy_volume'] = core_data['net_volume'] - core_data['system_volume']

        # Join action-level counts
        core_data = core_data.join(action_counts)

        for col in [
            'boas_count',
            'offers_count',
            'bids_count',
            'total_accepted_instructions',
            'zero_volume_actions_count',
            'mixed_direction_actions_count',
        ]:
            if col not in core_data.columns:
                core_data[col] = 0
            core_data[col] = core_data[col].fillna(0).astype(int)

        # Join technology mixes
        core_data = core_data.join(gen_mix_json.rename('generation_mix'))
        core_data = core_data.join(con_mix_json.rename('consumption_mix'))

        core_data['generation_mix'] = core_data['generation_mix'].apply(
            lambda x: x if isinstance(x, dict) else {}
        )
        core_data['consumption_mix'] = core_data['consumption_mix'].apply(
            lambda x: x if isinstance(x, dict) else {}
        )

        core_data.reset_index(inplace=True)
        core_data.to_csv(core_file, index=False)

        print(f'Finished creating core data for {year}.')

    def create_all_core_data(self):
        """
        Create core files for every yearly processed file found in data_dir.
        """
        processed_paths = Path(self.processed_dir).glob('*boadf_processed.csv')

        years = []
        for path in processed_paths:
            name = path.name
            year_part = name.replace('boadf_processed.csv', '')
            if year_part.isdigit():
                years.append(int(year_part))

        for year in sorted(years):
            self.create_core_data(year)

    # -------------------------------------------------------------------------
    # Data access
    # -------------------------------------------------------------------------
    def _load_daily_core_rows(self, core_file, date_str):
        daily_chunks = []

        for chunk in pd.read_csv(core_file, chunksize=50_000):
            if 'settlement_date' not in chunk.columns:
                continue

            chunk['settlement_date'] = self._parse_mixed_settlement_dates(
                chunk['settlement_date']
            )
            matched = chunk[chunk['settlement_date'] == date_str].copy()

            if not matched.empty:
                daily_chunks.append(matched)

        if not daily_chunks:
            return pd.DataFrame()

        return pd.concat(daily_chunks, ignore_index=True)

    def _normalise_daily_core_types(self, daily_data):
        numeric_cols = [
            'settlement_period',
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

        for col in numeric_cols:
            if col in daily_data.columns:
                daily_data[col] = pd.to_numeric(
                    daily_data[col],
                    errors='coerce'
                ).fillna(0)

        for col in [
            'settlement_period',
            'boas_count',
            'bids_count',
            'offers_count',
            'total_accepted_instructions',
            'zero_volume_actions_count',
            'mixed_direction_actions_count',
        ]:
            if col in daily_data.columns:
                daily_data[col] = daily_data[col].astype(int)

        return daily_data

    def get_daily_data(self, date):
        year = date.year
        core_file = os.path.join(self.core_data_dir, f'core_data_{year}.csv')

        if not os.path.exists(core_file):
            self.create_core_data(year)

        if not os.path.exists(core_file):
            return None

        date_str = date.strftime('%Y-%m-%d')
        daily_data = self._load_daily_core_rows(core_file, date_str)

        if daily_data.empty:
            return {
                'day_type': 'N',
                'settlement_period': [],
                'hourly': [],
                'daily': [],
            }

        # Backward compatibility in case an older core_data file is still present.
        if 'total_accepted_instructions' not in daily_data.columns:
            daily_data['total_accepted_instructions'] = (
                pd.to_numeric(daily_data.get('offers_count', 0), errors='coerce').fillna(0)
                + pd.to_numeric(daily_data.get('bids_count', 0), errors='coerce').fillna(0)
            ).astype(int)

        if 'zero_volume_actions_count' not in daily_data.columns:
            daily_data['zero_volume_actions_count'] = 0

        if 'mixed_direction_actions_count' not in daily_data.columns:
            daily_data['mixed_direction_actions_count'] = 0

        daily_data = self._normalise_daily_core_types(daily_data)

        max_sp = daily_data['settlement_period'].max()
        if max_sp == 48:
            day_type = 'N'
        elif max_sp > 48:
            day_type = 'L'
        else:
            day_type = 'S'

        # Convert tech mix from stored string representation back to dict
        for col in ['generation_mix', 'consumption_mix']:
            if col not in daily_data.columns:
                daily_data[col] = [{} for _ in range(len(daily_data))]
            else:
                daily_data[col] = daily_data[col].apply(self._json_to_dict_safe)

        # Aggregations
        daily_data_sp = daily_data.copy()
        daily_data_sp['hour'] = (daily_data_sp['settlement_period'] - 1) // 2

        daily_data_hr = self.aggregate_to_hourly(daily_data_sp)
        daily_data_day = self.aggregate_to_daily(daily_data_sp)

        return {
            'day_type': day_type,
            'settlement_period': self._to_json_records(daily_data_sp),
            'hourly': self._to_json_records(daily_data_hr),
            'daily': self._to_json_records(daily_data_day),
        }

    # -------------------------------------------------------------------------
    # Aggregation helpers
    # -------------------------------------------------------------------------
    def _aggregate_mix(self, series_of_dicts):
        total = Counter()

        for d in series_of_dicts:
            if isinstance(d, dict):
                for key, value in d.items():
                    try:
                        total[key] += float(value)
                    except Exception:
                        continue

        return dict(total)

    def aggregate_to_hourly(self, df):
        if df.empty:
            return df.copy()

        # Backward compatibility for old core_data files
        if 'total_accepted_instructions' not in df.columns:
            df = df.copy()
            df['total_accepted_instructions'] = (
                pd.to_numeric(df.get('offers_count', 0), errors='coerce').fillna(0)
                + pd.to_numeric(df.get('bids_count', 0), errors='coerce').fillna(0)
            ).astype(int)

        if 'zero_volume_actions_count' not in df.columns:
            df = df.copy()
            df['zero_volume_actions_count'] = 0

        if 'mixed_direction_actions_count' not in df.columns:
            df = df.copy()
            df['mixed_direction_actions_count'] = 0

        numeric_aggs = {
            'net_volume': 'sum',
            'boas_count': 'sum',
            'bids_count': 'sum',
            'offers_count': 'sum',
            'total_accepted_instructions': 'sum',
            'zero_volume_actions_count': 'sum',
            'mixed_direction_actions_count': 'sum',
            'system_volume': 'sum',
            'energy_volume': 'sum',
            'balancing_cost': 'sum',
        }

        # Only aggregate columns that actually exist
        numeric_aggs = {
            col: agg for col, agg in numeric_aggs.items()
            if col in df.columns
        }

        all_aggs = {
            **numeric_aggs,
            'generation_mix': self._aggregate_mix,
            'consumption_mix': self._aggregate_mix,
        }

        # Only include mix aggregations if the columns exist
        all_aggs = {
            col: agg for col, agg in all_aggs.items()
            if col in df.columns
        }

        df_hourly = (
            df.groupby(['settlement_date', 'gsp_group_id', 'hour'])
            .agg(all_aggs)
            .reset_index()
        )

        return df_hourly

    def aggregate_to_daily(self, df):
        if df.empty:
            return df.copy()

        # Backward compatibility for old core_data files
        if 'total_accepted_instructions' not in df.columns:
            df = df.copy()
            df['total_accepted_instructions'] = (
                pd.to_numeric(df.get('offers_count', 0), errors='coerce').fillna(0)
                + pd.to_numeric(df.get('bids_count', 0), errors='coerce').fillna(0)
            ).astype(int)

        if 'zero_volume_actions_count' not in df.columns:
            df = df.copy()
            df['zero_volume_actions_count'] = 0

        if 'mixed_direction_actions_count' not in df.columns:
            df = df.copy()
            df['mixed_direction_actions_count'] = 0

        numeric_aggs = {
            'net_volume': 'sum',
            'boas_count': 'sum',
            'bids_count': 'sum',
            'offers_count': 'sum',
            'total_accepted_instructions': 'sum',
            'zero_volume_actions_count': 'sum',
            'mixed_direction_actions_count': 'sum',
            'system_volume': 'sum',
            'energy_volume': 'sum',
            'balancing_cost': 'sum',
        }

        # Only aggregate columns that actually exist
        numeric_aggs = {
            col: agg for col, agg in numeric_aggs.items()
            if col in df.columns
        }

        all_aggs = {
            **numeric_aggs,
            'generation_mix': self._aggregate_mix,
            'consumption_mix': self._aggregate_mix,
        }

        # Only include mix aggregations if the columns exist
        all_aggs = {
            col: agg for col, agg in all_aggs.items()
            if col in df.columns
        }

        df_daily = (
            df.groupby(['settlement_date', 'gsp_group_id'])
            .agg(all_aggs)
            .reset_index()
        )

        return df_daily
