GIT_MESSAGE="${1:-}"

git add .
git commit -m GIT_MESSAGE
git push origin main

ssh root@192.3.179.244
cd /MoonShade
git pull origin main
systemctl restart moonshade