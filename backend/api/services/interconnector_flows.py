from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date as date_cls, datetime, timedelta
import re

import requests


ELEXON_INTERCONNECTOR_FLOWS_URL = (
    "https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream"
)
ELEXON_TIMEOUT_SECONDS = 12


COUNTRY_MARKETS = {
    "france": {
        "country_key": "france",
        "country_name": "France",
        "market_label": "France",
        "flag": "\U0001F1EB\U0001F1F7",
        "position": {"x": 50, "y": 86},
    },
    "netherlands": {
        "country_key": "netherlands",
        "country_name": "Netherlands",
        "market_label": "Netherlands",
        "flag": "\U0001F1F3\U0001F1F1",
        "position": {"x": 76, "y": 57},
    },
    "belgium": {
        "country_key": "belgium",
        "country_name": "Belgium",
        "market_label": "Belgium",
        "flag": "\U0001F1E7\U0001F1EA",
        "position": {"x": 69, "y": 75},
    },
    "norway": {
        "country_key": "norway",
        "country_name": "Norway",
        "market_label": "Norway NO2",
        "flag": "\U0001F1F3\U0001F1F4",
        "position": {"x": 72, "y": 16},
    },
    "denmark": {
        "country_key": "denmark",
        "country_name": "Denmark",
        "market_label": "Denmark DK1",
        "flag": "\U0001F1E9\U0001F1F0",
        "position": {"x": 83, "y": 37},
    },
    "ireland": {
        "country_key": "ireland",
        "country_name": "Ireland",
        "market_label": "Ireland / SEM",
        "flag": "\U0001F1EE\U0001F1EA",
        "position": {"x": 23, "y": 57},
    },
    "northern_ireland": {
        "country_key": "northern_ireland",
        "country_name": "Northern Ireland",
        "market_label": "Northern Ireland / SEM",
        "flag": "NI",
        "position": {"x": 27, "y": 36},
    },
}


INTERCONNECTORS = [
    {
        "id": "INTFR",
        "line_name": "IFA",
        "elexon_name": "France(IFA)",
        "country_key": "france",
        "landing_gb": "Sellindge, Kent",
        "gb_connection": {
            "node_name": "Sellindge",
            "node_code": "SELL41",
            "zone_id": "_J",
            "zone_name": "South Eastern",
            "map_position": {"x": 419, "y": 728},
            "display_position": {"x": 439.1, "y": 737.7},
        },
        "capacity_mw": 2000,
    },
    {
        "id": "INTIFA2",
        "line_name": "IFA2",
        "elexon_name": "IFA2 (INTIFA2)",
        "country_key": "france",
        "landing_gb": "Chilling, Hampshire",
        "gb_connection": {
            "node_name": "Chilling",
            "node_code": "CHIL4",
            "zone_id": "_H",
            "zone_name": "Southern",
            "map_position": {"x": 326, "y": 716},
            "display_position": {"x": 320.9, "y": 757.7},
        },
        "capacity_mw": 1000,
    },
    {
        "id": "INTELEC",
        "line_name": "ElecLink",
        "elexon_name": "Eleclink (INTELEC)",
        "country_key": "france",
        "landing_gb": "Folkestone, Kent",
        "gb_connection": {
            "node_name": "Sellindge",
            "node_code": "SELL41",
            "zone_id": "_J",
            "zone_name": "South Eastern",
            "map_position": {"x": 419, "y": 728},
            "display_position": {"x": 438.8, "y": 738.4},
        },
        "capacity_mw": 1000,
    },
    {
        "id": "INTNED",
        "line_name": "BritNed",
        "elexon_name": "Netherlands(BritNed)",
        "country_key": "netherlands",
        "landing_gb": "Isle of Grain, Kent",
        "gb_connection": {
            "node_name": "Grain",
            "node_code": "GRAI41",
            "zone_id": "_J",
            "zone_name": "South Eastern",
            "map_position": {"x": 408, "y": 690},
            "display_position": {"x": 456.0, "y": 706.9},
        },
        "capacity_mw": 1000,
    },
    {
        "id": "INTNEM",
        "line_name": "Nemo Link",
        "elexon_name": "Belgium (Nemolink)",
        "country_key": "belgium",
        "landing_gb": "Richborough, Kent",
        "gb_connection": {
            "node_name": "Richborough",
            "node_code": "RICH41",
            "zone_id": "_J",
            "zone_name": "South Eastern",
            "map_position": {"x": 423, "y": 716},
            "display_position": {"x": 456.2, "y": 721.4},
        },
        "capacity_mw": 1000,
    },
    {
        "id": "INTNSL",
        "line_name": "North Sea Link",
        "elexon_name": "North Sea Link (INTNSL)",
        "country_key": "norway",
        "landing_gb": "Blyth, Northumberland",
        "gb_connection": {
            "node_name": "Blyth",
            "node_code": "BLYT41",
            "zone_id": "_F",
            "zone_name": "Northern",
            "map_position": {"x": 352, "y": 468},
            "display_position": {"x": 368.0, "y": 494.3},
        },
        "capacity_mw": 1400,
    },
    {
        "id": "INTVKL",
        "line_name": "Viking Link",
        "elexon_name": "Denmark (Viking link)",
        "country_key": "denmark",
        "landing_gb": "Bicker Fen, Lincolnshire",
        "gb_connection": {
            "node_name": "Bicker Fen",
            "node_code": "BICF41",
            "zone_id": "_B",
            "zone_name": "East Midlands",
            "map_position": {"x": 372, "y": 612},
            "display_position": {"x": 413.1, "y": 595.1},
        },
        "capacity_mw": 1400,
    },
    {
        "id": "INTEW",
        "line_name": "East-West",
        "elexon_name": "Ireland(East-West)",
        "country_key": "ireland",
        "landing_gb": "Deeside, North Wales",
        "gb_connection": {
            "node_name": "Connah's Quay",
            "node_code": "CONQ41",
            "zone_id": "_D",
            "zone_name": "Merseyside and North Wales",
            "map_position": {"x": 252, "y": 610},
            "display_position": {"x": 205.0, "y": 616.6},
        },
        "capacity_mw": 500,
    },
    {
        "id": "INTGRNL",
        "line_name": "Greenlink",
        "elexon_name": "Ireland (Greenlink)",
        "country_key": "ireland",
        "landing_gb": "Pembroke, Wales",
        "gb_connection": {
            "node_name": "Pembroke",
            "node_code": "PEMB41",
            "zone_id": "_K",
            "zone_name": "South Wales",
            "map_position": {"x": 165, "y": 676},
            "display_position": {"x": 180.1, "y": 677.2},
        },
        "capacity_mw": 500,
    },
    {
        "id": "INTIRL",
        "line_name": "Moyle",
        "elexon_name": "Northern Ireland(Moyle)",
        "country_key": "northern_ireland",
        "landing_gb": "Auchencrosh, Scotland",
        "gb_connection": {
            "node_name": "Auchencross",
            "node_code": "AUCH2-",
            "zone_id": "_N",
            "zone_name": "South Scotland",
            "map_position": {"x": 148, "y": 388},
            "display_position": {"x": 200.0, "y": 399.7},
        },
        "capacity_mw": 500,
    },
]


COUNTRY_GB_DISPLAY_POSITIONS = {
    "france": {"x": 413.4, "y": 745.3},
    "netherlands": {"x": 456.0, "y": 706.9},
    "belgium": {"x": 456.2, "y": 721.4},
    "norway": {"x": 368.0, "y": 494.3},
    "denmark": {"x": 413.1, "y": 595.1},
    "ireland": {"x": 193.9, "y": 665.3},
    "northern_ireland": {"x": 200.0, "y": 399.7},
}


class InterconnectorDataError(Exception):
    pass


def _normalise_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


INTERCONNECTOR_LOOKUP = {}
for item in INTERCONNECTORS:
    INTERCONNECTOR_LOOKUP[_normalise_key(item["id"])] = item
    INTERCONNECTOR_LOOKUP[_normalise_key(item["elexon_name"])] = item
    INTERCONNECTOR_LOOKUP[_normalise_key(item["line_name"])] = item


def _parse_sort_time(record):
    for key in ["startTime", "publishTime"]:
        value = record.get(key)
        if not value:
            continue
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue
    return datetime.min


def _direction(flow_mw):
    if flow_mw is None:
        return "no_data"
    if flow_mw > 0:
        return "import_to_gb"
    if flow_mw < 0:
        return "export_from_gb"
    return "idle"


def _direction_label(direction):
    labels = {
        "import_to_gb": "Importing to GB",
        "export_from_gb": "Exporting from GB",
        "idle": "No net flow",
        "no_data": "No data",
    }
    return labels.get(direction, "No data")


def _coerce_generation(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_settlement_period(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _get_snapshot_records(records, requested_date=None, requested_period=None):
    if not records:
        return [], {
            "resolved_by": "none",
            "message": (
                "Elexon returned no FUELHH interconnector records for the "
                "selected settlement date."
            ) if requested_date else "Elexon returned no interconnector records.",
            "is_fallback": True,
        }

    sorted_records = sorted(records, key=_parse_sort_time, reverse=True)

    if requested_date:
        date_records = [
            row for row in sorted_records
            if row.get("settlementDate") == requested_date
        ]

        if date_records:
            if requested_period is not None:
                period_records = [
                    row for row in date_records
                    if _coerce_settlement_period(row.get("settlementPeriod")) == requested_period
                ]
                if period_records:
                    return period_records, {
                        "resolved_by": "requested_settlement_period",
                        "message": "",
                        "is_fallback": False,
                    }

            latest_for_date = _parse_sort_time(date_records[0])
            records_for_latest_period = [
                row for row in date_records
                if _parse_sort_time(row) == latest_for_date
            ]
            return records_for_latest_period, {
                "resolved_by": "latest_available_period_for_requested_date",
                "message": (
                    "Requested settlement period is not available for the "
                    "selected settlement date; showing the latest available "
                    "period for that date."
                ),
                "is_fallback": requested_period is not None,
            }

    latest_time = _parse_sort_time(sorted_records[0])
    latest_records = [
        row for row in sorted_records
        if _parse_sort_time(row) == latest_time
    ]
    return latest_records, {
        "resolved_by": "latest_available_period",
        "message": (
            "Selected settlement date was not present in the Elexon response; "
            "showing the latest available interconnector snapshot."
        ) if requested_date else "",
        "is_fallback": bool(requested_date),
    }


def _build_line_records(snapshot_records):
    raw_by_interconnector = {}

    for record in snapshot_records:
        config = INTERCONNECTOR_LOOKUP.get(_normalise_key(
            record.get("interconnectorName") or record.get("fuelType")
        ))
        if not config:
            continue

        existing = raw_by_interconnector.get(config["id"])
        if existing is None or _parse_sort_time(record) >= _parse_sort_time(existing):
            raw_by_interconnector[config["id"]] = record

    line_records = []
    for config in INTERCONNECTORS:
        record = raw_by_interconnector.get(config["id"])
        flow_mw = _coerce_generation(record.get("generation")) if record else None
        direction = _direction(flow_mw)
        capacity_mw = float(config["capacity_mw"])
        absolute_flow_mw = abs(flow_mw) if flow_mw is not None else None
        utilisation_pct = (
            absolute_flow_mw / capacity_mw * 100
            if absolute_flow_mw is not None and capacity_mw > 0 else None
        )
        country = COUNTRY_MARKETS[config["country_key"]]

        line_records.append({
            "id": config["id"],
            "line_name": config["line_name"],
            "elexon_name": config["elexon_name"],
            "country_key": config["country_key"],
            "country_name": country["country_name"],
            "market_label": country["market_label"],
            "flag": country["flag"],
            "landing_gb": config["landing_gb"],
            "gb_connection": config["gb_connection"],
            "capacity_mw": capacity_mw,
            "flow_mw": flow_mw,
            "absolute_flow_mw": absolute_flow_mw,
            "utilisation_pct": utilisation_pct,
            "direction": direction,
            "direction_label": _direction_label(direction),
            "is_missing": record is None,
            "source": {
                "dataset": record.get("dataset") if record else None,
                "publish_time": record.get("publishTime") if record else None,
                "start_time": record.get("startTime") if record else None,
                "settlement_date": record.get("settlementDate") if record else None,
                "settlement_period": record.get("settlementPeriod") if record else None,
            },
        })

    return line_records


def _build_country_connection(lines):
    if not lines:
        return None

    weighted_lines = []
    for line in lines:
        flow_weight = abs(line["flow_mw"]) if line["flow_mw"] is not None else 0
        weight = flow_weight if flow_weight > 0 else line["capacity_mw"]
        weighted_lines.append((line, weight))

    total_weight = sum(weight for _, weight in weighted_lines)
    if total_weight <= 0:
        total_weight = len(weighted_lines)
        weighted_lines = [(line, 1) for line, _ in weighted_lines]

    map_x = sum(
        line["gb_connection"]["map_position"]["x"] * weight
        for line, weight in weighted_lines
    ) / total_weight
    map_y = sum(
        line["gb_connection"]["map_position"]["y"] * weight
        for line, weight in weighted_lines
    ) / total_weight

    display_x = sum(
        (line["gb_connection"].get("display_position") or line["gb_connection"]["map_position"])["x"] * weight
        for line, weight in weighted_lines
    ) / total_weight
    display_y = sum(
        (line["gb_connection"].get("display_position") or line["gb_connection"]["map_position"])["y"] * weight
        for line, weight in weighted_lines
    ) / total_weight

    representative_line = max(weighted_lines, key=lambda item: item[1])[0]
    country_key = representative_line["country_key"]
    display_position = COUNTRY_GB_DISPLAY_POSITIONS.get(country_key, {
        "x": round(display_x, 1),
        "y": round(display_y, 1),
    })
    zone_ids = []
    zone_names = []
    nodes = []

    for line in lines:
        connection = line["gb_connection"]
        if connection["zone_id"] not in zone_ids:
            zone_ids.append(connection["zone_id"])
        if connection["zone_name"] not in zone_names:
            zone_names.append(connection["zone_name"])
        nodes.append({
            "interconnector_id": line["id"],
            "line_name": line["line_name"],
            "node_name": connection["node_name"],
            "node_code": connection["node_code"],
            "zone_id": connection["zone_id"],
            "zone_name": connection["zone_name"],
            "map_position": connection["map_position"],
            "display_position": connection.get("display_position"),
        })

    return {
        "node_name": representative_line["gb_connection"]["node_name"],
        "node_code": representative_line["gb_connection"]["node_code"],
        "zone_id": representative_line["gb_connection"]["zone_id"],
        "zone_name": " / ".join(zone_names),
        "zone_ids": zone_ids,
        "zone_names": zone_names,
        "map_position": {
            "x": round(map_x, 1),
            "y": round(map_y, 1),
        },
        "display_position": display_position,
        "nodes": nodes,
        "aggregation_method": "absolute_flow_weighted_when_available_capacity_weighted_otherwise",
    }


def _build_country_records(line_records):
    countries = []

    for country_key, country in COUNTRY_MARKETS.items():
        lines = [
            line for line in line_records
            if line["country_key"] == country_key
        ]
        available_lines = [
            line for line in lines
            if line["flow_mw"] is not None
        ]
        capacity_mw = sum(line["capacity_mw"] for line in lines)
        import_mw = sum(max(line["flow_mw"], 0) for line in available_lines)
        export_mw = sum(abs(min(line["flow_mw"], 0)) for line in available_lines)
        flow_mw = import_mw - export_mw
        absolute_flow_mw = abs(flow_mw)
        utilisation_pct = (
            absolute_flow_mw / capacity_mw * 100
            if capacity_mw > 0 and available_lines else None
        )
        direction = _direction(flow_mw if available_lines else None)

        countries.append({
            **country,
            "capacity_mw": capacity_mw,
            "import_mw": import_mw if available_lines else None,
            "export_mw": export_mw if available_lines else None,
            "net_import_mw": flow_mw if available_lines else None,
            "flow_mw": flow_mw if available_lines else None,
            "absolute_flow_mw": absolute_flow_mw if available_lines else None,
            "utilisation_pct": utilisation_pct,
            "direction": direction,
            "direction_label": _direction_label(direction),
            "line_count": len(lines),
            "available_line_count": len(available_lines),
            "gb_connection": _build_country_connection(lines),
            "interconnectors": lines,
        })

    return countries


def _latest_records_by_interconnector_period(records):
    latest = {}

    for record in records:
        config = INTERCONNECTOR_LOOKUP.get(_normalise_key(
            record.get("interconnectorName") or record.get("fuelType")
        ))
        settlement_period = _coerce_settlement_period(record.get("settlementPeriod"))

        if not config or settlement_period is None:
            continue

        key = (config["id"], settlement_period)
        existing = latest.get(key)
        if existing is None or _parse_sort_time(record) >= _parse_sort_time(existing):
            latest[key] = record

    return latest


def _build_country_period_snapshot(country_key, period, records_by_interconnector_period):
    line_configs = [
        config for config in INTERCONNECTORS
        if config["country_key"] == country_key
    ]
    flows = []

    for config in line_configs:
        record = records_by_interconnector_period.get((config["id"], period))
        flow_mw = _coerce_generation(record.get("generation")) if record else None
        if flow_mw is not None:
            flows.append(flow_mw)

    capacity_mw = sum(float(config["capacity_mw"]) for config in line_configs)
    import_mw = sum(max(flow, 0) for flow in flows)
    export_mw = sum(abs(min(flow, 0)) for flow in flows)
    net_import_mw = import_mw - export_mw
    utilisation_pct = (
        abs(net_import_mw) / capacity_mw * 100
        if capacity_mw > 0 and flows else None
    )

    return {
        "settlement_period": period,
        "flow_mw": net_import_mw if flows else None,
        "import_mw": import_mw if flows else None,
        "export_mw": export_mw if flows else None,
        "net_import_mw": net_import_mw if flows else None,
        "utilisation_pct": utilisation_pct,
        "direction": _direction(net_import_mw if flows else None),
        "available_line_count": len(flows),
        "line_count": len(line_configs),
    }


def _build_intraday_series(records, valid_periods):
    records_by_interconnector_period = _latest_records_by_interconnector_period(records)

    return {
        "periods": valid_periods,
        "countries": {
            country_key: [
                _build_country_period_snapshot(
                    country_key,
                    period,
                    records_by_interconnector_period,
                )
                for period in valid_periods
            ]
            for country_key in COUNTRY_MARKETS
        },
    }


def _build_totals(line_records):
    available = [line for line in line_records if line["flow_mw"] is not None]
    import_mw = sum(max(line["flow_mw"], 0) for line in available)
    export_mw = sum(abs(min(line["flow_mw"], 0)) for line in available)
    net_import_mw = import_mw - export_mw
    total_capacity_mw = sum(line["capacity_mw"] for line in line_records)

    return {
        "import_mw": import_mw,
        "export_mw": export_mw,
        "net_import_mw": net_import_mw,
        "total_nominal_capacity_mw": total_capacity_mw,
        "available_interconnector_count": len(available),
        "configured_interconnector_count": len(line_records),
        "importing_interconnector_count": len([line for line in available if line["flow_mw"] > 0]),
        "exporting_interconnector_count": len([line for line in available if line["flow_mw"] < 0]),
    }


def _available_periods(records, settlement_date):
    periods = sorted({
        int(row.get("settlementPeriod"))
        for row in records
        if row.get("settlementDate") == settlement_date and row.get("settlementPeriod") is not None
    })
    return periods


def _last_sunday(year, month):
    day = date_cls(year, month + 1, 1) - timedelta(days=1)
    return day - timedelta(days=(day.weekday() + 1) % 7)


def _valid_settlement_periods(settlement_date):
    try:
        parsed_date = date_cls.fromisoformat(settlement_date)
    except (TypeError, ValueError):
        return list(range(1, 51))

    if parsed_date == _last_sunday(parsed_date.year, 3):
        max_period = 46
    elif parsed_date == _last_sunday(parsed_date.year, 10):
        max_period = 50
    else:
        max_period = 48

    return list(range(1, max_period + 1))


def _normalise_payload_records(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "value", "records"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
        if payload.get("fuelType") or payload.get("interconnectorName"):
            return [payload]
    return None


def _fetch_fuel_type_record(config, settlement_date, settlement_period):
    params = {
        "format": "json",
        "settlementDateFrom": settlement_date,
        "settlementDateTo": settlement_date,
        "settlementPeriod": settlement_period,
        "fuelType": config["id"],
    }

    response = requests.get(
        ELEXON_INTERCONNECTOR_FLOWS_URL,
        params=params,
        timeout=ELEXON_TIMEOUT_SECONDS,
    )

    if response.status_code == 404:
        return None

    response.raise_for_status()

    payload = response.json()
    records = _normalise_payload_records(payload) or []

    matching_records = [
        record for record in records
        if (
            record.get("settlementDate") == settlement_date and
            _coerce_settlement_period(record.get("settlementPeriod")) == int(settlement_period) and
            _normalise_key(record.get("fuelType") or record.get("interconnectorName")) ==
            _normalise_key(config["id"])
        )
    ]

    if not matching_records:
        return None

    return max(matching_records, key=_parse_sort_time)


def _fetch_fuel_type_records_for_day(config, settlement_date):
    params = {
        "format": "json",
        "settlementDateFrom": settlement_date,
        "settlementDateTo": settlement_date,
        "fuelType": config["id"],
    }

    response = requests.get(
        ELEXON_INTERCONNECTOR_FLOWS_URL,
        params=params,
        timeout=ELEXON_TIMEOUT_SECONDS,
    )

    if response.status_code == 404:
        return []

    response.raise_for_status()

    payload = response.json()
    records = _normalise_payload_records(payload) or []

    return [
        record for record in records
        if (
            record.get("settlementDate") == settlement_date and
            _normalise_key(record.get("fuelType") or record.get("interconnectorName")) ==
            _normalise_key(config["id"])
        )
    ]


def _fetch_requested_period_records(settlement_date, settlement_period):
    records = []
    errors = []

    with ThreadPoolExecutor(max_workers=min(6, len(INTERCONNECTORS))) as executor:
        future_to_config = {
            executor.submit(
                _fetch_fuel_type_record,
                config,
                settlement_date,
                settlement_period,
            ): config
            for config in INTERCONNECTORS
        }

        for future in as_completed(future_to_config):
            config = future_to_config[future]
            try:
                record = future.result()
                if record:
                    records.append(record)
            except requests.RequestException as exc:
                errors.append(f"{config['id']}: {exc}")
            except ValueError as exc:
                errors.append(f"{config['id']}: invalid JSON response ({exc})")

    if errors and not records:
        raise InterconnectorDataError(
            "Elexon request failed for all interconnector fuel types: " +
            "; ".join(errors[:3])
        )

    return records, errors


def _fetch_requested_date_records(settlement_date):
    records = []
    errors = []

    with ThreadPoolExecutor(max_workers=min(6, len(INTERCONNECTORS))) as executor:
        future_to_config = {
            executor.submit(
                _fetch_fuel_type_records_for_day,
                config,
                settlement_date,
            ): config
            for config in INTERCONNECTORS
        }

        for future in as_completed(future_to_config):
            config = future_to_config[future]
            try:
                records.extend(future.result())
            except requests.RequestException as exc:
                errors.append(f"{config['id']}: {exc}")
            except ValueError as exc:
                errors.append(f"{config['id']}: invalid JSON response ({exc})")

    if errors and not records:
        raise InterconnectorDataError(
            "Elexon request failed for all interconnector fuel types: " +
            "; ".join(errors[:3])
        )

    return records, errors


def _build_resolution(records, requested_date, requested_period, request_errors=None):
    source_record = max(records, key=_parse_sort_time) if records else {}
    has_valid_requested_period = requested_period in _valid_settlement_periods(requested_date)

    if records:
        message = ""
        if request_errors:
            message = (
                "Some interconnector fuel types could not be loaded from Elexon; "
                "showing the lines that returned data for the selected time."
            )

        return {
            "settlement_date": requested_date,
            "settlement_period": requested_period,
            "start_time": source_record.get("startTime"),
            "publish_time": source_record.get("publishTime"),
            "resolved_by": "requested_settlement_period",
            "message": message,
            "is_fallback": False,
        }

    if has_valid_requested_period:
        message = (
            "No Elexon FUELHH interconnector data is available for the "
            "selected settlement date and period."
        )
    else:
        message = (
            "Selected settlement period is not valid for this GB settlement "
            "date, so no interconnector data is available."
        )

    return {
        "settlement_date": requested_date,
        "settlement_period": requested_period,
        "start_time": None,
        "publish_time": None,
        "resolved_by": "requested_settlement_period_no_data",
        "message": message,
        "is_fallback": False,
    }


def fetch_interconnector_flows_snapshot(requested_date=None, requested_period=None):
    if not requested_date:
        requested_date = datetime.utcnow().strftime("%Y-%m-%d")
    if requested_period is None:
        requested_period = 1

    try:
        requested_period = int(requested_period)
    except (TypeError, ValueError) as exc:
        raise InterconnectorDataError("settlement_period must be an integer.") from exc

    valid_periods = _valid_settlement_periods(requested_date)
    try:
        day_records, request_errors = _fetch_requested_date_records(requested_date)
    except InterconnectorDataError as exc:
        day_records = []
        request_errors = [str(exc)]
    records = [
        record for record in day_records
        if _coerce_settlement_period(record.get("settlementPeriod")) == requested_period
    ]

    should_backfill_requested_period = (
        bool(request_errors) or
        (not records and requested_period in valid_periods)
    )

    if should_backfill_requested_period:
        period_records, period_errors = _fetch_requested_period_records(
            requested_date,
            requested_period,
        )
        request_errors.extend(period_errors)

        if period_records:
            records.extend(period_records)
            day_records.extend(period_records)

    line_records = _build_line_records(records)
    country_records = _build_country_records(line_records)
    totals = _build_totals(line_records)

    resolved = _build_resolution(
        records,
        requested_date,
        requested_period,
        request_errors=request_errors,
    )
    series = _build_intraday_series(day_records, valid_periods)

    return {
        "requested": {
            "settlement_date": requested_date,
            "settlement_period": requested_period,
        },
        "resolved": resolved,
        "available_periods": valid_periods,
        "countries": country_records,
        "interconnectors": line_records,
        "series": series,
        "totals": totals,
        "meta": {
            "source_name": "Elexon Insights Solution",
            "source_url": ELEXON_INTERCONNECTOR_FLOWS_URL,
            "dataset": "FUELHH half-hourly generation outturn by interconnector fuel type",
            "direction_convention": "Positive MW values are imports to GB; negative MW values are exports from GB.",
            "capacity_basis": "Nominal interconnector capacities from public operator/regulatory sources; live MW flow is sourced from Elexon.",
            "gb_connection_basis": "GB-side interconnector connection nodes are aligned to Elexon Network Mapping Statement interconnector nodes and mapped to BMViewGB GSP zones for display.",
        },
    }
