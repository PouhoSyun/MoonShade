export MOONSHADE_SMTP_HOST=smtp-relay.brevo.com
export MOONSHADE_SMTP_PORT=465
export MOONSHADE_SMTP_SECURE=true
export MOONSHADE_SMTP_USER="your-brevo-smtp-login"
export MOONSHADE_SMTP_FROM="your-verified-sender@example.com"
export MOONSHADE_SMTP_FROM_NAME="MoonShade"
export TEST_EMAIL_TO="your-test-recipient@example.com"

read -s MOONSHADE_SMTP_PASS
export MOONSHADE_SMTP_PASS

npm run test:email
