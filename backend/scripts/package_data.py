import argparse
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from api.services.data_manifest import RUNTIME_DATA_FILES  # noqa: E402


def _collect_files(data_dir, strict):
    selected = []
    missing = []

    for relative_path in RUNTIME_DATA_FILES:
        path = data_dir / relative_path
        if path.is_file():
            selected.append(path)
        else:
            missing.append(relative_path)

    if strict and missing:
        missing_list = '\n'.join(f'  - {item}' for item in missing)
        raise SystemExit(f'Missing required runtime data files:\n{missing_list}')

    return selected, missing


def package_data(data_dir, output_path, strict=False, dry_run=False):
    data_dir = data_dir.resolve()
    output_path = output_path.resolve()
    selected, missing = _collect_files(data_dir, strict=strict)

    manifest = {
        'created_at': datetime.now(timezone.utc).isoformat(),
        'source_data_dir': str(data_dir),
        'file_count': len(selected),
        'missing_files': missing,
        'files': [
            {
                'path': path.relative_to(data_dir).as_posix(),
                'bytes': path.stat().st_size,
            }
            for path in selected
        ],
    }

    if dry_run:
        print(json.dumps(manifest, indent=2))
        return manifest

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        output_path,
        mode='w',
        compression=zipfile.ZIP_DEFLATED,
        allowZip64=True,
    ) as archive:
        for path in selected:
            archive.write(path, path.relative_to(data_dir).as_posix())

        archive.writestr('data_manifest.json', json.dumps(manifest, indent=2))

    manifest['output_path'] = str(output_path)
    manifest['output_bytes'] = output_path.stat().st_size
    print(json.dumps(manifest, indent=2))
    return manifest


def main():
    parser = argparse.ArgumentParser(
        description='Create a BMViewGB runtime data bundle for free hosting.'
    )
    parser.add_argument(
        '--data-dir',
        default=str(BACKEND_DIR / 'data'),
        help='Directory containing local BMViewGB CSV data.',
    )
    parser.add_argument(
        '--output',
        default=str(BACKEND_DIR.parent / 'dist' / 'bmviewgb-data.zip'),
        help='Output zip path.',
    )
    parser.add_argument(
        '--strict',
        action='store_true',
        help='Fail if any required runtime file is missing.',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Print the manifest without writing a zip file.',
    )

    args = parser.parse_args()
    package_data(
        data_dir=Path(args.data_dir),
        output_path=Path(args.output),
        strict=args.strict,
        dry_run=args.dry_run,
    )


if __name__ == '__main__':
    main()
