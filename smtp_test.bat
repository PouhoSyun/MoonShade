export MOONSHADE_SMTP_HOST=smtp-relay.brevo.com
export MOONSHADE_SMTP_PORT=465
export MOONSHADE_SMTP_SECURE=true
export MOONSHADE_SMTP_USER="b21fd7001@smtp-brevo.com"
export MOONSHADE_SMTP_FROM="moodylitchee@gmail.com"
export MOONSHADE_SMTP_FROM_NAME="MoonShade"
export TEST_EMAIL_TO="phsun@stu.pku.edu.cn"

read -s MOONSHADE_SMTP_PASS
export MOONSHADE_SMTP_PASS

npm run test:email