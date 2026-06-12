import json
import os
import shutil
import tarfile
import time
import zipfile
from pathlib import Path

import requests

from .data_manifest import RUNTIME_DATA_FILES


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = BACKEND_DIR / 'data'

DATA_BUNDLE_ENV_VARS = (
    'DATA_BUNDLE_URL',
    'BMVIEWGB_DATA_BUNDLE_URL',
)

def get_data_dir(data_dir=None):
    if data_dir:
        return Path(data_dir).expanduser().resolve()

    configured = os.environ.get('BMVIEWGB_DATA_DIR')
    if configured:
        return Path(configured).expanduser().resolve()

    return DEFAULT_DATA_DIR


def get_data_bundle_url(bundle_url=None):
    if bundle_url:
        return bundle_url

    for env_var in DATA_BUNDLE_ENV_VARS:
        value = os.environ.get(env_var)
        if value:
            return value

    return None


def missing_required_files(data_dir=None):
    root = get_data_dir(data_dir)
    return [
        relative_path
        for relative_path in RUNTIME_DATA_FILES
        if not (root / relative_path).is_file()
    ]


def _normalise_archive_member(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError(f'Unsafe archive path: {name}')

    parts = list(path.parts)
    if len(parts) >= 2 and parts[0] == 'backend' and parts[1] == 'data':
        parts = parts[2:]
    elif parts and parts[0] == 'data':
        parts = parts[1:]

    if not parts:
        return None

    return Path(*parts)


def _extract_zip(archive_path, data_dir):
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue

            relative_path = _normalise_archive_member(member.filename)
            if relative_path is None:
                continue

            target_path = data_dir / relative_path
            target_path.parent.mkdir(parents=True, exist_ok=True)

            with archive.open(member) as source, target_path.open('wb') as target:
                shutil.copyfileobj(source, target)


def _extract_tar(archive_path, data_dir):
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue

            relative_path = _normalise_archive_member(member.name)
            if relative_path is None:
                continue

            target_path = data_dir / relative_path
            target_path.parent.mkdir(parents=True, exist_ok=True)

            source = archive.extractfile(member)
            if source is None:
                continue

            with source, target_path.open('wb') as target:
                shutil.copyfileobj(source, target)


def _extract_bundle(archive_path, data_dir):
    suffixes = ''.join(archive_path.suffixes).lower()

    if suffixes.endswith('.zip'):
        _extract_zip(archive_path, data_dir)
        return

    if suffixes.endswith('.tar.gz') or suffixes.endswith('.tgz'):
        _extract_tar(archive_path, data_dir)
        return

    raise ValueError(
        f'Unsupported data bundle format: {archive_path.name}. '
        'Use .zip, .tar.gz, or .tgz.'
    )


def _download_bundle(bundle_url, target_path):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_suffix(target_path.suffix + '.part')

    with requests.get(bundle_url, stream=True, timeout=(10, 120)) as response:
        response.raise_for_status()
        with temp_path.open('wb') as file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    file.write(chunk)

    temp_path.replace(target_path)


def ensure_data_available(data_dir=None, bundle_url=None, require_data=False, force=False):
    root = get_data_dir(data_dir)
    root.mkdir(parents=True, exist_ok=True)

    missing_before = missing_required_files(root)
    if force or missing_before:
        resolved_url = get_data_bundle_url(bundle_url)

        if resolved_url:
            archive_name = resolved_url.split('?')[0].rstrip('/').split('/')[-1]
            if not archive_name:
                archive_name = 'bmviewgb-data.zip'

            archive_path = root / '.bootstrap' / archive_name
            _download_bundle(resolved_url, archive_path)
            _extract_bundle(archive_path, root)
            archive_path.unlink(missing_ok=True)

        elif require_data:
            raise RuntimeError(
                'Required data files are missing and DATA_BUNDLE_URL is not set. '
                f'Missing files: {", ".join(missing_before[:8])}'
            )

    missing_after = missing_required_files(root)
    status = {
        'data_dir': str(root),
        'bundle_url_configured': bool(get_data_bundle_url(bundle_url)),
        'required_file_count': len(RUNTIME_DATA_FILES),
        'missing_before': missing_before,
        'missing_after': missing_after,
        'ready': not missing_after,
        'checked_at_unix': int(time.time()),
    }

    status_path = root / 'bootstrap_status.json'
    status_path.write_text(json.dumps(status, indent=2), encoding='utf-8')

    if require_data and missing_after:
        raise RuntimeError(
            'Data bootstrap completed but required files are still missing: '
            + ', '.join(missing_after[:8])
        )

    return status
