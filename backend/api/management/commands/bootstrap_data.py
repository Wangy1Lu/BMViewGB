from django.core.management.base import BaseCommand, CommandError

from api.services.data_bootstrap import ensure_data_available


class Command(BaseCommand):
    help = 'Download and extract the BMViewGB runtime data bundle if required.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--bundle-url',
            help='Override DATA_BUNDLE_URL for this run.',
        )
        parser.add_argument(
            '--data-dir',
            help='Override BMVIEWGB_DATA_DIR for this run.',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Download and extract the bundle even if required files exist.',
        )
        parser.add_argument(
            '--require-data',
            action='store_true',
            help='Fail if required runtime data is unavailable.',
        )

    def handle(self, *args, **options):
        try:
            status = ensure_data_available(
                data_dir=options.get('data_dir'),
                bundle_url=options.get('bundle_url'),
                require_data=options.get('require_data', False),
                force=options.get('force', False),
            )
        except Exception as exc:
            raise CommandError(str(exc)) from exc

        if status['ready']:
            self.stdout.write(
                self.style.SUCCESS(f"Runtime data ready in {status['data_dir']}")
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    'Runtime data is incomplete. Missing files: '
                    + ', '.join(status['missing_after'][:8])
                )
            )
