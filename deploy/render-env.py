"""Build a Compose raw env file from explicitly mapped GitHub secrets."""
import os
from pathlib import Path
import sys


def render(environ):
    required = ('DATABASE_URL', 'KAFKA_BROKERS', 'ADMIN_USERNAME',
                'ADMIN_PASSWORD_HASH', 'JWT_SECRET', 'CORS_ORIGINS')
    optional = ('MIGRATION_DATABASE_URL', 'DATABASE_URL_UNPOOLED',
                'KAFKA_CLIENT_ID', 'KAFKA_GROUP_ID', 'KAFKA_TOPIC',
                'KAFKA_TOPIC_PARTITIONS', 'KAFKA_SASL_MECHANISM',
                'KAFKA_SASL_USERNAME', 'KAFKA_SASL_PASSWORD',
                'KAFKA_CA_CERT_BASE64', 'KAFKA_CLIENT_CERT_BASE64',
                'KAFKA_CLIENT_KEY_BASE64', 'LOG_LEVEL')
    missing = [key for key in required if not environ.get(key, '').strip()]
    if missing:
        raise ValueError('Missing GitHub Actions secrets: ' + ', '.join(missing))
    values = dict(NODE_ENV='production', PORT='3000', DATABASE_SSL='true',
                  KAFKA_SSL='true', TRUST_PROXY='true')
    for key in required + optional:
        value = environ.get(key, '')
        if not value:
            continue  # Let the application apply defaults for optional settings.
        if any(char in value for char in ('\r', '\n', '\0')):
            raise ValueError(f'{key} must be a single-line value; use base64 for certificates')
        values[key] = value
    return ''.join(f'{key}={value}\n' for key, value in values.items())


if __name__ == '__main__':
    try:
        content = render(os.environ)
    except ValueError as error:
        sys.exit(str(error))  # Names only: never print secret values.
    destination = Path(sys.argv[1])
    # The GitHub runner is Linux. Restrict access before writing any secrets.
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
        output.write(content)
